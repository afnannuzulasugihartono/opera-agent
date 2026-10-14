// @last-edited: 2026-10-13 UTC+7.
// @title: bridge-link — the extension end of the localhost bridge: one held HTTP poll.
// @state: polls the local server, routes CDP by tab, one command at a time, traceable.
// @dependencies: capture, debugger-session, log.

// WHY THIS FILE EXISTS
//
// Chrome refuses a debugging port on the Default profile, and the relay road to
// this extension costs ~2 s a call through Singapore. The extension can, however,
// reach this machine over loopback, and a CDP frame fits in one JSON body: method
// in, result out, debugger calls between them. The local driver speaks identical
// CDP over that conversation, so the whole MCP surface runs on the everyday
// profile at localhost milliseconds with no flags and no queue.
//
// WHY this is a held fetch and not a WebSocket. It was one, and it was a real
// WebSocket on both sides, and it never delivered a command. The evidence is
// in local/poll-server.js: this Chrome hands an inbound loopback frame to an
// extension service worker about never, while the identical code path delivers
// inbound frames from the wss:// relay without trouble. A fetch is the one thing
// Chrome will start a service worker for. So the poll is the transport, the
// wake-up and the keepalive at once: while the poll hangs the worker stays
// alive, and when the answer arrives the worker is running to receive it.
//
// WHY one command at a time. Two browser actions racing over one tab leave the
// page in neither of the two states anybody asked for. Commands run in the order
// they were queued and the poll keeps running meanwhile, so a slow command
// costs the next one its place in line and nothing else.
//
// WHY the debugger attach is held per tab. Attaching per message would put a
// hundred milliseconds on every CDP call; holding it makes the second call as
// cheap as the twentieth. The shared-session machinery already heals the two
// ways this goes stale — a user opening DevTools, a tab closing — and the
// infobar Chrome pins on an attached tab doubles as the agent-is-here sign.
//
// WHAT IT DELIBERATELY DOES NOT DO. No CDP events ride back: nothing on the
// local side subscribes to any, so forwarding them would be latency for nobody.
// No auth beyond loopback: the debugging port this replaces never had any.

import { log } from '../lib/log.js';
import { fetchJson } from './tab-content.js';
import { withDebugger } from './capture.js';
import { releaseDebuggerSession, releaseIdleDebuggerSessions } from '../lib/debugger-session.js';

// WHY the origin is read from the global rather than written in. One machine,
// one address, no setting to get wrong — and a test process that imports the
// worker graph must be able to point its poll somewhere that is not the port
// another test process is already answering, or two files race for the same
// replies and both go green for the wrong reason.

const BRIDGE_ORIGIN = globalThis.OPERA_BRIDGE_ORIGIN || 'http://127.0.0.1:9451';
const BRIDGE_ALARM = 'opera-bridge-link';
const BACKOFF_MS = [400, 1000, 3000, 5000, 15000];
const POLL_HOLD_MS = 20000;
const REPLY_TIMEOUT_MS = 10000;
const DEBUGGER_IDLE_MS = 60000;

let running = false;
let generation = 0;
let queue = Promise.resolve();
let inFlight = null;
let lastPollFailed = false;

const stats = { polls: 0, messages: 0, replies: 0, alarms: 0, failures: 0, lastError: null };

// WHY there is a trace. Every symptom of a bridge link is a symptom of something
// that did not happen, so counters alone kept leaving the same question open:
// did the command arrive and die quietly, or never arrive at all? A short ring of
// the last dozen events, readable over the relay with a ping, answers it without
// a person opening DevTools — which is the only kind of evidence that survives a
// browser this quiet.

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
    running,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// WHY fetchJson and not a bare fetch. It is the same call the relay road already
// makes thousands of times a day — same timeout, same no-store, same error
// shape — so the bridge inherits a request style that is proven on this browser
// instead of a second one that is not.

// WHY the timeout is a parameter and not a constant. A poll is held open for
// twenty seconds and a reply must beat three; one bound for both aborted every
// healthy idle poll halfway, which counted as a failure and left a waiter on the
// server that nobody would ever read. Caught by review, not by a test that only
// ever sent commands.

async function post(path, body, timeoutMs = REPLY_TIMEOUT_MS, signal = undefined) {
  return fetchJson(`${BRIDGE_ORIGIN}${path}`, body, timeoutMs, signal);
}

// WHY this is a function. The invariant that matters is that our own timeout
// outlasts the server's hold, and an invariant nobody can call is an invariant
// nobody checks.

export function pollTimeoutMs(holdMs) {
  return holdMs + 5000;
}

function publicBridgeTab(tab) {
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
}

