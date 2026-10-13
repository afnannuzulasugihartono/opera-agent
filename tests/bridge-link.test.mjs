// @last-edited: 2026-10-13 UTC+7.
// @title: bridge-link — staleness math and message validation without a browser.
// @state: imports the worker module under a chrome mock; socket behavior stays live-verified.
// @dependencies: node:test, strict, ../extension/worker/bridge-link.js.

import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
function event(name) {
  const fns = [];
  listeners[name] = fns;
  return { addListener: (fn) => { fns.push(fn); } };
}

globalThis.chrome = {
  debugger: { onDetach: event('debugger.onDetach') },
  tabs: {
    onCreated: event('tabs.onCreated'),
    onRemoved: event('tabs.onRemoved'),
    onUpdated: event('tabs.onUpdated'),
    onActivated: event('tabs.onActivated'),
  },
  runtime: {
    onMessage: event('runtime.onMessage'),
    onMessageExternal: event('runtime.onMessageExternal'),
    onInstalled: event('runtime.onInstalled'),
    onStartup: event('runtime.onStartup'),
  },
  alarms: { onAlarm: event('alarms.onAlarm'), create: async () => {} },
  storage: { onChanged: event('storage.onChanged'), local: { get: async () => ({}), set: async () => {} } },
};

const { isLinkStale, linkNeedsRefresh } = await import('../extension/worker/bridge-link.js');

test('a link idles 45 seconds before it counts as stale', () => {
  assert.equal(isLinkStale(100000, 100000 + 44000), false);
  assert.equal(isLinkStale(100000, 100000 + 46000), true);
});

test('with no socket there is nothing to refresh', () => {
  assert.equal(linkNeedsRefresh(Date.now()), false);
});

test('the module registers its reconnect listeners', () => {
  assert.ok(listeners['alarms.onAlarm'].length >= 1);
  assert.ok(listeners['tabs.onActivated'].length >= 1);
  assert.ok(listeners['runtime.onInstalled'].length >= 1);
});
