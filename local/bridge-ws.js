// @last-edited: 2026-11-09 UTC+7.
// @title: bridge-ws — the loopback command server, speaking the frames the cloud bridge speaks.
// @state: every browser that connects is carried, each target names its browser, and each command reaches the one that owns it.
// @dependencies: none.

// WHY THE HEARTBEAT IS THE WHOLE POINT.
// Chrome ends an idle service worker after about thirty seconds and an inbound frame does not wake it, which is why the first loopback socket read as OPEN and heard nothing.
// A ping that asks nothing resets that timer, so the socket stays live without asking for work.
// The loopback port binds to 127.0.0.1 only: this server hands commands to the browser sitting on this machine and must never be reachable from the network.

// WHY EVERY BROWSER ON THE MACHINE IS CARRIED.
// Two browsers used to fight over one device slot, so the second one to connect was closed out and the first was told nothing about it.
// A browser is now a device the server keeps, and a device leaves only when it leaves.

// WHY A TARGET ID IS NAMESPACED BY SLOT.
// Every browser numbers its tabs from one, so two browsers hand out the same target for different pages.
// The driver parses target ids as numbers, so the name must be a number too: the slot walks in the upper digits and the browser's own id in the lower ones.
// SLOT_STRIDE is a billion, far past any tab id a browser numbers in, so the digits never overlap.

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';

import { parseFrame } from './lib/socket-protocol.js';
import { BridgeSocket, acceptKey, encodeText, isOriginAllowed, isWebSocketUpgrade } from './ws-server.js';
import { createLeaseTable } from './leases.js';
import { DEVICE_PROTOCOL_VERSION } from './lib/socket-protocol.js';

const SLOT_STRIDE = 1000000000;
const slotOf = (tabId) => Math.floor(Number(tabId) / SLOT_STRIDE);
const localTabOf = (tabId) => {
  const slot = slotOf(tabId);
  return slot > 0 ? Number(tabId) - slot * SLOT_STRIDE : Number(tabId);
};

// The last-heard clock was already maintained for the health report; the reap reads it now, so only silence is reaped and traffic never is.

const IDLE_SOCKET_MS = 120000;
const HEARTBEAT_FRAME = JSON.stringify({ type: 'ping' });

const BRIDGE_ORIGINS = Object.freeze([
  'localhost',
  '127.0.0.1',
  'chrome-extension://ofgemipoobcnbjkfanmofjbdonjapmgl',
  'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick'
]);

