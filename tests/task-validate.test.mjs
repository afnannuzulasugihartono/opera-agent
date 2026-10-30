// @last-edited: 2026-10-30 UTC+7.
// @title: task-validate — pure input validation for the run_task tool, shared by the edge function and tests.
// @state: one validator: task string 1..1200, requestId idempotency pattern, timeout clamp 1000..120000, confirm boolean.
// @dependencies: none.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateTaskInput } from '../supabase/functions/_shared/task-validate.js';

const mcpSource = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');

test('run_task server wiring: validates, recalls lessons, enqueues task.run with the requestId for idempotency', () => {
  assert.match(mcpSource, /validateTaskInput\(\{[\s\S]*?\}\)/, 'input is validated before anything is enqueued');
  assert.match(mcpSource, /opera_skill_recall/, 'matching lessons are recalled before enqueue');
  assert.match(mcpSource, /runCommand\("task\.run", \{/, 'the device command is task.run');
  assert.match(mcpSource, /p_request_id: requestId/, 'the enqueue carries the requestId, so a replayed key cannot run twice');
  assert.match(mcpSource, /lessons/, 'recalled lessons travel inside the task.run params');
});

test('run_task input: a well-formed task is accepted with defaults applied', () => {
  const result = validateTaskInput({
    task: 'download the statement',
    requestId: 'req-1'
  });
  assert.deepEqual(result, {
    ok: true,
    value: {
      task: 'download the statement',
      tabId: null,
      confirm: false,
      requestId: 'req-1',
      timeoutMs: 60000
    }
  });
});

test('run_task input: a task over 1200 characters is refused before anything is enqueued', () => {
  const result = validateTaskInput({
    task: 'x'.repeat(1201),
    requestId: 'req-1'
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_TASK');
});

test('run_task input: a non-string task is refused', () => {
  assert.equal(validateTaskInput({
    task: 42,
    requestId: 'r'
  }).code, 'INVALID_TASK');
  assert.equal(validateTaskInput({ requestId: 'r' }).code, 'INVALID_TASK');
});

test('run_task input: a malformed requestId is refused, never silently ignored', () => {
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'bad id!'
  }).code, 'INVALID_REQUEST');
  assert.equal(validateTaskInput({ task: 't' }).code, 'INVALID_REQUEST');
});

test('run_task input: timeout is clamped to 1000..120000 and defaults to 60000', () => {
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    timeoutMs: 10
  }).value.timeoutMs, 1000);
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    timeoutMs: 999999
  }).value.timeoutMs, 120000);
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    timeoutMs: 'nope'
  }).value.timeoutMs, 60000);
});

test('run_task input: tabId must be a non-negative integer when present', () => {
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    tabId: 7
  }).value.tabId, 7);
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    tabId: -1
  }).code, 'INVALID_TAB');
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    tabId: 'x'
  }).code, 'INVALID_TAB');
});

test('run_task input: confirm must be a boolean when present', () => {
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    confirm: true
  }).value.confirm, true);
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    confirm: 'yes'
  }).code, 'INVALID_CONFIRM');
});
