// @last-edited: 2026-11-12 UTC+7.
// @title: registry - the one key this project writes, and the one it removes.
// @state: HKCU only; a failing registry must not take the process down with it.
// @dependencies: test, assert, ../local/registry.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeExtensionKey, deleteExtensionKey, EXTENSION_ID, UPDATE_URL } from '../../local/registry.js';

const KEYS = {
  chrome: 'HKCU\\Software\\Google\\Chrome\\Extensions\\ofgemipoobcnbjkfanmofjbdonjapmgl',
  chromeForTesting: 'HKCU\\Software\\Google\\Chrome for Testing\\Extensions\\ofgemipoobcnbjkfanmofjbdonjapmgl',
  brave: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\Extensions\\ofgemipoobcnbjkfanmofjbdonjapmgl',
  edge: 'HKCU\\Software\\Microsoft\\Edge\\Extensions\\ofgemipoobcnbjkfanmofjbdonjapmgl',
};

test('writes each vendor key with update_url', () => {
  for (const [vendor, key] of Object.entries(KEYS)) {
    const calls = [];
    const result = writeExtensionKey({ vendor, exec: (cmd, args) => calls.push([cmd, ...args]) });
    assert.equal(result.ok, true, vendor);
    assert.deepEqual(calls, [['reg', 'add', key, '/v', 'update_url', '/t', 'REG_SZ', '/d', UPDATE_URL, '/f']], vendor);
  }
});

test('unknown vendor fails cleanly, nothing executed', () => {
  const calls = [];
  const result = writeExtensionKey({ vendor: 'firefox', exec: (cmd, args) => calls.push(cmd) });
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown vendor/);
  assert.deepEqual(calls, []);
});

test('returns ok:false with the message on failure', () => {
  const result = writeExtensionKey({ vendor: 'chrome', exec: () => { throw new Error('access denied'); } });
  assert.equal(result.ok, false);
  assert.match(result.error, /access denied/i);
});

test('deletes each vendor key', () => {
  for (const [vendor, key] of Object.entries(KEYS)) {
    const calls = [];
    const result = deleteExtensionKey({ vendor, exec: (cmd, args) => calls.push([cmd, ...args]) });
    assert.equal(result.ok, true, vendor);
    assert.deepEqual(calls, [['reg', 'delete', key, '/f']], vendor);
  }
});

test('delete returns ok:false when the key does not exist and exec throws', () => {
  const result = deleteExtensionKey({ vendor: 'edge', exec: () => { const e = new Error('Unable to find the specified registry key or value.'); e.status = 1; throw e; } });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unable to find/);
});

test('extension id is the pinned one', () => assert.equal(EXTENSION_ID, 'ofgemipoobcnbjkfanmofjbdonjapmgl'));
