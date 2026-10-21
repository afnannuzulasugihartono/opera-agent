// bridge-server — the loopback command server, speaking the same frames the cloud bridge speaks, so the device runs one client and one drain instead of a socket road plus a long-poll road with its own wedge and its own failures.

// WHY THE HEARTBEAT IS THE WHOLE POINT.
// Chrome ends an idle service worker after about thirty seconds and an inbound frame does not wake it, which is why the first loopback socket read as OPEN and heard nothing.
// A ping that asks nothing resets that timer, so the socket stays live without asking for work.
// The loopback port binds to 127.0.0.1 only: this server hands commands to the browser sitting on this machine and must never be reachable from the network.

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';

import { parseFrame } from '../extension/lib/socket-protocol.js';
import { BridgeSocket, acceptKey, encodeText, isOriginAllowed, isWebSocketUpgrade } from './ws-server.js';

const DEVICE_PROTOCOL_VERSION = 1;
const HEARTBEAT_MS = 20000;
const HEARTBEAT_PAYLOAD = JSON.stringify({ type: 'ping' });

// WHY IDLENESS IS MEASURED FROM THE LAST WORD, NOT THE HELLO.
// The reap used to read the connection clock: any socket older than two minutes died whether it was mid-drive or long gone, and whatever call was in flight died with it as "still in flight when the device disconnected".
// Measured live as disconnects striking busy workers at random.
// The last-heard clock was already maintained for the health report; the reap reads it now, so only silence is reaped and traffic never is.

const IDLE_SOCKET_MS = 120000;

// WHY LISTEN BEFORE THE 101.
// A device can send its hello in the same tick it reads the handshake response, and a listener attached after the write loses exactly that first frame: the server waits for a hello that already arrived and never spoke.
// So the socket and its listeners exist first, and only then does the handshake go out.

// WHY A COMMAND TIMES OUT HERE.
// A command is enqueued, pushed the moment the device is ready, and settles on its completion frame.
// A device that never answers fails at the caller, named by method and budget, instead of inside a held request that nobody is reading and nobody can cancel.

// WHY THE EXTENSION ORIGINS ARE NAMED HERE.
// Chrome sends `chrome-extension://<id>` as the Origin of a WebSocket opened from an MV3 service worker.
// A server that allows only localhost therefore refuses the one client that is meant to connect, and nothing notices: a Node client sends no Origin at all, so every test stays green while the browser is dead.
// These two ids are the whole installed fleet - the CRX signing key moved, so an install that has not been replaced still presents the old one - and tests/local-bridge.test.mjs asserts the real header against this list.

// WHY NO WILDCARD.
// Any page on this machine can open a socket to 127.0.0.1, and one that gets through drives the browser as if the person asked it to.
// The list is the whole boundary.

const BRIDGE_ORIGINS = Object.freeze([
  'localhost',
  '127.0.0.1',
  'chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl',
  'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick'
]);

// WHY THE SERVER KEEPS A LIST OF ITS OWN SOCKETS.
// Node detaches an upgraded socket from its connection tracking, so `server.close()` keeps waiting on a socket it can no longer see and `closeAllConnections()` cannot reach it.
// Measured: an upgraded socket whose peer vanished left the server counting one connection forever, and close never called back — a driver shutdown hanging on a bridge nobody is using.
// This server accepts these sockets, so this server ends them, by destroying rather than ending: a polite end waits for a FIN the peer may never send.
// It also ends the socket a reconnect replaced — one device, one socket is the design, and an orphan left counting against the listener is enough to make a shutdown hang with nothing left to drive.

// WHY NOTHING IS PUSHED BEFORE THE HANDSHAKE.
// The device refuses a command it has not been given a `ready` for — deliberately, so work never runs against an unproven identity — and it refuses it by dropping the frame in silence.
// A server that pushed the moment the socket attached lost the first command of every connection, in a window a few milliseconds wide and invisible from the caller's side: the call simply never answered.
// Measured as one failed test in three full-suite runs.
// The queue is the honest place for that command, and `flush` sends it the instant the handshake lands.

// WHY THERE IS A DOOR IN THE LOOPBACK WALL.
// One server owns the device socket, and a second driver on this machine had nowhere to go: it lost the port, and the whole session's tools failed by name on every call.
// The command door lets a second process drive the same browser instead of refusing to live.
// It binds to 127.0.0.1 only, exactly like the socket beside it: whoever is already on this machine may drive this machine's browser, which is what that socket already allowed.

// WHY THE ANSWER OVER THE DOOR IS THE SETTLED ENVELOPE, UNWRAPPED.
// A door that re-wrapped `{ ok, result }` inside another `{ ok, result }` made every adopted caller read a proof ping as a failed ping, so a second driver could never talk to a bridge it had reached.
// Over the door the answer is the answer in process, byte for byte.

