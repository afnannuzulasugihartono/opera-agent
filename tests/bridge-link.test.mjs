// @last-edited: 2026-10-13 UTC+7.
// @title: bridge-link — deaf-link math and message routing without a browser.
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

const { linkIsDeaf, bridgeLinkState } = await import('../extension/worker/bridge-link.js');

test('a link that answers a ping is not deaf, however long it has been open', () => {
  assert.equal(linkIsDeaf({ lastTrafficAt: 200000, pingSentAt: 100000 }, 260000), false);
});

test('an unanswered ping makes the link deaf after the bound', () => {
  const deaf = { lastTrafficAt: 99000, pingSentAt: 100000 };
  assert.equal(linkIsDeaf(deaf, 129000), false);
  assert.equal(linkIsDeaf(deaf, 131000), true);
});

test('traffic that is not the ping still counts as proof the link hears', () => {
  assert.equal(linkIsDeaf({ lastTrafficAt: 150000, pingSentAt: 100000 }, 131000), false);
});

test('a link that has never pinged cannot be deaf', () => {
  assert.equal(linkIsDeaf({ lastTrafficAt: 0, pingSentAt: 0 }, 999999), false);
});

test('the module reports a bridge state the ping can be read from', () => {
  const state = bridgeLinkState();
  for (const key of ['dials', 'links', 'pings', 'recycles', 'socket']) {
    assert.ok(key in state, `bridge state carries ${key}`);
  }
});

test('the module registers its reconnect listeners', () => {
  assert.ok(listeners['alarms.onAlarm'].length >= 1);
  assert.ok(listeners['tabs.onActivated'].length >= 1);
  assert.ok(listeners['runtime.onInstalled'].length >= 1);
});