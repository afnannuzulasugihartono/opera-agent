// @last-edited: 2026-10-14 UTC+7.
// @title: runner-command-result.test — a device-reported failure fails the step, not just transport errors.
// @state: unit pins for commandFailure plus the runner wiring pin.
// @dependencies: node:test, strict, ../supabase/functions/_shared/command-result.js.

// WHY the runner unwraps one level.
// A burst that fails in-page (a find with no match, a stale ref) comes back transport-ok carrying { ok: false } as its payload, and the runner used to record it and continue: every workflow walked blind past the miss until an end-check, if one existed.
// Failing on the payload is what makes a mid-walk miss loud at the step that missed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { commandFailure } from '../supabase/functions/_shared/command-result.js';

test('a completed burst carrying ok:false fails with the device error', () => {
  const failure = commandFailure({
    ok: true,
    result: { ok: false, error: { code: 'EXECUTION_ERROR', message: 'step 2 returned none' } }
  });

  assert.deepEqual(failure, {
    code: 'EXECUTION_ERROR',
    message: 'step 2 returned none',
    details: { code: 'EXECUTION_ERROR', message: 'step 2 returned none' }
  });
});

test('a device failure without an error shape falls back to COMMAND_FAILED', () => {
  const failure = commandFailure({ ok: true, result: { ok: false } });

  assert.deepEqual(failure, {
    code: 'COMMAND_FAILED',
    message: 'Workflow command failed.',
    details: null
  });
});

test('reads and finds without an ok field stay successful', () => {
  assert.equal(commandFailure({ ok: true, result: { page: { text: 'hi' } } }), null);
  assert.equal(commandFailure({ ok: true, result: { ok: true, item: null, count: 0 } }), null);
  assert.equal(commandFailure({ ok: true, result: null }), null);
  assert.equal(commandFailure({ ok: true }), null);
});

test('a transport failure keeps its own code and message', () => {
  const failure = commandFailure({ ok: false, error: { code: 'AWAIT_OUTCOME_UNKNOWN', message: 'stopped waiting' } });

  assert.deepEqual(failure, {
    code: 'AWAIT_OUTCOME_UNKNOWN',
    message: 'stopped waiting',
    details: { code: 'AWAIT_OUTCOME_UNKNOWN', message: 'stopped waiting' }
  });
});

test('a bare transport failure falls back to COMMAND_FAILED', () => {
  const failure = commandFailure({ ok: false });

  assert.deepEqual(failure, {
    code: 'COMMAND_FAILED',
    message: 'Workflow command failed.',
    details: null
  });
});

test('the runner fails a step on the unwrapped failure unless continued', () => {
  const runner = fs.readFileSync(
    new URL('../supabase/functions/opera-agent-runner/index.ts', import.meta.url),
    'utf8'
  );
  const branch = runner.slice(
    runner.indexOf('ctx.steps[id] = result;'),
    runner.indexOf('continue;', runner.indexOf('ctx.steps[id] = result;'))
  );

  assert.match(branch, /commandFailure\(result\)/);
  assert.match(branch, /continueOnError/);
});
