// @last-edited: 2026-10-13 UTC+7.
// @title: bridge — the local end of the extension bridge: CDP over one HTTP conversation.
// @state: server singleton, CDP-id translation, tab ops, liveness proof before every call.
// @dependencies: ./poll-server.js.

// WHY THIS FILE EXISTS
//
// Chrome refuses a debugging port on the Default profile, so the local driver
// cannot reach the browser the person actually uses — and the relay road there
// costs ~2 s a call through Singapore. The extension holds the missing piece:
// debugger access to every tab it can see. This file is the other half of that
// conversation: a loopback server the extension polls, over which raw CDP frames
// travel addressed by numeric tab id.
//
// WHY the shapes mirror transport.js. A bridge session IS a CDP session that
// arrives over a different wire: list, open, close and connect keep their
// contracts, so the driver, the primitives and every test above them run
// unchanged and only this file knows the socket exists.
//
// WHY every command is proved before it is sent. The link is a worker answering
// HTTP, and a worker that Chrome has retired answers nothing while looking
// perfectly alive to a timer. A ping in the queue costs a millisecond and turns
// a thirty-second mystery into a millisecond certainty — and because the worker
// re-arms itself on a thirty-second alarm, one failed proof is a hiccup to ride
// out rather than an error to raise. This is the difference between a driver
// that recovers by itself and one that hangs until the person gives up.
//
// WHY the worker pings back. Dropping a ping would cost nothing measurable and
// lose the only proof the bridge has: that code, not just a socket, is running
// on the other end.

import { createPollBridge, LINK_ERROR } from './poll-server.js';

const DEFAULT_BRIDGE_PORT = 9451;
const REPLY_TIMEOUT_MS = 30000;
const PROOF_TIMEOUT_MS = 1500;
const PROOF_WAIT_MS = 4000;
const NOT_LINKED = LINK_ERROR;

export function bridgePort() {
  return Number(process.env.OPERA_BRIDGE_PORT || DEFAULT_BRIDGE_PORT);
}

let server = null;
let nextId = 1;
const routers = new Map();

async function ensureServer() {
  if (!server) {
    server = createPollBridge({ port: bridgePort() });
    await server.listen();
  }
  return server;
}

function label(message) {
  if (message.bridge === 'ping') return 'the liveness proof';
  if (message.tabs) return 'tabs.' + message.tabs.op;
  return message.method;
}

function roundTrip(srv, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      srv.forget(id);
      reject(new Error(`bridge: no answer for ${label(message)} in ${timeoutMs} ms`));
    }, timeoutMs);
    srv.settleWhen(id, (reply) => {
      clearTimeout(timer);
      if (reply?.error) reject(new Error(String(reply.error.message ?? 'bridge call failed')));
      else resolve(reply?.result ?? null);
    });
    srv.enqueue({ ...message, id });
  });
}

// WHY the proof gets two goes and no more. A worker that has just woken answers
// the first ping while it is still finding its feet, so one try is a race and
// thirty is a lie. Two tries with a wait for a fresh poll between them is the
// difference between a worker that needed a moment and a worker that is gone,
// and the difference is about seven seconds rather than thirty.

async function prove(srv) {
  for (let try_ = 0; try_ < 2; try_++) {
    const seen = srv.polls();
    const pong = await roundTrip(srv, { bridge: 'ping' }, PROOF_TIMEOUT_MS).catch(() => null);
    if (pong?.pong === true) return true;
    await srv.waitForFreshPoll({ after: seen, timeoutMs: try_ === 0 ? PROOF_WAIT_MS : 0 });
  }
  return false;
}

async function attempt(message, timeoutMs) {
  const srv = await ensureServer();
  if (!srv.linked() && !(await srv.waitForLink({ timeoutMs: 12000 }))) throw new Error(NOT_LINKED);
  if (!(await prove(srv))) {
    throw new Error(`bridge: no answer for the liveness proof in ${PROOF_TIMEOUT_MS} ms`);
  }
  return roundTrip(srv, message, timeoutMs);
}

function request(message, { timeoutMs = REPLY_TIMEOUT_MS } = {}) {
  return attempt(message, timeoutMs);
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

// WHY a CDP frame takes the same road as a tab operation. It used to enqueue
// itself and wait forever: no liveness proof, no bound. A worker that went away
// after the session opened left that promise pending for good, and a pending
// promise is the one failure a driver cannot see. Caught by review, not by a
// test that only ever asked a worker which was there.

export function connectBridgeTarget(targetId) {
  const tab = Number(targetId);
  if (!server) throw new Error(NOT_LINKED);
  return {
    send(raw) {
      let frame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        throw new Error('bridge: transport takes JSON CDP frames');
      }
      attempt({ tab, method: frame.method, params: frame.params ?? {} }, REPLY_TIMEOUT_MS).then(
        (result) => routers.get(tab)?.(JSON.stringify({ id: frame.id, result: result ?? null })),
        (error) => routers.get(tab)?.(JSON.stringify({
          id: frame.id,
          error: { message: error?.message || String(error) }
        }))
      );
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
  if (server) await server.close();
  server = null;
}