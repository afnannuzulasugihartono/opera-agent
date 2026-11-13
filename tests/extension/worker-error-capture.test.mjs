// @last-edited: 2026-11-08 UTC+7.
// @title: worker-error-capture.test — the worker's own faults reach the logger, without a worker.
// @state: the two listeners, the message each carries, and the report Chrome keeps.
// @dependencies: node:test, strict, ../extension/worker/error-capture.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { captureWorkerErrors } from '../../extension/lib/error-capture.js';

function harness() {
  const listeners = {};
  const calls = [];
  const target = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const log = { error: (code, message) => calls.push({ code, message }) };
  captureWorkerErrors({ target, log });
  return { listeners, calls };
}

test('both worker channels are watched', () => {
  const { listeners } = harness();
  assert.equal(typeof listeners.error, 'function');
  assert.equal(typeof listeners.unhandledrejection, 'function');
});

test('an uncaught error becomes one fault, and its message is carried whole', () => {
  const { listeners, calls } = harness();
  const message = 'x'.repeat(5000);
  listeners.error({ error: new Error(message) });
  assert.deepEqual(calls, [{ code: 'WORKER_UNCAUGHT_ERROR', message }]);
});

test('a rejection becomes one fault, with or without an Error', () => {
  const { listeners, calls } = harness();
  listeners.unhandledrejection({ reason: new Error('refused') });
  listeners.unhandledrejection({ reason: 'plain string' });
  assert.deepEqual(calls, [
    { code: 'WORKER_UNHANDLED_REJECTION', message: 'refused' },
    { code: 'WORKER_UNHANDLED_REJECTION', message: 'plain string' }
  ]);
});

test('the report Chrome makes is not cancelled', () => {
  const { listeners } = harness();
  let prevented = false;
  listeners.error({ error: new Error('boom'), preventDefault: () => { prevented = true; } });
  listeners.unhandledrejection({ reason: new Error('boom'), preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});