async function runCommand(command) {
  if (command.bridge === 'ping') return { pong: true };

  if (command.tabs && typeof command.tabs === 'object') {
    const op = command.tabs.op;
    if (op === 'list') {
      const all = await chrome.tabs.query({});
      return all.map(publicBridgeTab);
    }
    if (op === 'open') {
      const created = await chrome.tabs.create({ url: String(command.tabs.url || 'about:blank') });
      return publicBridgeTab(created);
    }
    if (op === 'close') {
      await chrome.tabs.remove(Number(command.tabs.tabId));
      return { id: Number(command.tabs.tabId), closed: true };
    }
    throw new Error(`bridge: unknown tabs op ${JSON.stringify(op)}`);
  }

  if (typeof command.tab !== 'number' || typeof command.method !== 'string') {
    throw new Error('bridge: a CDP message needs a numeric tab and a method');
  }
  const result = await withDebugger(command.tab, { debuggerSession: sessionFor(command.tab) }, (target) =>
    chrome.debugger.sendCommand(target, command.method, command.params ?? {}));
  return result === undefined ? null : result;
}

// WHY the answer is built before it is sent. A command that fails silently is
// the one thing the local side cannot tell from a command that never arrived,
// which is how a two-second error turns into a thirty-second mystery. So
// whatever the command did, something comes back carrying it.
//
// WHY a hung command is abandoned instead of wedging the queue. Commands run
// one at a time, so one CDP call that never settles would hold every later
// command behind it forever. Sixty seconds is past any honest browser call and
// far short of forever; the late answer is dropped by a server that already
// moved on, and the queue walks free.

function handleTimeoutMs() {
  return Number(globalThis.OPERA_BRIDGE_HANDLE_TIMEOUT_MS ?? 60000);
}

function withHandleTimeout(promise) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`bridge: no answer from the tab within ${handleTimeoutMs()} ms`)), handleTimeoutMs());
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

async function handle(command) {
  if (!command || typeof command !== 'object' || command.id === undefined) return;
  stats.messages += 1;
  note(`in ${command.id}`);
  let answer;
  try {
    answer = { result: await withHandleTimeout(runCommand(command)) };
  } catch (error) {
    answer = { error: { message: error?.message || String(error) } };
  }

  try {
    await post('/reply', { id: command.id, ...answer });
    stats.replies += 1;
  } catch (error) {
    stats.lastError = `reply: ${error?.message || error}`;
    note(`reply lost ${error?.message || error}`);
  }
}

// WHY the poll loop never gives up. The local server is not always running, and
// a driver that starts ten minutes later must find a worker already waiting.
//
// WHY the retry backs off. With no driver running every attempt is a refused
// loopback connection: no work, and a red row in the Network panel each time,
// observed filling up while nothing was wrong. Four hundred milliseconds is the
// right first try and the wrong forever, so the wait grows to fifteen seconds.

// WHY the attempt is abortable. Bumping the generation on its own retires the
// loop but not the request inside it, so every tab switch left another poll
// hanging on the same server and they took turns stealing commands from each
// other — one command delivered to whichever waiter the queue happened to meet.
// The controller is what makes retirement real.

async function poll(mine) {
  let step = 0;
  while (running && generation === mine) {
    const attempt = new AbortController();
    inFlight = attempt;
    try {
      stats.polls += 1;
      const command = await post('/poll', {}, pollTimeoutMs(POLL_HOLD_MS), attempt.signal);
      step = 0;
      lastPollFailed = false;
      if (command && command.id !== undefined) {
        queue = queue.then(() => handle(command)).catch(() => {});
      }
    } catch (error) {
      if (attempt.signal.aborted) continue;
      stats.failures += 1;
      lastPollFailed = true;
      stats.lastError = `poll: ${error?.message || error}`;
      note(`poll failed ${error?.message || error}`);
      await sleep(BACKOFF_MS[Math.min(step, BACKOFF_MS.length - 1)]);
      step += 1;
    } finally {
      if (inFlight === attempt) inFlight = null;
    }
  }
}

export function ensureBridgeLink() {
  if (running) return;
  running = true;
  generation += 1;
  note('loop up');
  void poll(generation);
}

// WHY a nudge only fires when a poll has just failed. The loop is already
// running, so the alarm cannot make it take a fresh step; bumping the generation
// retires the attempt in flight and starts one at the first backoff step. That is
// how a person touching a tab finds a driver which started while nothing was
// talking to it — and doing it to a healthy held poll would only tear down a
// request that was working.

function nudge() {
  if (!running || !lastPollFailed) return;
  generation += 1;
  inFlight?.abort();
  void poll(generation);
}

export function stopBridgeLink() {
  running = false;
  generation += 1;
  inFlight?.abort();
  note('loop down');
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 }).catch(() => {});
  ensureBridgeLink();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 }).catch(() => {});
  ensureBridgeLink();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== BRIDGE_ALARM) return;
  stats.alarms += 1;
  void releaseIdleDebuggerSessions({ maxIdleMs: DEBUGGER_IDLE_MS }).then((released) => {
    if (released) note(`debugger idle-released x${released}`);
  });
  if (running) nudge();
  else ensureBridgeLink();
});

chrome.tabs.onActivated.addListener(() => {
  if (running) nudge();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = debuggerSessions.get(tabId);
  debuggerSessions.delete(tabId);
  if (session?.attached) void releaseDebuggerSession(session, log);
});

chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 }).catch(() => {});
ensureBridgeLink();