// @last-edited: 2026-11-09 UTC+7.
// @title: bridge-ws — the loopback command server, speaking the frames the cloud bridge speaks.
// @state: every browser that connects is carried, each target names its browser, each command reaches the one that owns it, and each session pays the cloud its allowance.
// @dependencies: node:crypto, node:http, node:events, ./ws-server.js, ./leases.js, ./lib/*.

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
import { DEFAULT_BRIDGE_URL } from './lib/endpoints.js';
import { BridgeSocket, acceptKey, encodeText, isOriginAllowed, isWebSocketUpgrade } from './ws-server.js';
import { createLeaseTable } from './leases.js';
import { DEVICE_PROTOCOL_VERSION } from './lib/socket-protocol.js';

const SLOT_STRIDE = 1000000000;

// WHY THE METER IS A CLOUD CALL AND NOT A LOCAL GUESS.
// The local drive is on the same machine as the caller, so it cannot tell a paid account from a stranger by looking inward.
// It asks the cloud once per session and enforces what it is told; a local limit would be a number anyone with the source could edit, which is a gate that holds nothing.
// The transport and the allowance are exactly what the extension already speaks to the cloud bridge, so nobody learns a second protocol.

const CLOUD_TIMEOUT_MS = 10000;
const METER_WINDOW_MS = 60000;

export function createCloudMeter({ url = process.env.OPERA_CLOUD_URL || DEFAULT_BRIDGE_URL, fetchImpl = fetch, timeoutMs = CLOUD_TIMEOUT_MS } = {}) {
  const post = async (body) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const answer = await response.json().catch(() => null);
    if (!response.ok) throw new Error(answer?.error || `the cloud answered ${response.status}`);
    return answer;
  };
  return {
    sessionOpen: ({ deviceName, token }) => post({ action: 'session_open', deviceName, token }),
    sessionReport: ({ deviceName, token, commands }) => post({ action: 'session_report', deviceName, token, commands })
  };
}

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

