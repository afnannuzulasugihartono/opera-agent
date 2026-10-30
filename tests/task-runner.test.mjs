// @last-edited: 2026-10-30 UTC+7.
// @title: task-runner — the device-side run_task command: validate, one model call, gate, return the compiled artifact.
// @state: 6 locks; codes are stable so the tool can switch on them.
// @dependencies: node:test, strict, task-runner.

import test from 'node:test';
import assert from 'node:assert/strict';
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

const reply = (body) => async () => ({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] })
});

const observePage = async () => ({
  url: 'https://x',
  text: 'hi',
  elements: []
});

test('run_task rejects a non-string task before any model call', async () => {
  let called = 0;
  await assert.rejects(
    runTaskCommand({ task: 42 }, {
      storage: configuredStorage,
      fetchImpl: async () => {
        called += 1;
      }
    }),
    (error) => error.code === 'INVALID_TASK'
  );
  assert.equal(called, 0);
});

test('run_task read lane: exactly one model call and the sealed program comes back for the server to execute', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return reply({
      mode: 'read',
      program: READ_PROGRAM,
      verify: {
        kind: 'text',
        value: 'Done'
      }
    })();
  };
  const result = await runTaskCommand({
    task: 'read the page',
    confirm: false,
    requestId: 'r1',
    lessons: []
  }, {
    storage: configuredStorage,
    fetchImpl,
    observePage
  });
  assert.equal(calls, 1, 'exactly one model call per task');
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'read');
  assert.ok(result.program, 'the sealed program is returned');
  assert.deepEqual(result.verify, {
    kind: 'text',
    value: 'Done'
  });
  assert.ok(result.page, 'the capped observation travels with the artifact');
});

test('run_task refuses before any network call when the model is not configured', async () => {
  let called = 0;
  await assert.rejects(
    runTaskCommand({
      task: 't',
      requestId: 'r'
    }, {
      storage: { get: async () => ({}) },
      fetchImpl: async () => {
        called += 1;
      },
      observePage
    }),
    (error) => error.code === 'MODEL_NOT_CONFIGURED'
  );
  assert.equal(called, 0);
});

test('run_task refuses a write reply without confirm and returns no graph', async () => {
  const fetchImpl = reply({
    mode: 'write',
    graph: { nodes: [] },
    verify: null
  });
  await assert.rejects(
    runTaskCommand({
      task: 't',
      confirm: false,
      requestId: 'r'
    }, {
      storage: configuredStorage,
      fetchImpl,
      observePage
    }),
    (error) => error.code === 'TASK_NOT_CONFIRMED'
  );
});

test('run_task passes a confirmed write reply through as a graph for the server-side adhoc compiler', async () => {
  const graph = { nodes: [{
    type: 'command',
    method: 'page.read'
  }] };
  const fetchImpl = reply({
    mode: 'write',
    graph,
    verify: null
  });
  const result = await runTaskCommand({
    task: 't',
    confirm: true,
    requestId: 'r'
  }, {
    storage: configuredStorage,
    fetchImpl,
    observePage
  });
  assert.equal(result.mode, 'write');
  assert.deepEqual(result.graph, graph);
});

test('run_task returns the compile refusal code when the gate refuses', async () => {
  const owned = JSON.parse(JSON.stringify(READ_PROGRAM));
  owned.tenantId = 'x';
  const fetchImpl = reply({
    mode: 'read',
    program: owned,
    verify: null
  });
  await assert.rejects(
    runTaskCommand({
      task: 't',
      requestId: 'r'
    }, {
      storage: configuredStorage,
      fetchImpl,
      observePage
    }),
    (error) => error.code === 'PLAN_SETS_OWNED_FIELD'
  );
});
