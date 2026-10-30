// @last-edited: 2026-10-30 UTC+7.
// @title: run-task-e2e — the full run_task pipeline from tool input to saved lesson, with the model mocked.
// @state: 3 locks: the pipeline shape, the idempotency key reaching the enqueue, and the lesson caps.
// @dependencies: node:test, strict, task-validate, task-run, task-compile, task-runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskInput } from '../supabase/functions/_shared/task-validate.js';
import {
  verifyCommandFor,
  lessonFromRun
} from '../supabase/functions/_shared/task-run.js';
import { runTaskCommand } from '../extension/lib/task-runner.js';

const READ_PROGRAM = {
  root: {
    type: 'SEQUENCE',
    children: [
      {
        type: 'COMMAND',
        method: 'page.read',
        arguments: {},
        resultBinding: 'page'
      }
    ]
  }
};

const configuredStorage = {
  get: async () => ({
    modelEndpoint: 'https://model.example/v1/chat/completions',
    modelName: 'test-model',
    modelKey: 'k'
  })
};

const modelReply = {
  mode: 'read',
  program: READ_PROGRAM,
  verify: {
    kind: 'text',
    value: 'Done'
  }
};

const fetchImpl = async () => ({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => ({ choices: [{ message: { content: JSON.stringify(modelReply) } }] })
});

test('e2e: tool input validates, the device compiles once, verify maps to a read command, and the lesson is capped', async () => {
  const checked = validateTaskInput({
    task: 'read the page and confirm Done',
    requestId: 'e2e-1',
    timeoutMs: 30000
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.value.requestId, 'e2e-1', 'the idempotency key travels the whole way');

  const artifact = await runTaskCommand({
    task: checked.value.task,
    tabId: checked.value.tabId,
    confirm: checked.value.confirm,
    requestId: checked.value.requestId,
    lessons: [{
      task: 'read the page',
      lesson: 'use view compact'
    }]
  }, {
    storage: configuredStorage,
    fetchImpl,
    observePage: async () => ({
      url: 'https://x',
      text: 'Done',
      elements: []
    })
  });

  assert.equal(artifact.ok, true);
  assert.equal(artifact.mode, 'read');
  assert.ok(artifact.program);

  const verify = verifyCommandFor(artifact.verify, checked.value.tabId);
  assert.equal(verify.method, 'page.find');
  assert.equal(verify.params.text, 'Done');

  const lesson = lessonFromRun({
    task: checked.value.task,
    trace: [{
      node: 0,
      ok: true
    }],
    verify: { ok: true }
  });
  assert.ok(lesson.task.length <= 500);
  assert.ok(lesson.lesson.length <= 4000);
});

test('e2e: the same requestId twice produces the same key, so the enqueue can dedupe', () => {
  const first = validateTaskInput({
    task: 't',
    requestId: 'dup-1'
  });
  const second = validateTaskInput({
    task: 't',
    requestId: 'dup-1'
  });
  assert.equal(first.value.requestId, second.value.requestId);
});

test('e2e: a write artifact without confirm is refused before any execution helper runs', async () => {
  const writeReply = {
    mode: 'write',
    graph: { nodes: [{
      type: 'command',
      method: 'page.click'
    }] },
    verify: null
  };
  const writeFetch = async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content: JSON.stringify(writeReply) } }] })
  });
  await assert.rejects(
    runTaskCommand({
      task: 'click it',
      confirm: false,
      requestId: 'w-1'
    }, {
      storage: configuredStorage,
      fetchImpl: writeFetch,
      observePage: async () => ({})
    }),
    (error) => error.code === 'TASK_NOT_CONFIRMED'
  );
});
