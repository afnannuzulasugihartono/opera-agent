// @last-edited: 2026-10-14 UTC+7.
// @title: bridge-link — the extension end of the localhost bridge: one socket, pushed.
// @state: one socket to the local server, CDP routed by tab, one command at a time, traceable.
// @dependencies: socket-client, capture, debugger-session, log.

// WHY THIS FILE EXISTS
//
// Chrome refuses a debugging port on the Default profile, and the relay road to
// this extension costs ~2 s a call through Singapore. The extension can, however,
// reach this machine over loopback, and a CDP frame fits in one JSON body: method
// in, result out, debugger calls between them. The local driver speaks identical
// CDP over that conversation, so the whole MCP surface runs on the everyday
// profile at localhost milliseconds with no flags and no queue.
//
// WHY A SOCKET NOW, AFTER A HELD POLL. This road was a WebSocket first, and it
// read as OPEN while it heard nothing; the diagnosis was that this Chrome drops
// inbound loopback frames, and the replacement was a twenty-second held fetch.
// Both conclusions were wrong, and the poll it bought cost more than it saved:
// every command paid a fresh request and a held connection, a hung one wedged
// the queue for a hundred and forty seconds, and commands went missing without
// a word. The real rule is narrower and better known: Chrome ends an idle
// service worker after about thirty seconds and an inbound frame does not wake
// it. So the socket carries a heartbeat - a frame that asks nothing - and the
// worker never goes idle in the first place. That heartbeat is not new: the
// cloud socket client already proved it works on this very worker.
//
// WHY IT IS THE SAME CLIENT AS THE CLOUD ROAD. One drain, one queue, one
// failure story, for a device on loopback and a device on a relay. Two roads
// meant two sets of wedges, and the second one was always the stranger.
//
// WHY one command at a time. Two browser actions racing over one tab leave the
// page in neither of the two states anybody asked for. Commands run in the order
// they arrived and the socket stays open meanwhile, so a slow command costs the
// next one its place in line and nothing else.
//
// WHY the debugger attach is held per tab. Attaching per message would put a
// hundred milliseconds on every CDP call; holding it makes the second call as
// cheap as the twentieth. The shared-session machinery heals both ways this goes
// stale - a user opening DevTools, another road releasing the tab - and the
// infobar Chrome pins on an attached tab doubles as the agent-is-here sign.
//
// WHAT IT DELIBERATELY DOES NOT DO. No CDP events ride back: nothing on the
// local side subscribes to any, so forwarding them would be latency for nobody.
// The one thing it does refuse is anyone else: the local server binds to
// 127.0.0.1 and admits only this extension's origin, so a page on this machine
// cannot open a socket and drive the browser as if the person had asked it to.
// That is a narrower boundary than the debugging port it replaces, which had
// none at all — and it is the only auth the bridge needs.

import { log } from '../lib/log.js';
import { createSocketClient } from '../lib/socket-client.js';
import { releaseDebuggerSession, releaseIdleDebuggerSessions } from '../lib/debugger-session.js';
import { withDebugger } from './capture.js';

const BRIDGE_WS = globalThis.OPERA_BRIDGE_WS || 'ws://127.0.0.1:9451';
const BRIDGE_ALARM = 'opera-bridge-link';
const DEBUGGER_IDLE_MS = 60000;

let running = false;
let generation = 0;
let client = null;

const stats = { commands: 0, replies: 0, alarms: 0, failures: 0, lastError: null };
let trace = [];
let startedAt = Date.now();

const debuggerSessions = new Map();

function sessionFor(tabId) {
  let session = debuggerSessions.get(tabId);
  if (!session) {
    session = { tabId, attached: false };
    debuggerSessions.set(tabId, session);
  }
  return session;
}

function note(event) {
  trace = [...trace.slice(-11), { at: Date.now(), event }];
}

export function bridgeLinkState() {
  return {
    ...stats,
    running,
    linked: client ? client.isReady() : false,
    trace: trace.map((entry) => ({ ms: entry.at - startedAt, event: entry.event }))
  };
}

function publicBridgeTab(tab) {
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
}

// WHY THE BOUND SITS UNDER THE CALLER'S TIMEOUT. The local side gives a
// command ten seconds and then stops listening. This side used to hold a
// command for a minute before giving up on it, so one hung call did not just
// fail — it kept the worker busy long after the caller had walked away, and
// every command queued behind it died too. A loopback round trip has no
// network in it: a browser that needs eight seconds to answer one call is not
// slow, it is stuck, and saying so in eight seconds is worth more than being
// patient for a minute. Raising it back is one environment variable.

function handleTimeoutMs() {
  return Number(globalThis.OPERA_BRIDGE_HANDLE_TIMEOUT_MS ?? 8000);
}

function withHandleTimeout(promise) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`bridge: no answer from the tab within ${handleTimeoutMs()} ms`)), handleTimeoutMs());
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

