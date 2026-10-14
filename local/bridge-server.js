// bridge-server — the loopback command server, speaking the same frames the
// cloud bridge speaks, so the device runs one client and one drain instead of
// a socket road plus a long-poll road with its own wedge and its own failures.
//
// WHY THE HEARTBEAT IS THE WHOLE POINT. Chrome ends an idle service worker
// after about thirty seconds and an inbound frame does not wake it, which is
// why the first loopback socket read as OPEN and heard nothing. A ping that
// asks nothing resets that timer, so the socket stays live without asking for
// work. The loopback port binds to 127.0.0.1 only: this server hands commands
// to the browser sitting on this machine and must never be reachable from the
// network.

import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';

import { parseFrame } from '../extension/lib/socket-protocol.js';
import { BridgeSocket, acceptKey, encodeText, isOriginAllowed, isWebSocketUpgrade } from './ws-server.js';

const DEVICE_PROTOCOL_VERSION = 1;
const HEARTBEAT_MS = 20000;
const HEARTBEAT_PAYLOAD = JSON.stringify({ type: 'ping' });
const IDLE_SOCKET_MS = 120000;

// WHY LISTEN BEFORE THE 101. A device can send its hello in the same tick it
// reads the handshake response, and a listener attached after the write loses
// exactly that first frame: the server waits for a hello that already arrived
// and never spoke. So the socket and its listeners exist first, and only then
// does the handshake go out.
//
// WHY A COMMAND TIMES OUT HERE. A command is enqueued, pushed the moment the
// device is ready, and settles on its completion frame. A device that never
// answers fails at the caller, named by method and budget, instead of inside a
// held request that nobody is reading and nobody can cancel.

export function createBridgeServer({
  port = 9451,
  host = '127.0.0.1',
  allowedOrigins = ['localhost', '127.0.0.1'],
  heartbeatMs = HEARTBEAT_MS,
  now = () => Date.now()
} = {}) {
  const state = new EventEmitter();
  const devices = new Map();
  const waiting = new Map();
  const queue = [];
  let socket = null;
  let connectedAt = 0;
  let lastHeardAt = 0;
  let timer = null;

  function send(text) {
    return socket ? socket.send(text) : false;
  }

  function deliver(command) {
    if (!socket || socket.closed) return false;
    return send(JSON.stringify({ type: 'command', command }));
  }

  function attach(next, request) {
    socket = next;
    connectedAt = now();
    lastHeardAt = now();
    devices.set(next.id, { id: next.id, connectedAt });

    next.on('text', (raw) => {
      lastHeardAt = now();
      const parsed = parseFrame(raw);
      if (!parsed.ok) return;
      const message = parsed.message;
      if (message.type === 'hello') {
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
      if (socket !== next) return;
      socket = null;
      connectedAt = 0;
      devices.delete(next.id);
      state.emit('state', { status: 'disconnected' });
      for (const entry of waiting.values()) {
        entry.reject(new Error('device disconnected before it answered'));
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

  const heartbeat = () => {
    if (socket && !socket.closed) send(HEARTBEAT_PAYLOAD);
    if (socket && connectedAt && now() - connectedAt > IDLE_SOCKET_MS) {
      socket.close(1001);
      return;
    }
    timer = setTimeout(heartbeat, heartbeatMs);
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
      if (socket) socket.close(1001);
      await new Promise((resolve) => server.close(resolve));
    },
    linked() {
      return Boolean(socket && !socket.closed);
    },
    send(method, params = {}, { timeoutMs = 60000 } = {}) {
      const id = `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const command = { id, method, params, timeoutMs };
      return new Promise((resolve, reject) => {
        const entry = { resolve, reject, sentAt: now() };
        waiting.set(id, entry);
        queue.push(command);
        flush();
        setTimeout(() => {
          if (!waiting.has(id)) return;
          waiting.delete(id);
          const index = queue.findIndex((item) => item.id === id);
          if (index >= 0) queue.splice(index, 1);
          reject(new Error(`no answer for ${method} within ${timeoutMs} ms`));
        }, timeoutMs + 500).unref?.();
      });
    },
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
