// @last-edited: 2026-10-21 UTC+7.
// @title: bridge — the local driver's side of the loopback conversation.
// @state: the transport it hands the driver, so the drive runs the same over CDP and over the extension.
// @dependencies: none.

// WHY THIS FILE EXISTS

// Chrome refuses a debugging port on the Default profile, and the relay road to this extension costs about two seconds a call through Singapore.
// The extension can reach this machine over loopback, and a CDP frame fits in one JSON body: method in, result out, debugger calls between them.
// The worker speaks identical CDP over that conversation, so the whole MCP surface runs on the everyday profile at localhost milliseconds with no flags and no queue.

// WHY THE TRANSPORT ARRIVES INJECTED.
// The same drive runs over local CDP at a millisecond per primitive and over the remote relay at roughly a second per call.
// The driver does not know which it holds; it counts milliseconds either way and the caller picks the fastest transport that can reach the tab.

// WHY THE SERVER IS A SOCKET, NOT A HELD REQUEST.
// A twenty-second held fetch made every command pay a fresh request, let one hung command wedge the queue for a hundred and forty seconds, and lost commands without a word.
// The socket pushes the moment a command exists, settles on its completion frame, and the heartbeat on both sides keeps the worker's service worker alive, which is the one thing Chrome actually requires.

// WHY THIS FILE ENDS IN A TRANSPORT AND NOT A CLIENT.
// cdp.js already owns the half that is hard — matching a reply to the id that asked for it — and the whole drive runs on whatever client it is handed.
// So the bridge hands over a transport, the same contract the real debugging port satisfies, and nothing above this line learns that the bytes went through an extension.

import { createBridgeServer } from './bridge-server.js';

const DEFAULT_BRIDGE_PORT = 9451;
const PROOF_TIMEOUT_MS = 2000;
const REPLY_TIMEOUT_MS = 10000;

// WHY one sentence names the one fix that exists.
// Every other bridge failure names itself at the point it happens; this one is the only case where nothing has gone wrong yet and everything is still unavailable.

export const LINK_ERROR = 'bridge: extension is not connected (start the local driver, then reload the extension)';

export function bridgePort() {
  return Number(process.env.OPERA_BRIDGE_PORT || DEFAULT_BRIDGE_PORT);
}

let server = null;
let lastProofAt = 0;

// WHY the proof is trusted on request and never by default.
// A ping round trip costs about half of a fast call, so bursts pay it over and over for an answer that does not change between one command and the next.
// Trusting it for a few seconds removes that half, and delays a dead worker's diagnosis by exactly the trust window plus one command timeout.
// Default zero keeps the safe behavior; whoever sets the window opts into the trade with open eyes.

function trustedRecently() {
  const trustMs = Math.max(0, Number(process.env.OPERA_BRIDGE_TRUST_MS || 0));
  return trustMs > 0 && Date.now() - lastProofAt < trustMs;
}

// WHY A LOST PORT IS A DOOR, NOT A DEAD END.
// The bridge is the one thing on this machine that may only exist once: one device socket, one command queue, one browser.
// A second driver used to read that as a fatal conflict, threw on every call, and took a whole session's tools down with it — measured as `another dev shim owns this machine` followed by an MCP that never connects, while a perfectly good bridge sat one port away holding the browser.
// So the loser of the bind becomes a client of the winner: same commands, same results, same signed-in profile, and the lock that used to enforce one driver per machine has nothing left to enforce.

