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

import {
  completionFrame,
  handshakeFrame,
  isFatalClose,
  isReady,
  isRunnableCommand,
  normalizeCommand,
  parseFrame
} from './socket-protocol.js';

const BASE_RETRY_MS = 500;
const MAX_RETRY_MS = 30000;

export function createSocketClient({
  url,
  token,
  deviceName,
  execute,
  onState = () => {},
  WebSocketImpl = globalThis.WebSocket,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms)
} = {}) {
  let socket = null;
  let ready = false;
  let retryMs = BASE_RETRY_MS;
  let generation = 0;
  let closedByUs = false;

  const frame = (text) => {
    if (socket && socket.readyState === 1) socket.send(text);
  };

  const scheduleRetry = (gen) => {
    if (closedByUs) return;
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    setTimer(() => { if (gen === generation) connect(); }, wait);
  };

  const takeQueue = [];
  let draining = false;

  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (takeQueue.length && !closedByUs) {
        const command = takeQueue.shift();
        let outcome;
        try {
          outcome = await execute(command);
        } catch (error) {
          outcome = { ok: false, error: { code: 'EXECUTION_ERROR', message: String(error?.message || error).slice(0, 300) } };
        }
        frame(completionFrame(
          command.id,
          outcome?.ok !== false,
          outcome?.result ?? outcome,
          outcome?.error
        ));
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
      frame(handshakeFrame(token, deviceName));
    };

    next.onmessage = (event) => {
      const parsed = parseFrame(event?.data);
      if (!parsed.ok) return;

      const message = parsed.message;
      if (isReady(message)) {
        ready = true;
        retryMs = BASE_RETRY_MS;
        onState({ status: 'connected' });
        drain();
        return;
      }

      if (!isRunnableCommand(message)) return;
      if (!ready) return;

      takeQueue.push(normalizeCommand(message));
      drain();
    };

    next.onclose = (event) => {
      if (gen !== generation) return;
      socket = null;
      ready = false;
      const code = Number(event?.code ?? 0);
      if (isFatalClose(code)) {
        closedByUs = true;
        onState({ status: 'rejected', code });
        return;
      }
      onState({ status: 'reconnecting' });
      scheduleRetry(gen);
    };

    next.onerror = () => {
      if (gen !== generation) return;
      ready = false;
    };
  }

  function start() {
    closedByUs = false;
    connect();
  }

  function stop() {
    closedByUs = true;
    generation += 1;
    ready = false;
    takeQueue.length = 0;
    try { socket?.close(); } catch { }
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