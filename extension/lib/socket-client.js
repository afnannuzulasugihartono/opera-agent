// @title: socket-client — one persistent connection to the bridge, reconnected on its own, never polled.
// @state: 12 locks; handshake gate, ordered dispatch, backoff, fatal close, and the stored-completion resend.
// @dependencies: ./socket-protocol.js.

// WHY THIS FILE EXISTS
//
// The device used to open an HTTP request every 500 ms to ask whether work existed,
// and another to report the result. That is two round trips per action and a
// blocking wait inside each one. Measured on this machine, a six step burst spent
// 238 ms in the browser and 496 ms in transport.
//
// This holds one socket open instead. The bridge pushes work down it and the
// device pushes completions back up the same connection, so nothing on the hot
// path asks a question and nothing waits for an answer it did not request.
//
// WHY there is no polling underneath. A fallback that quietly resumes polling
// would restore the exact latency this file exists to remove, and it would do so
// invisibly: the device would look healthy while running two hundred times slower
// than it should. A transport that cannot connect is a transport that is down,
// and saying so is worth more than pretending.
//
// WHY backoff is capped. A device that reconnects in a tight loop against a bridge
// that is down turns one outage into two: the outage, and the traffic meant to
// survive it. The cap is what keeps the second one small.
//
// WHY send is gated on ready. A completion that was stored and never confirmed has
// to be able to go out on a reconnected socket, but it must not be written into one
// whose handshake the bridge has not answered yet.
//
// WHY work runs one command at a time. An async message handler starts the next
// command the moment the previous one awaits anything, and two browser actions then
// fight over the same tab with nothing left to report either result. The old poll
// loop was sequential by construction; push transport has to be made so.
//
// WHY the queue survives a dropped socket. A command already taken off the wire was
// taken off on purpose; the device owes a completion for it, and that completion
// still fits on the next connection.
//
// WHY sending is guarded. A socket can close between the moment a completion is
// built and the moment it is written, and an unhandled throw inside a drain would
// reject a promise nobody awaits. The frame is simply lost, which is exactly what
// the stored-completion resend exists to cover.
//
// WHY an error frame is reported rather than dropped. The bridge answers a frame
// it could not handle with an error and nothing else, so ignoring it means a
// device whose handshake or whose completion was refused looks exactly like one
// that is working.
//
// WHY the drain loop does not test a stop flag. stop() empties the queue, which
// ends a drain already in flight; reading a second flag would only obscure why the
// loop stopped.

import {
  completionFrame,
  handshakeFrame,
  isFatalClose,
  isReady,
  isRunnableCommand,
  normalizeCommand,
  parseFrame,
  pongFrame
} from './socket-protocol.js';

const BASE_RETRY_MS = 500;
const MAX_RETRY_MS = 30000;

// WHY the mapping from socket events to connection state lives here as a pure
// function instead of inline in the worker. It used to be an object literal inside
// the onState callback, where a bare `retryMs` with no binding threw a
// ReferenceError the first time the callback fired. That killed start() before the
// socket was ever opened, and because the client was already assigned, nothing
// ever retried: the device sat at "connecting" with no socket and no error, which
// is exactly what the integration test reported. A function with locks cannot hide
// a crash the same way.
//
// WHY an error frame reports only its message. It arrives on a live socket, so it
// says nothing about the connection and must not stamp a fresh lastConnectedAt or
// clear an unrelated error. The previous inline version did both by accident.
//
// WHY stale becomes reconnecting. The watchdog opens a new socket in the same
// breath, so by the time this patch is read the device is reconnecting, and the
// popup never has to learn a status that lasts less than a millisecond.

// WHY connecting carries no lastError key at all. A fresh attempt does not erase
// the reason the previous one ended, and merging a null over it did exactly that:
// observed live, a device cycling ready to connecting every minute with no error
// anywhere, which made the cycle itself undiagnosable. Only a connection clears
// the slate.