function adoptedBridge(port) {
  let linked = false;
  const call = async (method, params = {}, { timeoutMs = 60000 } = {}) => {
    let body;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params, timeoutMs }),
        signal: AbortSignal.timeout(timeoutMs + 2000)
      });
      if (!response.ok) throw new Error(`the bridge answered ${response.status}`);
      body = await response.json();
    } catch (error) {
      linked = false;
      throw new Error(`bridge: the driver holding port ${port} is gone (${error?.message ?? error})`);
    }
    linked = true;
    return body;
  };
  const probe = async () => {
    let body = null;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      body = await response.json();
    } catch {
      body = null;
    }
    if (body?.ok !== true) {
      throw new Error(`bridge: port ${port} is held by another process that is not a bridge`);
    }
    linked = body.linked === true;
    return linked;
  };
  return {
    adopted: true,
    address: () => ({ port, host: '127.0.0.1' }),
    listen: async () => ({ port, host: '127.0.0.1' }),
    close: async () => { server = null; },
    probe,
    linked: () => linked,
    send: (method, params, options) => call(method, params, options),
    on: () => {},
    state: () => ({ linked, deviceId: null, queued: null, waiting: null, lastHeardMsAgo: null })
  };
}

async function ensureServer() {
  if (!server) {
    const fresh = createBridgeServer({ port: bridgePort() });
    try {
      await fresh.listen();
      server = fresh;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
      const adopted = adoptedBridge(bridgePort());
      await adopted.probe();
      server = adopted;
    }
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

// WHY A TAKEOVER IS ONE RETRY.
// An adopted bridge is a guest of a process that can die, and a guest whose host left keeps reporting a dead port forever.
// The failure names the host, so the retry is the obvious move: drop the guest, let `ensureServer` bind a port nobody holds, and answer from the bridge this process now owns.
// One retry, so a command that merely failed is never run twice — command failures come back as answers, not as transport errors.

// WHY AN ADOPTED BRIDGE IS ASKED, NOT REMEMBERED.
// The link flag on a guest is a memory of the last word it heard, and a session that pauses long enough for the owner's extension to drop comes back to a flag that still says "linked" long after the socket went.
// A guest asks the owner instead — one round trip on a path that already pays one — and a live owner says yes.
// The owner's own server keeps its in-process truth.

async function attempt(method, params, timeoutMs, takeover = true) {
  const srv = await ensureServer();
  if (!srv.linked()) {
    const alive = srv.adopted ? await srv.probe().catch(() => false) : false;
    if (!alive) throw new Error(LINK_ERROR);
  }
  if (!trustedRecently() && !(await prove(srv))) {
    throw new Error(`bridge: no answer for the liveness proof in ${PROOF_TIMEOUT_MS} ms`);
  }
  let answer;
  try {
    answer = await srv.send(method, params, { timeoutMs });
  } catch (error) {
    if (!srv.adopted || !takeover) throw error;
    server = null;
    return attempt(method, params, timeoutMs, false);
  }
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

// WHY THIS IS ASKED EVERY TIME AND NOT DECIDED ONCE.
// A driver that chose its pipe at startup kept that pipe: the extension was asleep, the probe said no, and the driver stayed on a debugging port that opens a profile nobody is logged into — for the rest of the process's life, with no way out but a restart.
// The link is a live socket, so asking is one field read, and a worker that wakes up thirty seconds later is simply picked up.

// WHY A CONFLICT IS NOT SWALLOWED.
// Swallowing every error here once sent a live extension silently back to the debugging port, because the real cause was not a missing extension but another process holding the port — so the drive carried on against a profile with nothing signed in and no sign of why.
// There is no version of a silent wrong answer to "can you reach the browser I am signed into".

// WHY THE GUEST IS ASKED WHENEVER IT IS ASKED.
// `linked` on an adopted bridge remembers the last word it heard, and the very first question a new driver asks is whether the bridge is reachable — a guest that adopted while the extension was between sockets answered "no" forever after, because only a command could set the flag true and every command asks this first.
// Measured live: the second driver fell back to a debugging port nobody is signed into while a healthy bridge held the browser.
// So a guest asks the owner, every time, and an owner that is there answers in about a millisecond.

export async function bridgeReachable() {
  const srv = await ensureServer();
  if (srv.adopted) return srv.probe().catch(() => false);
  return srv.linked();
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

// WHY the answer is routed by closure.
// It used to sit in a Map keyed by tab id, which meant two sessions on one tab overwrote each other's router and the loser watched its own replies go to a stranger.
// One transport, one router: the closure cannot be reached by anything but its own client.

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
