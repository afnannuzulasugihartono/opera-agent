// @last-edited: 2026-10-09 UTC+7.
// @title: background-load — the service worker graph actually loads.
// @state: imports the real extension/background.js under a chrome mock; the only test that can catch a broken export, a severed import, or an import cycle that will not evaluate.
// @dependencies: node:test, strict, extension/background.js.

import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
function event(name) {
  const fns = [];
  listeners[name] = fns;
  return {
    addListener: (fn) => { fns.push(fn); },
    removeListener: (fn) => {
      const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1);
    },
  };
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
  alarms: {
    onAlarm: event('alarms.onAlarm'),
    create: async () => {},
  },
  storage: {
    onChanged: event('storage.onChanged'),
    local: { get: async () => ({}), set: async () => {} },
  },
};

// WHY the loop is stopped before the file ends.
// Importing the worker graph is what starts the bridge poll, and a poll that keeps asking a port nobody is listening on keeps this process alive forever.
// The production loop is the point; in a test it is only something to switch off again.

const { stopBridgeLink } = await import('../extension/worker/bridge-link.js');

test('the service worker module graph evaluates without throwing', async () => {
  await assert.doesNotReject(() => import('../extension/background.js'),
    'importing background.js must not throw');
});

test.after(() => stopBridgeLink());

test('the load-time listeners actually registered', () => {

  assert.equal(listeners['runtime.onMessage'].length, 1, 'exactly one onMessage handler');
  assert.equal(listeners['tabs.onRemoved'].length, 3, 'pull, loops and bridge-link all drop their tab state');
  assert.equal(listeners['debugger.onDetach'].length, 1, 'the debugger detach handler registers');
  assert.equal(listeners['alarms.onAlarm'].length, 2, 'wake alarm plus the bridge loop guard');
  assert.equal(listeners['tabs.onActivated'].length, 1, 'the bridge retries sooner when the person switches tab');
  assert.ok(listeners['tabs.onCreated'].length >= 1, 'the tab-drag gate registers');
  assert.ok(listeners['runtime.onInstalled'].length >= 1, 'onInstalled registers');
});