export function createBridgeServer({ port = 9451, host = '127.0.0.1', heartbeatMs = 20000, allowedOrigins = BRIDGE_ORIGINS, now = () => Date.now(), cloud = createCloudMeter() } = {}) {
  const state = new EventEmitter();
  const devices = new Map();
  const attached = new Set();
  const leases = createLeaseTable();
  const queue = [];
  const waiting = new Map();
  let slotCounter = 0;
  let timer = null;
  let lastRefusal = null;
  const pendingReports = new Set();

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

  // WHY A TOKEN IS TAKEN AT THE SOCKET, NOT AT THE DOOR.
  // Every path that hands a command to a device passes through this point: the routed call, the merged list, the queued backlog.
  // A token spent here means a queued command cannot be delivered without paying for it, so nobody rides the queue for free.
  // The ping proof pays nothing: it is the bridge's own liveness question, not the caller's work.

  const refusalFor = (device) => ({
    ok: false,
    error: {
      code: 'PLAN_LIMIT_REACHED',
      message: `the session allowance of ${device.meter?.allowance ?? 0} commands for ${device.meter?.plan ?? 'plan.pilot'} is spent; reconnect to start a new session`
    }
  });

  const takeToken = (device, method) => {
    if (method === 'ping') return null;
    if (!device.meter || device.meter.sent >= device.meter.allowance) return refusalFor(device);
    device.meter.sent += 1;
    return null;
  };

  // WHY ONE REPORT, AT THE END.
  // The drive counts locally because the local road cannot pay for a round trip per command.
  // The one report at the end is what folds the local spend back into the account's daily count, so the local road is not a bypass of the shared quota.
  function reportSession(device) {
    const meter = device.meter;
    if (!meter || meter.reported || meter.sent === 0) return;
    meter.reported = true;
    const pending = Promise.resolve()
      .then(() => cloud.sessionReport({ deviceName: meter.deviceName, token: meter.token, commands: meter.sent }))
      .catch((error) => {
        state.emit('state', { status: 'meter-report-failed', message: String(error?.message ?? error).slice(0, 200) });
      })
      .finally(() => pendingReports.delete(pending));
    pendingReports.add(pending);
  }

  function noteRefusal(message) {
    lastRefusal = { message, at: now() };
    state.emit('state', { status: 'refused', message });
  }

  // WHY THE SESSION IS METERED AT HELLO, NOT AT THE FIRST COMMAND.
  // The cloud is the only party that knows this account's plan and today's spend, and the local drive cannot learn it by looking inward.
  // Asking once per session and enforcing the answer locally keeps the drive at millisecond cost while the allowance bounds what an unmetered session may do.
  async function meterSession(device, message) {
    const identity = {
      deviceName: String(message.deviceName || '').trim().slice(0, 128),
      token: String(message.token || '')
    };
    let opened = null;
    let failure = null;
    try {
      opened = await cloud.sessionOpen(identity);
    } catch (error) {
      failure = String(error?.message ?? error);
    }
    if (device.socket.closed) return;
    const refusal = failure
      ? `the meter could not be reached: ${failure}`
      : (!opened || opened.ok !== true || opened.status !== 'active')
        ? `the meter refused the session: ${String(opened?.message ?? opened?.error ?? 'the account has no active plan')}`
        : null;
    if (refusal) {
      device.socket.send(JSON.stringify({ type: 'error', error: refusal }));
      device.socket.close(4001, 'the meter refused the session');
      noteRefusal(refusal);
      return;
    }
    device.verifying = false;
    device.meter = {
      deviceName: identity.deviceName,
      token: identity.token,
      plan: String(opened.plan ?? 'plan.pilot'),
      allowance: Math.max(0, Number(opened.sessionAllowance) || 0),
      dailyQuota: Math.max(0, Number(opened.dailyQuota) || 0),
      sent: 0,
      usedToday: Number(opened.usedToday) || 0,
      reported: false
    };
    device.handshaken = true;
    device.verifying = false;
    device.lastHeardAt = now();
    if (!device.socket.closed) device.socket.send(JSON.stringify({ type: 'ready', protocolVersion: DEVICE_PROTOCOL_VERSION, serverTime: now() }));
    flush();
  }

  const meterOf = (device) => (device.meter
    ? { plan: device.meter.plan, allowance: device.meter.allowance, dailyQuota: device.meter.dailyQuota, sent: device.meter.sent, usedToday: device.meter.usedToday, remaining: Math.max(0, device.meter.dailyQuota - device.meter.usedToday - device.meter.sent) }
    : null);

  const refusalNote = () => (lastRefusal && now() - lastRefusal.at <= METER_WINDOW_MS ? lastRefusal.message : null);

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
      const waiter = waiting.get(frame.id);
      const refusal = takeToken(target, frame.method);
      if (refusal) {
        if (waiter) {
          waiting.delete(frame.id);
          waiter.resolve({ ...refusal, ms: now() - waiter.sentAt });
        }
        continue;
      }
      if (!sendTo(target, JSON.stringify({ type: 'command', command: toWire(frame) }))) {
        if (waiter) {
          waiting.delete(frame.id);
          waiter.reject(new Error('the device socket is closed'));
        }
      }
    }
  }

  // The id generator is shared so the clock format cannot drift between the two command doors.
  function commandId() {
    return `${now().toString(36)}-${randomUUID().slice(0, 13)}`;
  }

  function armTimeout(id, method, timeoutMs, reject) {
    setTimeout(() => {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      const index = queue.findIndex((item) => item.id === id);
      if (index >= 0) queue.splice(index, 1);
      reject(new Error(`no answer for ${method} within ${timeoutMs} ms`));
    }, timeoutMs + 500).unref?.();
  }

  function registerWait(device, id, method, resolve, reject) {
    waiting.set(id, { resolve, reject, method, deviceId: device ? device.id : null, sentAt: now() });
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
    const id = commandId();
    const frame = { id, method, params, timeoutMs };
    return new Promise((resolve, reject) => {
      const device = pickDevice(params);
      registerWait(device, id, method, resolve, reject);
      if (device) {
        const refusal = takeToken(device, method);
        if (refusal) {
          const entry = waiting.get(id);
          waiting.delete(id);
          resolve({ ...refusal, ms: entry ? now() - entry.sentAt : 0 });
          return;
        }
        if (!sendTo(device, JSON.stringify({ type: 'command', command: toWire(frame) }))) {
          waiting.delete(id);
          reject(new Error('the device socket is closed'));
          return;
        }
      } else {
        queue.push(frame);
        flush();
      }
      armTimeout(id, method, timeoutMs, reject);
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
    const id = commandId();
    const frame = { id, method, params, timeoutMs };
    return new Promise((resolve, reject) => {
      const refusal = takeToken(device, method);
      if (refusal) {
        resolve({ ...refusal, ms: 0 });
        return;
      }
      registerWait(device, id, method, resolve, reject);
      if (!sendTo(device, JSON.stringify({ type: 'command', command: frame }))) {
        waiting.delete(id);
        reject(new Error('the device socket is closed'));
        return;
      }
      armTimeout(id, method, timeoutMs, reject);
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
        devices: live.map((device) => ({ slot: device.slot, id: device.id, instanceId: device.instanceId || null, deviceName: device.deviceName || null, extensionVersion: device.extensionVersion || null, connectedAt: device.connectedAt, meter: meterOf(device) })),
        queued: queue.length,
        waiting: waiting.size,
        lastHeardMsAgo: live[0]?.lastHeardAt ? now() - live[0].lastHeardAt : null,
        meterRefusal: refusalNote()
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
        device.deviceName = String(message.deviceName || '').trim().slice(0, 128) || null;
        device.extensionVersion = String(message.extensionVersion || '').slice(0, 32);
        if (device.handshaken) {
          if (!device.socket.closed) device.socket.send(JSON.stringify({ type: 'ready', protocolVersion: DEVICE_PROTOCOL_VERSION, serverTime: now() }));
          return;
        }
        if (device.verifying) return;
        device.verifying = true;
        void meterSession(device, message);
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
      reportSession(device);
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
      for (const device of [...devices.values()]) reportSession(device);
      await Promise.allSettled([...pendingReports]);
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
      devices: readyDevices().map((device) => ({ slot: device.slot, id: device.id, instanceId: device.instanceId || null, deviceName: device.deviceName || null, meter: meterOf(device) })),
      queued: queue.length,
      waiting: waiting.size,
      lastHeardMsAgo: readyDevices()[0]?.lastHeardAt ? now() - readyDevices()[0].lastHeardAt : null,
      meterRefusal: refusalNote()
    })
  };
}

export { encodeText };
