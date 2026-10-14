// bridge — the local driver's side of the loopback conversation.
//
// WHY THIS FILE EXISTS
//
// Chrome refuses a debugging port on the Default profile, and the relay road to
// this extension costs about two seconds a call through Singapore. The
// extension can reach this machine over loopback, and a CDP frame fits in one
// JSON body: method in, result out, debugger calls between them. The worker
// speaks identical CDP over that conversation, so the whole MCP surface runs on
// the everyday profile at localhost milliseconds with no flags and no queue.
//
// WHY THE TRANSPORT ARRIVES INJECTED. The same drive runs over local CDP at a
// millisecond per primitive and over the remote relay at roughly a second per
// call. The driver does not know which it holds; it counts milliseconds either
// way and the caller picks the fastest transport that can reach the tab.
//
// WHY THE SERVER IS A SOCKET, NOT A HELD REQUEST. A twenty-second held fetch
// made every command pay a fresh request, let one hung command wedge the queue
// for a hundred and forty seconds, and lost commands without a word. The socket
// pushes the moment a command exists, settles on its completion frame, and the
// heartbeat on both sides keeps the worker's service worker alive, which is the
// one thing Chrome actually requires.
//
// WHY THIS FILE ENDS IN A TRANSPORT AND NOT A CLIENT. cdp.js already owns the
// half that is hard — matching a reply to the id that asked for it — and the
// whole drive runs on whatever client it is handed. So the bridge hands over a
// transport, the same contract the real debugging port satisfies, and nothing
// above this line learns that the bytes went through an extension.

import { createBridgeServer } from './bridge-server.js';

const DEFAULT_BRIDGE_PORT = 9451;
const PROOF_TIMEOUT_MS = 2000;
const REPLY_TIMEOUT_MS = 10000;

// WHY one sentence names the one fix that exists. Every other bridge failure
// names itself at the point it happens; this one is the only case where nothing
// has gone wrong yet and everything is still unavailable.

export const LINK_ERROR = 'bridge: extension is not connected (start the local driver, then reload the extension)';

export function bridgePort() {
  return Number(process.env.OPERA_BRIDGE_PORT || DEFAULT_BRIDGE_PORT);
}

let server = null;
let lastProofAt = 0;

// WHY the proof is trusted on request and never by default. A ping round trip
// costs about half of a fast call, so bursts pay it over and over for an answer
// that does not change between one command and the next. Trusting it for a few
// seconds removes that half, and delays a dead worker's diagnosis by exactly the
// trust window plus one command timeout. Default zero keeps the safe behavior;
// whoever sets the window opts into the trade with open eyes.

function trustedRecently() {
  const trustMs = Math.max(0, Number(process.env.OPERA_BRIDGE_TRUST_MS || 0));
  return trustMs > 0 && Date.now() - lastProofAt < trustMs;
}

async function ensureServer() {
  if (!server) {
    const fresh = createBridgeServer({ port: bridgePort() });
    try {
      await fresh.listen();
    } catch (error) {
      if (error?.code === 'EADDRINUSE') throw new Error(`bridge: port ${bridgePort()} is already owned by another driver`);
      throw error;
    }
    server = fresh;
  }
  return server;
}

function label(method) {
  return String(method || 'command');
}

async function prove(srv) {
  const pong = await srv.send('ping', {}, { timeoutMs: PROOF_TIMEOUT_MS }).catch(() => null);
  if (pong?.ok && pong.result?.pong === true) {
    lastProofAt = Date.now();
    return true;
  }
  return false;
}

async function attempt(method, params, timeoutMs) {
  const srv = await ensureServer();
  if (!srv.linked()) throw new Error(LINK_ERROR);
  if (!trustedRecently() && !(await prove(srv))) {
    throw new Error(`bridge: no answer for the liveness proof in ${PROOF_TIMEOUT_MS} ms`);
  }
  const answer = await srv.send(method, params, { timeoutMs });
  if (!answer.ok) {
    throw new Error(String(answer.error?.message ?? `${label(method)} failed`));
  }
  return answer.result;
}

function request(method, params, { timeoutMs = REPLY_TIMEOUT_MS } = {}) {
  return attempt(method, params, timeoutMs);
}

export async function bridgeAddress() {
  const srv = await ensureServer();
  const { port } = srv.address();
  return { port, url: `ws://127.0.0.1:${port}` };
}

export async function waitForBridgeLink({ timeoutMs = 15000 } = {}) {
  const srv = await ensureServer();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (srv.linked()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return srv.linked();
}

// WHY THIS IS ASKED EVERY TIME AND NOT DECIDED ONCE. A driver that chose its
// pipe at startup kept that pipe: the extension was asleep, the probe said no,
// and the driver stayed on a debugging port that opens a profile nobody is
// logged into — for the rest of the process's life, with no way out but a
// restart. The link is a live socket, so asking is one field read, and a
// worker that wakes up thirty seconds late is simply picked up.

export async function bridgeReachable() {
  try {
    const srv = await ensureServer();
    return srv.linked();
  } catch {
    return false;
  }
}

export async function closeBridge() {
  if (!server) return false;
  const srv = server;
  server = null;
  await srv.close();
  return true;
}

export async function listBridgeTargets({ timeoutMs } = {}) {
  const tabs = await request('tabs.list', {}, { timeoutMs });
  return Array.isArray(tabs) ? tabs : [];
}

export async function openBridgeTarget(url) {
  const tab = await request('tabs.open', { url, active: false });
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
}

export async function closeBridgeTarget(targetId) {
  return request('tabs.close', { tabId: Number(targetId) });
}

// WHY the answer is routed by closure. It used to sit in a Map keyed by tab id,
// which meant two sessions on one tab overwrote each other's router and the
// loser watched its own replies go to a stranger. One transport, one router:
// the closure cannot be reached by anything but its own client.

export function connectBridgeTarget(targetId) {
  const tab = Number(targetId);
  let onFrame = null;
  return {
    send(raw) {
      let frame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        throw new Error('bridge: transport takes JSON CDP frames');
      }
      request('cdp', { tabId: tab, method: frame.method, params: frame.params ?? {} }).then(
        (result) => onFrame?.({ id: frame.id, result: result ?? null }),
        (error) => onFrame?.({ id: frame.id, error: { message: error?.message || String(error) } })
      );
    },
    onMessage(fn) {
      onFrame = fn;
    },
    close() {
      onFrame = null;
    }
  };
}
