// @last-edited: 2026-10-30 UTC+7.
// @title: task-validate — pure input validation for the run_task tool, shared by the edge function and tests.
// @state: one validator: task string 1..1200, requestId idempotency pattern, timeout clamp 1000..30000, confirm boolean.
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

test('run_task server execution: the compiled artifact is executed through the existing lanes, verified, and lessoned', () => {
  assert.match(mcpSource, /if \(!caller\)[\s\S]*?run_task needs a user access token/, 'run_task is scoped to a user token like run_program');
  assert.match(mcpSource, /sealVmProgram\(artifact\.program, caller\)/, 'the read lane seals the program before enqueue');
  assert.match(mcpSource, /callVmHost\("enqueue"/, 'the read lane runs through the VM host');
  assert.match(mcpSource, /runAdhoc\(artifact\.graph/, 'the write lane runs through the existing adhoc flow');
  assert.match(mcpSource, /verifyCommandFor\(artifact\.verify/, 'the verify clause becomes one allowlisted read command');
  assert.match(mcpSource, /lessonFromRun\(\{[\s\S]*?opera_skill_save/, 'a finished run saves one capped lesson');
  assert.match(mcpSource, /TASK_NOT_CONFIRMED/, 'a write artifact without confirm is refused server-side too');
});

test('run_task review fixes: replay short-circuits, ok gates on status, unknown verify fails closed, lesson only on success', () => {
  assert.match(mcpSource, /reused: Boolean\(queued\.reused\)/, 'runCommand surfaces the enqueue replay marker');
  assert.match(mcpSource, /if \(compiled\?\.reused\)/, 'a replayed requestId never re-executes the artifact');
  assert.match(mcpSource, /ok: status === "completed" && verify\.ok/, 'ok requires a completed run AND a passed verify');
  assert.match(mcpSource, /if \(runId && status === "running"\) status = "timeout"/, 'a poll that expires reports timeout, not completed');
  assert.match(mcpSource, /unknown verify kind/, 'an unmappable verify clause fails closed');
  assert.match(mcpSource, /Number\(result\?\.count\) > 0/, 'a text or selector verify reads the count the device actually returns');
  assert.match(mcpSource, /if \(status === "completed" && verify\.ok\) \{[\s\S]*?opera_skill_save/, 'the lesson is saved only on a successful verified run');
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

test('run_task input: timeout is clamped to 1000..30000 (the command await bound) and defaults to 60000', () => {
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    timeoutMs: 10
  }).value.timeoutMs, 1000);
  assert.equal(validateTaskInput({
    task: 't',
    requestId: 'r',
    timeoutMs: 999999
  }).value.timeoutMs, 30000);
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