export function connectionPatch(event, stamp) {
  const status = event?.status;

  if (status === 'connected') {
    return { status: 'ready', lastConnectedAt: stamp, lastError: null };
  }

  if (status === 'error') {
    return { lastError: `Bridge: ${String(event.message || 'bridge error').slice(0, 200)}` };
  }

  if (status === 'rejected') {
    return { status: 'rejected', lastError: 'Bridge refused this device.' };
  }

  if (status === 'recycling') {
    return { status: 'reconnecting', lastError: null };
  }

  const closed = event?.code
    ? `Socket closed ${event.code}${event.reason ? `: ${event.reason}` : ''}.`
    : null;
  const stale = status === 'stale'
    ? `Silent for ${Math.round(Number(event.silenceMs) || 0)}ms; reconnecting.`
    : null;

  if (status === 'connecting') {
    return { status: 'connecting' };
  }

  return {
    status: status === 'stale' ? 'reconnecting' : status,
    lastError: stale || closed
  };
}

// WHY the device keeps its own deadline. The bridge pings every twenty seconds, so
// silence past a bound means the peer is gone even though nothing said so. The
// case that makes this necessary is a zombie connection: observed live, a device
// reported ready for nineteen minutes on a socket whose far end had been replaced,
// because the TCP connection was never closed, no ping ever arrived, and no close
// ever came. Nothing on that device could tell the difference between a healthy
// socket and one that would never deliver another command.
//
// WHY three intervals. One interval could be a delayed frame, two could be a busy
// network, and a false teardown costs a reconnect. Three missing pings is past any
// delay worth waiting through.
//
// WHY a close is only ever sent on an open or connecting socket. Closing one the
// peer already started closing answers nothing, and Chromium reports "Close
// received after close" on the extension errors page even though the call itself
// is caught, so every user sees it. Observed live. A socket that is already
// closing needs no close from us; it only needs to be forgotten.
//
// WHY the watchdog has its own timer. It is a liveness check, not a retry, and it
// runs for the whole life of the client rather than between attempts. Sharing one
// timer with the backoff would make every test that drives the backoff also drive
// the watchdog, which is exactly the kind of coupling that turns a timing change
// into a mystery failure somewhere else.

const SILENCE_LIMIT_MS = 60000;
const WATCHDOG_MS = 10000;

// WHY the socket is recycled before the platform kills it. Edge isolates have a
// hard wall clock limit — about 150 seconds on this project — and waitUntil only
// prevents early retirement, never extends it. Observed live as code 1006 at a
// metronomic 151 seconds after waitUntil fixed the 76-second EarlyDrop deaths. A
// recycle is the same reconnect the client already does, except it happens on our
// schedule: only when no command is running, so nothing is ever interrupted, and
// early enough that the wall clock never fires first.
//
// WHY 120 seconds. Thirty seconds of margin under the observed limit, and short
// enough that a command landing in the few seconds of reconnect waits only for the
// drain that picks it up rather than for a surprise.

const RECYCLE_AGE_MS = 120000;

// WHY A BOUND ON EXECUTION. The drain runs one command at a time, so a CDP
// call that never settled held the queue for good and no completion ever went
// out: the caller waited its whole budget and learned nothing. The bound is
// past any honest browser call, short of the command TTL the server applies,
// and a function so a test can shorten it instead of waiting a minute.

const DEFAULT_EXECUTE_TIMEOUT_MS = 45000;

export function executeBoundMs() {
  return Number(globalThis.OPERA_SOCKET_EXECUTE_TIMEOUT_MS ?? DEFAULT_EXECUTE_TIMEOUT_MS);
}