export function createBridgeServer({ port = 9451, host = '127.0.0.1', heartbeatMs = 20000, allowedOrigins = BRIDGE_ORIGINS, now = () => Date.now() } = {}) {
  const state = new EventEmitter();
  const devices = new Map();
  const attached = new Set();
  const leases = createLeaseTable();
  const queue = [];
  const waiting = new Map();
  let slotCounter = 0;
  let timer = null;

  const readyDevices = () => [...devices.values()]
    .filter((device) => !device.socket.closed && device.handshaken)
    .sort((a, b) => a.slot - b.slot);

  const firstReady = () => readyDevices()[0] || null;

  const routedSlot = (params) => {
    const raw = params?.tabId;
    if (raw === undefined || raw === null || raw === '') return 0;
    const tabId = Number(raw);
    return Number.isInteger(tabId) ? slotOf(tabId) : 0;
  };

  const pickDevice = (params) => {
    const slot = routedSlot(params);
    if (slot > 0) return readyDevices().find((device) => device.slot === slot) || null;
    return firstReady();
  };

  const toWire = (frame) => {
    const params = frame.params && typeof frame.params === 'object' ? { ...frame.params } : {};
    if (Number.isInteger(Number(params.tabId)) && slotOf(params.tabId) > 0) {
      params.tabId = localTabOf(params.tabId);
    }
    return { ...frame, params };
  };

  const namespacedId = (device, localId) => device.slot * SLOT_STRIDE + Number(localId);

  function sendTo(device, text) {
    if (device.socket.closed) return false;
    return device.socket.send(text);
  }

  function flush() {
    while (queue.length) {
      const index = queue.findIndex((frame) => pickDevice(frame.params) !== null);
      if (index < 0) break;
      const [frame] = queue.splice(index, 1);
      const target = pickDevice(frame.params);
      sendTo(target, JSON.stringify({ type: 'command', command: toWire(frame) }));
    }
  }

  function waitForReady(timeoutMs) {
    const deadline = now() + timeoutMs;
    return new Promise((resolve) => {
      const poll = () => {
        const live = readyDevices();
        if (live.length || now() >= deadline) return resolve(live);
        setTimeout(poll, 15);
      };
      poll();
    });
  }

  function commandRaw(method, params, { timeoutMs } = {}) {
    const id = `${now().toString(36)}-${randomUUID().slice(0, 13)}`;
    const frame = { id, method, params, timeoutMs };
    return new Promise((resolve, reject) => {
      const device = pickDevice(params);
      const entry = { resolve, reject, method, deviceId: device ? device.id : null, sentAt: now() };
      if (device) {
        waiting.set(id, entry);
        if (!sendTo(device, JSON.stringify({ type: 'command', command: toWire(frame) }))) {
          waiting.delete(id);
          reject(new Error('the device socket is closed'));
          return;
        }
      } else {
        waiting.set(id, entry);
        queue.push(frame);
        flush();
      }
      setTimeout(() => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        const index = queue.findIndex((item) => item.id === id);
        if (index >= 0) queue.splice(index, 1);
        reject(new Error(`no answer for ${method} within ${timeoutMs} ms`));
      }, timeoutMs + 500).unref?.();
    });
  }

  // WHY THE LIST IS MERGED HERE AND NOT IN THE CALLER.
  // Two browsers have different tab counts and different numbering; the caller sees one list, with each row naming the browser it belongs to, and a browser that fails to answer is a failure and not an empty success.
  async function mergedTargets(timeoutMs) {
    const started = now();
    let live = readyDevices();
    if (!live.length) live = await waitForReady(timeoutMs);
    if (!live.length) throw new Error('no linked device answers tabs.list');
    const answers = await Promise.all(live.map((device) => commandToDevice(device, 'tabs.list', {}, timeoutMs)));
    for (const answer of answers) if (!answer.ok) return answer;
    return {
      ok: true,
      ms: now() - started,
      result: answers.flatMap((answer, index) => {
        const result = answer?.result;
        const items = Array.isArray(result) ? result : Array.isArray(result?.tabs) ? result.tabs : [];
        return items.map((tab) => ({ id: namespacedId(live[index], tab.id), url: tab.url ?? '', title: tab.title ?? '' }));
      })
    };
  }

  async function openedTarget(timeoutMs, params) {
    let live = readyDevices();
    if (!live.length) live = await waitForReady(timeoutMs);
    if (!live.length) throw new Error('no linked device answers tabs.open');
    const target = live[0];
    const opened = await commandToDevice(target, 'tabs.open', params, timeoutMs);
    if (!opened.ok) return opened;
    return { ok: true, result: { ...opened.result, id: namespacedId(target, opened.result?.id) }, ms: opened.ms };
  }

  // WHY THE LIST IS MERGED HERE AND NOT IN THE CALLER.
  // Two browsers have different tab counts and different numbering; the caller sees one list, with each row naming the browser it belongs to.
  // Opening a tab likewise answers with that browser's namespace, so the very same id drives the next command.
  async function command(method, params = {}, { timeoutMs = 60000 } = {}) {
    if (method === 'tabs.list') return mergedTargets(timeoutMs);
    if (method === 'tabs.open') return openedTarget(timeoutMs, params);
    return commandRaw(method, params, { timeoutMs });
  }

  function commandToDevice(device, method, params, timeoutMs) {
    const id = `${now().toString(36)}-${randomUUID().slice(0, 13)}`;
    const frame = { id, method, params, timeoutMs };
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, method, deviceId: device.id, sentAt: now() };
      waiting.set(id, entry);
      sendTo(device, JSON.stringify({ type: 'command', command: frame }));
      setTimeout(() => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        reject(new Error(`no answer for ${method} within ${timeoutMs} ms`));
      }, timeoutMs + 500).unref?.();
    });
  }

  const heartbeat = () => {
    for (const device of devices.values()) {
      if (device.socket.closed) continue;
      device.socket.send(HEARTBEAT_FRAME);
      if (device.lastHeardAt && now() - device.lastHeardAt > IDLE_SOCKET_MS) {
        device.socket.close(1001);
      }
    }
    timer = setTimeout(heartbeat, heartbeatMs);
  };

  const readJson = (req) => new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        resolve(null);
        return;
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
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
      const live = readyDevices();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        linked: live.length > 0,
        deviceId: live[0]?.id ?? null,
        deviceInstanceId: live[0]?.instanceId ?? null,
        devices: live.map((device) => ({ slot: device.slot, id: device.id, instanceId: device.instanceId || null, connectedAt: device.connectedAt })),
        queued: queue.length,
        waiting: waiting.size,
        lastHeardMsAgo: live[0]?.lastHeardAt ? now() - live[0].lastHeardAt : null
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
          const answer = await command(body.method, body.params ?? {}, { timeoutMs });
          json(res, 200, answer);
        } catch (error) {
          json(res, 200, { ok: false, error: { message: String(error?.message ?? error) } });
        }
      })();
      return;
    }

    // The lease door answers one ask per call: a claim, which the table grants or refuses, or a release, which only the owner that holds the tab may make.
    if (req.method === 'POST' && req.url === '/lease') {
      void (async () => {
        const body = await readJson(req);
        if (!body?.action || !body?.tabId || !body?.owner) {
          json(res, 400, { ok: false, error: { message: 'a lease needs an action, a tab and an owner' } });
          return;
        }
        try {
          if (body.action === 'release') {
            json(res, 200, { ok: true, granted: leases.release(body.tabId, body.owner), released: true });
            return;
          }
          json(res, 200, { ok: true, ...leases.claim(body.tabId, body.owner, body.ttlMs) });
        } catch (error) {
          json(res, 200, { ok: false, error: { message: String(error?.message ?? error) } });
        }
      })();
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
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

  function attach(next, request) {
    const slot = ++slotCounter;
    const device = { id: next.id, slot, socket: next, instanceId: '', handshaken: false, connectedAt: now(), lastHeardAt: now() };
    devices.set(next.id, device);
    attached.add(next);

    next.on('text', (raw) => {
      device.lastHeardAt = now();
      const parsed = parseFrame(raw);
      if (!parsed.ok) return;
      const message = parsed.message;
      if (message.type === 'hello') {
        device.instanceId = String(message.instanceId || device.id).slice(0, 64);
        device.handshaken = true;
        device.lastHeardAt = now();
        if (!device.socket.closed) device.socket.send(JSON.stringify({ type: 'ready', protocolVersion: DEVICE_PROTOCOL_VERSION, serverTime: now() }));
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
      devices.delete(next.id);
      state.emit('state', { status: 'disconnected' });
      for (const [id, entry] of waiting) {
        if (entry.deviceId === device.id) {
          entry.reject(new Error(`${entry.method} was still in flight when browser ${device.slot} disconnected`));
          waiting.delete(id);
        }
      }
    });

    state.emit('state', { status: 'ready', id: next.id });
  }

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
      devices.clear();
      await new Promise((resolve) => server.close(resolve));
    },
    linked() {
      return attached.size > 0;
    },
    leases,
    send: (method, params, options) => command(method, params ?? {}, options),
    on: (event, handler) => state.on(event, handler),
    state: () => ({
      linked: attached.size > 0,
      deviceId: readyDevices()[0]?.id ?? null,
      devices: readyDevices().map((device) => ({ slot: device.slot, id: device.id, instanceId: device.instanceId || null })),
      queued: queue.length,
      waiting: waiting.size,
      lastHeardMsAgo: readyDevices()[0]?.lastHeardAt ? now() - readyDevices()[0].lastHeardAt : null
    })
  };
}

export { encodeText };
