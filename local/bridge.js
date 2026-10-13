// @last-edited: 2026-10-13 UTC+7.
// @title: bridge — the local end of the extension bridge: CDP sessions over one socket.
// @state: server singleton, CDP-id translation, tab ops, warm heartbeat.
// @dependencies: ./ws-server.js.

// WHY THIS FILE EXISTS
//
// Chrome refuses a debugging port on the Default profile, so the local driver
// cannot reach the browser the person actually uses — and the relay road there
// costs ~2 s a call through Singapore. The extension holds the missing piece:
// debugger access to every tab it can see. This file is the other half of that
// conversation: a loopback WebSocket server the extension dials into, over which
// raw CDP frames travel addressed by numeric tab id.
//
// WHY the shapes mirror transport.js. A bridge session IS a CDP session that
// arrives over a different wire: list, open, close and connect keep their
// contracts, so the driver, the primitives and every test above them run
// unchanged and only this file knows the socket exists.
//
// WHY the heartbeat. An MV3 worker that hears nothing for thirty seconds stops
// existing, taking its side of the link with it. A ping every twenty seconds is
// traffic the worker must wake for, which is exactly what keeps the link warm
// while the agent works and costs nothing when it does not.
//
// WHAT IT DELIBERATELY DOES NOT DO. No CDP events cross: nothing above
// subscribes to any, so the demultiplexer answers replies and drops the rest.
// No auth beyond loopback: the debugging port this stands in for never had any.

import { createWsBridge } from './ws-server.js';

const DEFAULT_BRIDGE_PORT = 9451;
const REPLY_TIMEOUT_MS = 30000;
const HEARTBEAT_MS = 20000;

export function bridgePort() {
  return Number(process.env.OPERA_BRIDGE_PORT || DEFAULT_BRIDGE_PORT);
}

let server = null;
let heartbeat = null;
let nextId = 1;
const pending = new Map();
const routers = new Map();

function handleReply(text) {
  let message;
  try {
    message = JSON.parse(String(text));
  } catch {
    return;
  }
  const entry = pending.get(String(message?.id));
  if (!entry) return;
  pending.delete(String(message.id));
  entry.settle(message);
}

async function ensureServer() {
  if (!server) {
    server = createWsBridge({ port: bridgePort() });
    server.onMessage(handleReply);
    await server.listen();
    heartbeat = setInterval(() => {
      if (server?.linked()) {
        try {
          server.ping();
        } catch {}
      }
    }, HEARTBEAT_MS);
    if (heartbeat.unref) heartbeat.unref();
  }
  return server;
}

function request(message, { timeoutMs = REPLY_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const run = async () => {
      if (!server.linked() && !(await server.waitForLink({ timeoutMs: 30000 }))) {
        throw new Error('bridge: extension is not connected (reload it with the bridge running)');
      }
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error(`bridge: no answer for ${message.tabs ? 'tabs.' + message.tabs.op : message.method} in ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(String(id), {
        settle: (reply) => {
          clearTimeout(timer);
          if (reply?.error) reject(new Error(String(reply.error.message ?? 'bridge call failed')));
          else resolve(reply?.result ?? null);
        }
      });
      try {
        server.send(JSON.stringify({ ...message, id }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(String(id));
        reject(error);
      }
    };
    void run().catch(reject);
  });
}

export async function bridgeAddress() {
  const srv = await ensureServer();
  const addr = srv.address();
  return { port: typeof addr === 'object' && addr ? addr.port : bridgePort(), host: '127.0.0.1' };
}

export async function waitForBridgeLink({ timeoutMs = 15000 } = {}) {
  const srv = await ensureServer();
  return srv.waitForLink({ timeoutMs });
}

export async function listBridgeTargets() {
  await ensureServer();
  const tabs = await request({ tabs: { op: 'list' } });
  return (Array.isArray(tabs) ? tabs : []).map((t) => ({ id: t.id, url: t.url ?? '', title: t.title ?? '' }));
}

export async function openBridgeTarget(url) {
  await ensureServer();
  const tab = await request({ tabs: { op: 'open', url } });
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
}

export async function closeBridgeTarget(targetId) {
  await ensureServer();
  return request({ tabs: { op: 'close', tabId: Number(targetId) } });
}

export function connectBridgeTarget(targetId) {
  const tab = Number(targetId);
  return {
    send(raw) {
      let frame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        throw new Error('bridge: transport takes JSON CDP frames');
      }
      if (!server || !server.linked()) throw new Error('bridge: extension is not connected (reload it with the bridge running)');
      const id = nextId++;
      pending.set(String(id), {
        settle: (reply) => {
          const deliver = routers.get(tab);
          if (!deliver) return;
          const out = reply?.error
            ? { id: frame.id, error: reply.error }
            : { id: frame.id, result: reply?.result ?? null };
          deliver(JSON.stringify(out));
        }
      });
      try {
        server.send(JSON.stringify({ id, tab, method: frame.method, params: frame.params ?? {} }));
      } catch (error) {
        pending.delete(String(id));
        throw error;
      }
    },
    onMessage(fn) {
      routers.set(tab, fn);
    },
    close() {
      routers.delete(tab);
    }
  };
}

export async function closeBridge() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  for (const [, entry] of pending) entry.settle({ error: { message: 'bridge closed' } });
  pending.clear();
  routers.clear();
  if (server) await server.close();
  server = null;
}