// The wire shape is the socket protocol's own: a method name and a params
// object. The poll road smuggled its operation inside params, which meant a
// second command vocabulary existed for one transport; with one socket there is
// one vocabulary, and a local caller writes the same command it would send to
// the relay.

async function runCommand(command) {
  const method = String(command.method || '');
  const params = command.params && typeof command.params === 'object' ? command.params : {};

  if (method === 'ping') return { pong: true };

  if (method === 'tabs.list') {
    const all = await chrome.tabs.query(params.currentWindow ? { currentWindow: true } : {});
    return all.map(publicBridgeTab);
  }
  if (method === 'tabs.open') {
    const created = await chrome.tabs.create({ url: String(params.url || 'about:blank'), active: params.active === true });
    return publicBridgeTab(created);
  }
  if (method === 'tabs.close') {
    const tabId = Number(params.tabId);
    await chrome.tabs.remove(tabId);
    return { id: tabId, closed: true };
  }
  if (method === 'tabs.activate') {
    const tabId = Number(params.tabId);
    const tab = await chrome.tabs.update(tabId, { active: true });
    return publicBridgeTab(tab);
  }
  if (method === 'tabs.navigate') {
    const tabId = Number(params.tabId);
    const tab = await chrome.tabs.update(tabId, { url: String(params.url || '') });
    return publicBridgeTab(tab);
  }
  if (method === 'cdp') {
    const tabId = Number(params.tabId);
    if (!Number.isInteger(tabId)) throw new Error('bridge: cdp needs an integer tabId');
    const result = await withDebugger(tabId, { debuggerSession: sessionFor(tabId) }, (target) =>
      chrome.debugger.sendCommand(target, String(params.method || ''), params.params ?? {}));
    return result === undefined ? null : result;
  }
  throw new Error(`bridge: unknown method ${method || '(none)'}`);
}

async function execute(command) {
  if (!command || typeof command !== 'object') return { ok: false, error: { code: 'BRIDGE_COMMAND_INVALID', message: 'Command was not an object.' } };
  stats.commands += 1;
  note(`in ${command.id}`);
  try {
    const result = await withHandleTimeout(runCommand(command));
    stats.replies += 1;
    return { ok: true, result };
  } catch (error) {
    stats.lastError = String(error?.message || error).slice(0, 300);
    stats.failures += 1;
    note(`fail ${command.id} ${stats.lastError.slice(0, 80)}`);
    return { ok: false, error: { code: 'BRIDGE_COMMAND_FAILED', message: String(error?.message || error).slice(0, 300) } };
  }
}

export function ensureBridgeLink() {
  if (running) return;
  running = true;
  startedAt = Date.now();
  trace = [];
  const mine = ++generation;
  client = createSocketClient({
    url: BRIDGE_WS,
    token: '',
    deviceName: 'bridge',
    execute,
    onState: (event) => {
      if (mine !== generation) return;
      if (event?.status === 'ready') note('ready');
      if (event?.status === 'error') stats.lastError = String(event.message || 'error').slice(0, 300);
    }
  });
  client.start();
  note('socket starting');
}

export function stopBridgeLink() {
  running = false;
  generation += 1;
  if (client) client.stop();
  client = null;
  for (const session of [...debuggerSessions.values()]) {
    if (session.attached) void releaseDebuggerSession(session, log);
  }
  debuggerSessions.clear();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== BRIDGE_ALARM) return;
  stats.alarms += 1;
  void releaseIdleDebuggerSessions({ maxIdleMs: DEBUGGER_IDLE_MS }).then((released) => {
    if (released) note(`debugger idle-released x${released}`);
  });
  if (!running) ensureBridgeLink();
});

chrome.tabs.onActivated.addListener(() => {
  if (!running) ensureBridgeLink();
});

// WHY a closed tab still costs a line here. The debugger registry is shared and
// `chrome.debugger.onDetach` already heals the attach flag on the object it
// finds — but that handler only reaches a session it can look up, and this map
// is the one place a session for a tab that is gone can still be found. Dropped,
// it is an entry per closed tab for as long as the worker lives.

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = debuggerSessions.get(tabId);
  debuggerSessions.delete(tabId);
  if (session?.attached) void releaseDebuggerSession(session, log);
});

chrome.runtime.onStartup.addListener(() => ensureBridgeLink());
chrome.runtime.onInstalled.addListener(() => ensureBridgeLink());

// WHY the alarm is armed here and not where it is read. Its handler is the only
// thing that releases an idle debugger session, and the infobar Chrome pins on
// an attached tab is the person's evidence of where the agent is. An alarm that
// is listened for but never created leaves that bar up forever, silently, and
// nothing else in the worker would ever notice. The same alarm is the beat that
// brings a link back after Chrome retired the worker.

chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 0.5 }).catch(() => {});

ensureBridgeLink();
