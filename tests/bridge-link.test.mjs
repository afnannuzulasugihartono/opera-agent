// @last-edited: 2026-10-14 UTC+7.
// @title: bridge-link.test — the extension half of the loopback conversation, without a browser.
// @state: the real socket server pushes; this worker answers CDP over it.
// @dependencies: node:test, strict, ../extension/worker/bridge-link.js, ../local/bridge-server.js.

// WHY A REAL SERVER HERE. The whole point of the socket road is that the device
// receives a command it never asked for, so a stubbed transport would prove
// nothing that matters. This drives the same bridge-server.js that runs on the
// machine, over a real socket, and asserts the push arrives, the CDP routing
// works, and a CDP failure comes back as a named completion instead of silence.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../local/bridge-server.js';
import { encodeText } from '../local/ws-server.js';

const listeners = {};
function event(name) {
  const fns = [];
  listeners[name] = fns;
  return { addListener: (fn) => { fns.push(fn); } };
}

const debugged = [];
globalThis.chrome = {
  debugger: {
    onDetach: event('debugger.onDetach'),
    attach: async () => {},
    detach: async () => {},
    sendCommand: async (target, method, params) => {
      debugged.push({ tabId: target.tabId, method, params });
      return { method, tabId: target.tabId, params };
    }
  },
  tabs: {
    onCreated: event('tabs.onCreated'),
    onRemoved: event('tabs.onRemoved'),
    onUpdated: event('tabs.onUpdated'),
    onActivated: event('tabs.onActivated'),
    query: async () => [{ id: 5, url: 'https://example/', title: 'Example' }],
    create: async ({ url }) => ({ id: 6, url, title: '' }),
    remove: async (id) => ({ removed: id })
  },
  runtime: {
    onMessage: event('runtime.onMessage'),
    onMessageExternal: event('runtime.onMessageExternal'),
    onInstalled: event('runtime.onInstalled'),
    onStartup: event('runtime.onStartup')
  },
  alarms: { onAlarm: event('alarms.onAlarm'), create: async () => {} },
  storage: { onChanged: event('storage.onChanged'), local: { get: async () => ({}), set: async () => {} } }
};

// Its own port, because another test process imports the same worker graph and
// would otherwise fight this one for the device connection. The server and the
// global exist before the import, because the worker dials out the moment it
// loads: a test that connected it by hand would be testing its own wiring.

const PORT = 9471;
globalThis.OPERA_BRIDGE_WS = `ws://127.0.0.1:${PORT}`;

const bridge = createBridgeServer({ port: PORT, heartbeatMs: 500 });
await bridge.listen();

const { stopBridgeLink, bridgeLinkState, ensureBridgeLink } = await import('../extension/worker/bridge-link.js');

const deadline = Date.now() + 5000;
while (!bridge.linked() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));

test.after(async () => {
  stopBridgeLink();
  await bridge.close();
});

test('the worker connects on its own, without being asked', () => {
  ensureBridgeLink();
  assert.equal(bridge.linked(), true, 'the socket came up by itself');
});

test('a pushed command runs and its answer comes back over the same socket', async () => {
  const answer = await bridge.send('tabs.list', {});
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.result[0].id, 5);
  assert.ok(answer.ms < 500, `a loopback round trip is milliseconds (took ${answer.ms} ms)`);
});

test('a CDP command reaches the browser with its tab and method intact', async () => {
  debugged.length = 0;
  const answer = await bridge.send('cdp', { tabId: 9, method: 'Page.getLayoutMetrics' });
  assert.equal(answer.ok, true);
  assert.deepEqual(debugged.map((c) => [c.tabId, c.method]), [[9, 'Page.getLayoutMetrics']]);
});

test('a command the bridge refuses answers with the refusal, never silence', async () => {
  const pong = await bridge.send('ping');
  assert.equal(pong.ok, true);
  assert.deepEqual(pong.result, { pong: true });
  const bad = await bridge.send('tabs.nope', {});
  assert.equal(bad.ok, false);
  assert.match(String(bad.error?.message ?? ''), /unknown method/);
});

test('the state a ping reports carries the evidence the last silence needs', () => {
  const state = bridgeLinkState();
  for (const key of ['commands', 'replies', 'running', 'linked', 'trace']) {
    assert.ok(key in state, `bridge state carries ${key}`);
  }
  assert.ok(state.commands > 0, 'the worker really did run commands');
  assert.ok(state.trace.length > 0, 'the trace holds what the link did');
});

test('the module registers the listeners that restart it', () => {
  assert.ok(listeners['alarms.onAlarm'].length >= 1);
  assert.ok(listeners['runtime.onInstalled'].length >= 1);
  assert.ok(listeners['runtime.onStartup'].length >= 1);
});

test('the frame writer the server uses is the one the client decodes', () => {
  assert.equal(encodeText('{"type":"ping"}').toString('latin1').includes('{"type":"ping"}'), true);
});

// WHY THIS IS LOCKED IN A TEST AND NOT LEFT TO THE READER. One hung browser
// call used to hold this worker for a minute while the caller gave up after
// ten seconds — so the failure was not one failed command but a queue of them,
// which is what "stuck" felt like. The bound has to stay under the caller's
// timeout, and those two numbers live in different files.

test('the worker gives up before the local side stops listening', async () => {
  const workerBound = await import('../extension/worker/bridge-link.js')
    .then(() => Number(globalThis.OPERA_BRIDGE_HANDLE_TIMEOUT_MS ?? 8000));
  const callerBound = Number((await import('node:fs')).readFileSync(
    new URL('../local/bridge.js', import.meta.url), 'utf8'
  ).match(/const REPLY_TIMEOUT_MS = (\d+)/)?.[1]);

  assert.ok(workerBound < callerBound,
    `the worker must free the command slot (${workerBound} ms) before the caller gives up on it (${callerBound} ms)`);
});
