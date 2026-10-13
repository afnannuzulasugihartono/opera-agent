// @last-edited: 2026-10-13 UTC+7.
// @title: bridge-link — the extension end of the localhost bridge: raw CDP over one socket.
// @state: dials the local server, routes CDP by tab, heals across worker restarts.
// @dependencies: capture, debugger-session, log.

// WHY THIS FILE EXISTS
//
// Chrome refuses a debugging port on the Default profile, and the relay road to
// this extension costs ~2 s a call through Singapore. The extension can, however,
// open an outbound WebSocket to this machine, and a CDP frame fits in one JSON
// text frame: method in, result out, debugger calls between them. The local
// driver speaks identical CDP over that socket, so the whole MCP surface runs on
// the everyday profile at localhost milliseconds with no flags and no queue.
//
// WHY the extension dials out. Nothing can dial in: extensions accept no
// connections and the profile accepts no debugging port. The local server
// listens, this side connects, reconnects with backoff, and also retries on a
// half-minute alarm so a worker that died mid-idle links again by itself.
//
// WHY there is a heartbeat, and it is not optional. An MV3 worker that hears
// nothing for thirty seconds is retired, and Chrome does NOT close its
// WebSocket when that happens: the browser keeps the TCP connection, still
// answers protocol pings in the network layer, and the socket keeps reporting
// OPEN to code that no longer runs. Observed live as a link that looked perfect
// — established, right magic bytes, nine pings answered — while a command sat
// unanswered for thirty seconds, because every frame that arrived went to a
// message loop that had stopped existing. Incoming WebSocket data does not wake
// a service worker, so a socket nobody speaks on is a socket nobody hears on.
// A ping every fifteen seconds is that traffic: it keeps the worker alive, and
// it carries proof the link is alive, which is what the deaf-link rule below
// turns into a decision to throw the socket away and dial again.
//
// WHY one debugger attach per tab, held open. Attaching per message would put a
// hundred milliseconds on every CDP call; holding it makes the second call as
// cheap as the twentieth. The shared-session machinery already heals the two
// ways this goes stale — a user opening DevTools, a tab closing — and the
// infobar Chrome pins on an attached tab doubles as the agent-is-here sign.
//
// WHAT IT DELIBERATELY DOES NOT DO. No CDP events ride back: nothing on the
// local side subscribes to any, so forwarding them would be latency for nobody.
// No auth beyond loopback: the debugging port this replaces never had any, and
// the manifest already scopes outbound sockets to 127.0.0.1.

import { log } from '../lib/log.js';
import { withDebugger } from './capture.js';
import { releaseDebuggerSession } from '../lib/debugger-session.js';

const BRIDGE_URL = 'ws://127.0.0.1:9451/bridge';
const BRIDGE_ALARM = 'opera-bridge-link';
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const HEARTBEAT_MS = 15000;
const DEAF_LINK_MS = 30000;

let socket = null;
let dialingSince = 0;
let backoff = 0;
let retryTimer = null;
let heartbeatTimer = null;
let lastTrafficAt = 0;
let pingSentAt = 0;

// A ping that nothing answers is the only evidence worth acting on. A quiet link
// is normal; a deaf link is a socket the browser kept while the worker behind it
// stopped existing, and the two look identical from the outside.

export function linkIsDeaf({ lastTrafficAt, pingSentAt }, now = Date.now()) {
  return pingSentAt > 0 && lastTrafficAt < pingSentAt && now - pingSentAt > DEAF_LINK_MS;
}

function touch() {
  lastTrafficAt = Date.now();
}
const stats = { dials: 0, links: 0, messages: 0, replies: 0, alarms: 0, pings: 0, recycles: 0, lastError: null };

// WHY there is a trace. Every symptom of this link is a symptom of something
// that did not happen, so counters alone kept leaving the same question open:
// did the frame arrive and die quietly, or never arrive at all? A short ring of
// the last dozen events, readable over the relay with a ping, answers it
// without a person opening DevTools — which is the only kind of evidence that
// survives a browser this quiet.

const TRACE_MAX = 12;
const startedAt = Date.now();
const trace = [];
function note(event) {
  trace.push({ at: Date.now(), event });
  if (trace.length > TRACE_MAX) trace.shift();
}

export function bridgeLinkState() {
  return {
    ...stats,
    socket: socket ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][socket.readyState] ?? socket.readyState : 'none',
    trace: trace.map((entry) => ({ ms: entry.at - startedAt, event: entry.event }))
  };
}
const debuggerSessions = new Map();

function sessionFor(tabId) {
  let session = debuggerSessions.get(tabId);
  if (!session) {
    session = { tabId, attached: false };
    debuggerSessions.set(tabId, session);
  }
  return session;
}

function post(message) {
  try {
    stats.replies += 1;
    touch();
    note(`out ${message?.id}`);
    socket?.send(JSON.stringify(message));
  } catch (error) {
    stats.lastError = `post: ${error?.message || error}`;
    note(`send-failed ${error?.message || error}`);
    log.debug('BRIDGE_SEND_FAILED', error?.message || String(error));
  }
}

