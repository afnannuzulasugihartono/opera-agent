// @last-edited: 2026-10-13 UTC+7.
// @title: bridge-link — the extension half of the loopback conversation, without a browser.
// @state: the poll loop runs against a scripted local server; routing stays honest.
// @dependencies: node:test, strict, ../extension/worker/bridge-link.js, ./local/poll-server.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPollBridge, POLL_HOLD_MS } from '../local/poll-server.js';

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
  storage: { onChanged: event('storage.onChanged'), local: { get: async () => ({}), set: async () => {} } },
};

// Its own port, because another test process imports the same worker graph and
// starts polling 9451 the moment it does.

const TEST_PORT = 9461;
globalThis.OPERA_BRIDGE_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

const bridge = createPollBridge({ port: TEST_PORT });
await bridge.listen();

const answers = new Map();
bridge.settleWhen('unused', () => {});
const { stopBridgeLink, bridgeLinkState, ensureBridgeLink, pollTimeoutMs } =
  await import('../extension/worker/bridge-link.js');

test.after(() => stopBridgeLink());

test('the loop comes up on its own and the local side sees a worker polling', async () => {
  ensureBridgeLink();
  const deadline = Date.now() + 4000;
  while (!bridge.linked() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  assert.equal(bridge.linked(), true, 'the worker polled without being asked');
});

test('a liveness proof comes back as a pong, which is what the local side rides on', async () => {
  const pong = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no pong within 3s')), 3000);
    bridge.settleWhen('proof', (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    bridge.enqueue({ id: 'proof', bridge: 'ping' });
  });
  assert.deepEqual(pong.result, { pong: true });
});

test('tab listing travels the whole round trip', async () => {
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no tabs.list reply within 3s')), 3000);
    bridge.settleWhen('tabs', (out) => {
      clearTimeout(timer);
      resolve(out);
    });
    bridge.enqueue({ id: 'tabs', tabs: { op: 'list' } });
  });
  assert.deepEqual(reply.result, [{ id: 5, url: 'https://example/', title: 'Example' }]);
});

test('a CDP command reaches the debugger and its result comes back', async () => {
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no CDP reply within 3s')), 3000);
    bridge.settleWhen('cdp', (out) => {
      clearTimeout(timer);
      resolve(out);
    });
    bridge.enqueue({ id: 'cdp', tab: 5, method: 'Runtime.evaluate', params: { expression: '1+1' } });
  });
  assert.deepEqual(reply.result, { method: 'Runtime.evaluate', tabId: 5, params: { expression: '1+1' } });
  assert.equal(debugged.at(-1).method, 'Runtime.evaluate');
});

test('our own poll timeout always outlasts the server hold', () => {
  assert.equal(pollTimeoutMs(POLL_HOLD_MS) > POLL_HOLD_MS, true,
    'an idle poll must not abort while the server is still holding it');
  assert.equal(pollTimeoutMs(0), 5000, 'a request still has a bound even with no hold');
});

test('a failing command answers with an error instead of vanishing', async () => {
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no error reply within 3s')), 3000);
    bridge.settleWhen('bad', (out) => {
      clearTimeout(timer);
      resolve(out);
    });
    bridge.enqueue({ id: 'bad', tabs: { op: 'explode' } });
  });
  assert.match(String(reply.error?.message ?? ''), /unknown tabs op/);
});

test('the state a ping reports carries the evidence the last silence needs', async () => {
  const state = bridgeLinkState();
  for (const key of ['polls', 'messages', 'replies', 'running', 'trace']) {
    assert.ok(key in state, `bridge state carries ${key}`);
  }
  assert.ok(state.polls > 0, 'the worker really did poll');
  assert.ok(state.trace.length > 0, 'the trace holds what the link did');
  assert.ok(state.trace.some((entry) => String(entry.event).startsWith('in ')), 'commands are on the trace');
});

test('the module registers the listeners that restart it', () => {
  assert.ok(listeners['alarms.onAlarm'].length >= 1);
  assert.ok(listeners['runtime.onInstalled'].length >= 1);
  assert.ok(listeners['runtime.onStartup'].length >= 1);
});

test('a hung CDP call fails loud and fast instead of wedging later commands', async () => {
  const realSend = globalThis.chrome.debugger.sendCommand;
  globalThis.chrome.debugger.sendCommand = () => new Promise(() => {});
  globalThis.OPERA_BRIDGE_HANDLE_TIMEOUT_MS = '150';
  try {
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no timeout reply within 3s')), 3000);
      bridge.settleWhen('hung', (out) => { clearTimeout(timer); resolve(out); });
      bridge.enqueue({ id: 'hung', tab: 5, method: 'Page.captureScreenshot', params: {} });
    });
    assert.match(String(reply.error?.message ?? ''), /no answer from the tab/);
  } finally {
    globalThis.chrome.debugger.sendCommand = realSend;
    delete globalThis.OPERA_BRIDGE_HANDLE_TIMEOUT_MS;
  }

  const after = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('queue still wedged after 3s')), 3000);
    bridge.settleWhen('after', (out) => { clearTimeout(timer); resolve(out); });
    bridge.enqueue({ id: 'after', tabs: { op: 'list' } });
  });
  assert.ok(Array.isArray(after.result), 'the queue walked free behind the abandoned call');
});

test('the local server closes last, so no poll arrives after the tests', async () => {
  stopBridgeLink();
  await bridge.close();
});