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
// WHY the heartbeat is answered in JavaScript, not in the protocol. An MV3
// worker that hears nothing for thirty seconds is retired, and Chrome keeps its
// WebSocket open afterwards: the TCP connection survives, the browser still
// answers RFC pings in the network layer, and every frame that arrives goes to a
// message loop that no longer exists. A protocol ping cannot tell the difference
// — it is answered whether or not a single line of worker code is still running —
// so the worker pings with a real frame every fifteen seconds and this file
// answers it. Observed live as the bug this replaced: a link that had answered
// nine pongs in a row and then ignored a command for thirty seconds.
//
// WHY every command is proved before it is sent. The same zombie link reads as
// connected from here, so the question worth asking first is a cheap one.
// Waiting a second and learning the truth beats waiting thirty and learning it
// the hard way, and it turns a hung driver into a driver that recovers.
//
// WHAT IT DELIBERATELY DOES NOT DO. No CDP events cross: nothing above
// subscribes to any, so the demultiplexer answers replies and drops the rest.
// No auth beyond loopback: the debugging port this stands in for never had any.

import { createWsBridge, LINK_ERROR } from './ws-server.js';

const DEFAULT_BRIDGE_PORT = 9451;
const REPLY_TIMEOUT_MS = 30000;
const HEARTBEAT_MS = 20000;
const PING_TIMEOUT_MS = 1500;
const NOT_LINKED = LINK_ERROR;

export function bridgePort() {
  return Number(process.env.OPERA_BRIDGE_PORT || DEFAULT_BRIDGE_PORT);
}

let server = null;
let heartbeat = null;
let nextId = 1;
const pending = new Map();
const routers = new Map();

// WHY pings are answered here and not left to the caller. The extension pings
// every fifteen seconds because that traffic is what keeps its service worker
// alive; if this side dropped those frames the worker would retire with its
// socket still open and the next real command would go unanswered forever. The
// answer is one line and it is the reason the whole transport is usable.

function isHeartbeat(message) {
  return message?.bridge === 'ping';
}

function handleReply(text) {
  let message;
  try {
    message = JSON.parse(String(text));
  } catch {
    return;
  }
  if (isHeartbeat(message)) {
    server?.send(JSON.stringify({ id: message.id, result: { pong: true } }));
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
  return attempt(message, timeoutMs, false);
}

// WHY every command is proved before it is sent. Chrome keeps a service
// worker's WebSocket open after the worker behind it is gone, so a link can sit
// there looking established and answer nothing. Asking it a cheap question first
// costs a millisecond and turns a thirty-second mystery into a millisecond
// certainty, which is the difference between a driver that recovers by itself
// and one that hangs until the person gives up.

async function attempt(message, timeoutMs, retried) {
  if (!server.linked() && !(await server.waitForLink({ timeoutMs: 30000 }))) {
    throw new Error(NOT_LINKED);
  }
  try {
    const pong = await roundTrip({ bridge: 'ping' }, PING_TIMEOUT_MS);
    if (pong?.pong !== true) throw new Error('bridge: link answered the liveness ping with something else');
    return await roundTrip(message, timeoutMs);
  } catch (error) {
    if (retried || !/no answer for/.test(error?.message ?? '')) throw error;
    server.dropLink();
    if (!(await server.waitForLink({ timeoutMs: 45000 }))) throw new Error(NOT_LINKED);
    return attempt(message, timeoutMs, true);
  }
}

function roundTrip(message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const run = async () => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error(`bridge: no answer for ${isHeartbeat(message) ? 'the liveness ping' : message.tabs ? 'tabs.' + message.tabs.op : message.method} in ${timeoutMs} ms`));
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

export async function listBridgeTargets({ timeoutMs } = {}) {
  await ensureServer();
  const tabs = await request({ tabs: { op: 'list' } }, ...(timeoutMs === undefined ? [] : [{ timeoutMs }]));
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
      if (!server || !server.linked()) throw new Error(NOT_LINKED);
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