export async function withExecuteTimeout(run, command) {
  const ms = executeBoundMs();
  let timer = null;
  const bound = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from the tab within ${ms} ms`)), ms);
  });
  return Promise.race([Promise.resolve(run(command)).finally(() => clearTimeout(timer)), bound]);
}

export function createSocketClient({
  url,
  token,
  deviceName,
  execute,
  onState = () => {},
  WebSocketImpl = globalThis.WebSocket,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  setWatchTimer = setTimer
} = {}) {
  let socket = null;
  let ready = false;
  let retryMs = BASE_RETRY_MS;
  let generation = 0;
  let closedByUs = false;
  let lastHeardAt = 0;
  let connectedAt = 0;
  const takeQueue = [];
  let draining = false;

  const heard = () => {
    lastHeardAt = now();
  };

  const replaceSocket = (event) => {
    generation += 1;
    const dead = socket;
    socket = null;
    ready = false;
    onState(event);
    closeSocket(dead);
    connect();
  };

  const watch = () => {
    if (closedByUs) return;
    if (ready && lastHeardAt && now() - lastHeardAt > SILENCE_LIMIT_MS) {
      replaceSocket({ status: 'stale', silenceMs: now() - lastHeardAt });
    } else if (ready && connectedAt && !draining && takeQueue.length === 0
      && now() - connectedAt > RECYCLE_AGE_MS) {
      replaceSocket({ status: 'recycling', ageMs: now() - connectedAt });
    }
    setWatchTimer(watch, WATCHDOG_MS);
  };

  const frame = (text) => {
    if (socket && socket.readyState === 1) socket.send(text);
  };

  const sendFrame = (text) => {
    try {
      frame(text);
    } catch { }
  };

  const closeSocket = (target) => {
    if (!target) return;
    try {
      if (target.readyState === 0 || target.readyState === 1) target.close();
    } catch { }
  };

  const scheduleRetry = (gen) => {
    if (closedByUs) return;
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    setTimer(() => { if (gen === generation) connect(); }, wait);
  };

  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (takeQueue.length) {
        const command = takeQueue.shift();
        if (!command || typeof command !== 'object') {
          onState({ status: 'skipped', reason: 'queue entry was not a command' });
          continue;
        }
        let outcome;
        try {
          outcome = await withExecuteTimeout(execute, command);
        } catch (error) {
          outcome = { ok: false, error: { code: 'EXECUTION_ERROR', message: String(error?.message || error).slice(0, 300) } };
        }
        try {
          sendFrame(completionFrame(
            command.id,
            outcome?.ok !== false,
            outcome?.result ?? outcome,
            outcome?.error
          ));
        } catch (error) {
          onState({ status: 'unsent', id: command.id, message: String(error?.message || error).slice(0, 200) });
        }
      }
    } finally {
      draining = false;
    }
  };

  function connect() {
    if (closedByUs) return;
    const gen = generation;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;

    onState({ status: 'connecting' });
    let next;
    try {
      next = new WebSocketImpl(url);
    } catch {
      onState({ status: 'unreachable' });
      scheduleRetry(gen);
      return;
    }
    socket = next;

    next.onopen = () => {
      heard();
      connectedAt = now();
      frame(handshakeFrame(token, deviceName));
    };

    next.onmessage = (event) => {
      heard();
      const parsed = parseFrame(event?.data);
      if (!parsed.ok) return;

      const message = parsed.message;
      if (message.type === 'ping') {
        frame(pongFrame());
        return;
      }

      if (message.type === 'error') {
        onState({ status: 'error', message: String(message.error || 'bridge error').slice(0, 200) });
        return;
      }

      if (isReady(message)) {
        ready = true;
        retryMs = BASE_RETRY_MS;
        onState({ status: 'connected' });
        void drain();
        return;
      }

      if (!isRunnableCommand(message)) return;
      if (!ready) return;

      const command = normalizeCommand(message);
      if (command?.id) takeQueue.push(command);
      void drain();
    };

    next.onclose = (event) => {
      if (gen !== generation) return;
      socket = null;
      ready = false;
      const code = Number(event?.code ?? 0);
      const reason = String(event?.reason || '').slice(0, 200);
      if (isFatalClose(code)) {
        closedByUs = true;
        onState({ status: 'rejected', code, reason });
        return;
      }
      onState({ status: 'reconnecting', code, reason });
      scheduleRetry(gen);
    };

    next.onerror = () => {
      if (gen !== generation) return;
      ready = false;
    };
  }

  function start() {
    closedByUs = false;
    lastHeardAt = 0;
    connect();
    watch();
  }

  function stop() {
    closedByUs = true;
    generation += 1;
    ready = false;
    takeQueue.length = 0;
    closeSocket(socket);
    socket = null;
    onState({ status: 'stopped' });
  }

  return {
    start,
    stop,
    send: (text) => {
      if (!ready) return false;
      frame(text);
      return true;
    },
    isReady: () => ready,
    isOpen: () => Boolean(socket && socket.readyState === 1)
  };
}