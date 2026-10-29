// @last-edited: 2026-10-14 UTC+7.
// @title: socket-execute-bound.test — one hung command must not wedge the device drain.
// @state: unit pins the bound plus the source pin proving the drain uses it.
// @dependencies: node:test, strict, node:fs, node:fs/promises.

// WHY THE BOUND EXISTS.
// The relay drain awaited execute() with no deadline, so a single CDP call that never settled held the queue for good and no completion ever went out: the runner waited its full budget and the caller saw an unexplained timeout instead of the one command that hung.
// The bridge half already bounded this; the relay half did not.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = await fs.promises.readFile(
  new URL('../extension/lib/socket-client.js', import.meta.url), 'utf8'
);

test('the drain bounds every command it executes', () => {
  const drain = source.slice(source.indexOf('const drain = async ()'), source.indexOf('function connect()'));
  assert.match(drain, /withExecuteTimeout\(execute, command\)|executeWithinBound|withExecuteTimeout/,
    'the drain must execute through the bound, not straight through execute');
  assert.match(drain, /draining = false/, 'the bound must not leave the drain latched');
});

test('the bound is a race that rejects with a named error, and it is injectable', () => {
  assert.match(source, /export function executeBoundMs\(/, 'the bound is a function so a test can call it');
  assert.match(source, /globalThis\.OPERA_SOCKET_EXECUTE_TIMEOUT_MS/, 'tests shorten the bound without waiting a minute');
  assert.match(source, /no answer from the tab within/, 'the failure names what hung');
});

test('a hung command still releases the queue for the next one', async () => {
  const module = await import('../extension/lib/socket-client.js');
  const bound = module.executeBoundMs ?? null;
  assert.equal(typeof bound, 'function', 'the bound helper is exported for the unit test');

  const previous = globalThis.OPERA_SOCKET_EXECUTE_TIMEOUT_MS;
  globalThis.OPERA_SOCKET_EXECUTE_TIMEOUT_MS = '40';
  try {
    const slow = () => new Promise(() => {});
    await assert.rejects(() => module.withExecuteTimeout(slow, '2026-10-14T00:00:00Z'), /no answer from the tab within 40 ms/);

    const after = await module.withExecuteTimeout(async () => ({
      ok: true,
      tabs: []
    }), '2026-10-14T00:00:01Z');
    assert.equal(after.ok, true, 'the queue walks free behind the abandoned command');
  } finally {
    if (previous === undefined) delete globalThis.OPERA_SOCKET_EXECUTE_TIMEOUT_MS;
    else globalThis.OPERA_SOCKET_EXECUTE_TIMEOUT_MS = previous;
  }
});