export function createBridgeServer({
  port = 9451,
  host = '127.0.0.1',
  allowedOrigins = BRIDGE_ORIGINS,
  heartbeatMs = HEARTBEAT_MS,
  now = () => Date.now()
} = {}) {
  const state = new EventEmitter();
  const devices = new Map();
  const waiting = new Map();
  const queue = [];
  const attached = new Set();
  let socket = null;
  let handshaken = false;
  let connectedAt = 0;
  let lastHeardAt = 0;
  let timer = null;

  function send(text) {
    return socket ? socket.send(text) : false;
  }

  function deliver(command) {
    if (!socket || socket.closed || !handshaken) return false;
    return send(JSON.stringify({ type: 'command', command }));
  }

  function attach(next, request) {
    if (socket && socket !== next) socket.close(1000);
    socket = next;
    handshaken = false;
    connectedAt = now();
    lastHeardAt = now();
    attached.add(next);
    devices.set(next.id, { id: next.id, connectedAt });

    next.on('text', (raw) => {
      lastHeardAt = now();
      const parsed = parseFrame(raw);
      if (!parsed.ok) return;
      const message = parsed.message;
      if (message.type === 'hello') {
        handshaken = true;
        send(JSON.stringify({ type: 'ready', protocolVersion: DEVICE_PROTOCOL_VERSION, serverTime: now() }));
        flush();
        return;
      }
      if (message.type === 'pong') return;
      if (message.type !== 'complete') return;

      const entry = waiting.get(String(message.commandId));
      if (!entry) return;
      waiting.delete(String(message.commandId));
      entry.resolve(message.ok === true
        ? { ok: true, result: message.result ?? {}, ms: now() - entry.sentAt }
        : { ok: false, error: message.error ?? { code: 'EXECUTION_ERROR', message: 'Command failed.' }, ms: now() - entry.sentAt });
    });

    next.on('close', () => {
      attached.delete(next);
      if (socket !== next) return;
      socket = null;
      handshaken = false;
      connectedAt = 0;
      devices.delete(next.id);
      state.emit('state', { status: 'disconnected' });
      for (const entry of waiting.values()) {
        entry.reject(new Error(`${entry.method} was still in flight when the device disconnected`));
      }
      waiting.clear();
    });

    state.emit('state', { status: 'ready', id: next.id });
  }

  function flush() {
    while (queue.length) {
      if (!deliver(queue[0])) break;
      queue.shift();
    }
  }

  function command(method, params = {}, { timeoutMs = 60000 } = {}) {
    const id = `${now().toString(36)}-${randomUUID().slice(0, 13)}`;
    const frame = { id, method, params, timeoutMs };
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, method, sentAt: now() };
      waiting.set(id, entry);
      queue.push(frame);
      flush();
      setTimeout(() => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        const index = queue.findIndex((item) => item.id === id);
        if (index >= 0) queue.splice(index, 1);
        reject(new Error(`no answer for ${method} within ${timeoutMs} ms`));
      }, timeoutMs + 500).unref?.();
    });
  }

  const heartbeat = () => {
    if (socket && !socket.closed) send(HEARTBEAT_PAYLOAD);
    if (socket && lastHeardAt && now() - lastHeardAt > IDLE_SOCKET_MS) {
      socket.close(1001);
      return;
    }
    timer = setTimeout(heartbeat, heartbeatMs);
  };

  const readJson = (req) => new Promise((resolve) => {
    let body = '';
    req.on('data', (piece) => { body += piece; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve(null);
      }
    });
  });

  const json = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        linked: Boolean(socket && !socket.closed),
        deviceId: socket ? socket.id : null,
        queued: queue.length,
        waiting: waiting.size,
        lastHeardMsAgo: lastHeardAt ? now() - lastHeardAt : null
      }));
      return;
    }
    if (req.method === 'POST' && req.url === '/command') {
      void (async () => {
        const body = await readJson(req);
        if (!body?.method) {
          json(res, 400, { ok: false, error: { message: 'a command needs a method' } });
          return;
        }
                const timeoutMs = Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : 60000;
        try {
          json(res, 200, await command(body.method, body.params ?? {}, { timeoutMs }));
        } catch (error) {
          json(res, 200, { ok: false, error: { message: String(error?.message ?? error) } });
        }
      })();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socketHandle, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!isWebSocketUpgrade(req) || !key || !isOriginAllowed(req.headers.origin, allowedOrigins)) {
      socketHandle.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socketHandle.destroy();
      return;
    }
    const next = new BridgeSocket(socketHandle, req);
    attach(next, req);
    socketHandle.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '', ''
    ].join('\r\n'));
    if (head?.length) next.read(head);
    clearTimeout(timer);
    timer = setTimeout(heartbeat, heartbeatMs);
  });

  return {
    address() {
      const bound = server.address();
      return bound ? { port: bound.port, host: bound.address } : null;
    },
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      const bound = server.address();
      return { port: bound.port, host: bound.address };
    },
    async close() {
      clearTimeout(timer);
      for (const open of attached) open.socket.destroy();
      attached.clear();
      socket = null;
      await new Promise((resolve) => server.close(resolve));
    },
    linked() {
      return Boolean(socket && !socket.closed);
    },
    send: (method, params, options) => command(method, params, options),
    on: (event, handler) => state.on(event, handler),
    state: () => ({
      linked: Boolean(socket && !socket.closed),
      deviceId: socket ? socket.id : null,
      queued: queue.length,
      waiting: waiting.size,
      lastHeardMsAgo: lastHeardAt ? now() - lastHeardAt : null
    })
  };
}

export { encodeText };