async function handleCdp(message) {
  const { id, tab, method, params } = message ?? {};
  if (typeof tab !== 'number' || typeof method !== 'string') {
    post({ id, error: { message: 'bridge: a CDP message needs a numeric tab and a method' } });
    return;
  }
  try {
    const result = await withDebugger(tab, { debuggerSession: sessionFor(tab) }, (target) =>
      chrome.debugger.sendCommand(target, method, params ?? {}));
    post({ id, result: result === undefined ? null : result });
  } catch (error) {
    post({ id, error: { message: error?.message || String(error) } });
  }
}

function publicBridgeTab(tab) {
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
}

async function handleTabs(message) {
  const { id, tabs } = message ?? {};
  const op = tabs?.op;
  try {
    if (op === 'list') {
      const all = await chrome.tabs.query({});
      post({ id, result: all.map(publicBridgeTab) });
    } else if (op === 'open') {
      const created = await chrome.tabs.create({ url: String(tabs.url || 'about:blank') });
      post({ id, result: publicBridgeTab(created) });
    } else if (op === 'close') {
      await chrome.tabs.remove(Number(tabs.tabId));
      post({ id, result: { id: Number(tabs.tabId), closed: true } });
    } else {
      post({ id, error: { message: `bridge: unknown tabs op ${JSON.stringify(op)}` } });
    }
  } catch (error) {
    post({ id, error: { message: error?.message || String(error) } });
  }
}

function route(data) {
  let message;
  try {
    message = JSON.parse(String(data));
  } catch {
    return;
  }
  if (message === null || typeof message !== 'object' || message.id === undefined) return;
  stats.messages += 1;
  note(`in ${message.id}`);
  touch();
  if (message.bridge === 'ping') {
    post({ id: message.id, result: { pong: true } });
    return;
  }
  if (message.tabs && typeof message.tabs === 'object') void handleTabs(message);
  else void handleCdp(message);
}

// WHY the beat is armed from the alarm and not only from the link. A worker the
// browser retired loses its timers with everything else, so a chain started once
// at connect time stops existing; the alarm is the one event that always arrives,
// and it re-arms the chain and proves the link in the same tick.

function heartbeat() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (linkIsDeaf({ lastTrafficAt, pingSentAt })) {
    recycle();
    return;
  }
  pingSentAt = Date.now();
  stats.pings += 1;
  try {
    socket.send(JSON.stringify({ id: `hb-${stats.pings}`, bridge: 'ping' }));
  } catch {
    recycle();
    return;
  }
  heartbeatTimer = setTimeout(() => heartbeat(), HEARTBEAT_MS);
}

function recycle() {
  stats.recycles += 1;
  const dead = socket;
  socket = null;
  pingSentAt = 0;
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
  try {
    dead?.close();
  } catch {}
  log.warn('BRIDGE_LINK_DEAF', 'localhost bridge link stopped answering, redialling');
  void connect();
}

function schedule() {
  if (retryTimer) return;
  const wait = BACKOFF_MS[Math.min(backoff, BACKOFF_MS.length - 1)];
  backoff += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, wait);
  if (retryTimer.unref) retryTimer.unref();
}

export function ensureBridgeLink() {
  heartbeat();
  if (!socket || socket.readyState > WebSocket.OPEN) void connect();
}

async function connect() {
  if (dialingSince && Date.now() - dialingSince < 15000) return;
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  dialingSince = Date.now();
  stats.dials += 1;
  note('dial');
  try {
    const ws = await new Promise((resolve, reject) => {
      let sock;
      try {
        sock = new WebSocket(BRIDGE_URL);
      } catch (error) {
        reject(error);
        return;
      }
      const silence = () => {
        sock.onopen = null;
        sock.onerror = null;
        sock.onclose = null;
      };
      const openTimer = setTimeout(() => {
        silence();
        try { sock.close(); } catch {}
        reject(new Error('bridge unreachable'));
      }, 5000);
      sock.onopen = () => {
        clearTimeout(openTimer);
        silence();
        resolve(sock);
      };
      sock.onerror = () => {
        clearTimeout(openTimer);
        silence();
        try { sock.close(); } catch {}
        reject(new Error('bridge unreachable'));
      };
    });
    socket = ws;
    backoff = 0;
    stats.links += 1;
    pingSentAt = 0;
    touch();
    log.info('BRIDGE_LINK_UP', 'localhost bridge connected');
    note(`link #${stats.links} open`);
    ws.onmessage = (event) => route(event?.data ?? event);
    ws.addEventListener('message', () => note('message event'));
    ws.onclose = (event) => {
      note(`link closed ${event?.code ?? '?'}`);
      if (socket === ws) socket = null;
      log.info('BRIDGE_LINK_DOWN', 'localhost bridge closed, retrying');
      schedule();
    };
    ws.onerror = () => {
      if (socket === ws) {
        try { ws.close(); } catch {}
        socket = null;
      }
      schedule();
    };
    heartbeat();
  } catch (error) {
    note(`dial failed ${error?.message || error}`);
    log.debug('BRIDGE_DIAL_FAILED', 'localhost bridge unreachable, backing off');
    schedule();
  } finally {
    dialingSince = 0;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 }).catch(() => {});
  void connect();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 }).catch(() => {});
  void connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== BRIDGE_ALARM) return;
  stats.alarms += 1;
  heartbeat();
  void connect();
});

chrome.tabs.onActivated.addListener(() => {
  void connect();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = debuggerSessions.get(tabId);
  debuggerSessions.delete(tabId);
  if (session?.attached) void releaseDebuggerSession(session, log);
});

chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 }).catch(() => {});
void connect();
