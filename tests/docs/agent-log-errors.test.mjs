// @last-edited: 2026-11-08 UTC+7.
// @title: agent-log-errors.test — the fault list: one row per distinct fault, and a count that never lies.
// @state: the dedupe, the cap, the clear, and the ring it must not disturb.
// @dependencies: node:test, strict, ../extension/lib/agent-log.js.

import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../extension/lib/agent-log.js');
const log = globalThis.OperaAgentLog;

test('a repeated fault is one row with a count', () => {
  log.clearErrors();
  log.error('WORKER_UNCAUGHT_ERROR', 'boom');
  log.error('WORKER_UNCAUGHT_ERROR', 'boom');
  const rows = log.errors();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'WORKER_UNCAUGHT_ERROR');
  assert.equal(rows[0].message, 'boom');
  assert.equal(rows[0].count, 2);
  assert.ok(rows[0].firstAt <= rows[0].lastAt);
});

test('a different message is a different fault, newest first', () => {
  log.clearErrors();
  log.error('A', 'one');
  log.error('A', 'two');
  assert.deepEqual(log.errors().map((row) => row.message), ['two', 'one']);
});

test('the list keeps twenty unique faults and drops the oldest', () => {
  log.clearErrors();
  for (let index = 0; index < 25; index += 1) log.error('E' + index, 'm' + index);
  const rows = log.errors();
  assert.equal(rows.length, 20);
  assert.equal(rows[0].code, 'E24');
  assert.equal(rows.at(-1).code, 'E5');
});

test('debug and warn never fill the fault list, and the ring keeps every level', () => {
  log.clearErrors();
  log.clear();
  log.warn('ONLY_WARN', 'w');
  log.debug('ONLY_DEBUG', 'd');
  assert.deepEqual(log.errors(), []);
  assert.ok(log.entries().some((entry) => entry.code === 'ONLY_WARN'));
  assert.ok(log.entries().some((entry) => entry.code === 'ONLY_DEBUG'));
});

test('clearing the list keeps the total, and the total counts every fault', () => {
  log.clearErrors();
  const before = log.errorCount();
  log.error('K', 'k');
  log.error('K', 'k');
  assert.equal(log.errorCount(), before + 2);
  log.clearErrors();
  assert.deepEqual(log.errors(), []);
  assert.equal(log.errorCount(), before + 2);
});
