// @last-edited: 2026-10-30 UTC+7.
// @title: task-compile — pure parse and gate for the run_task model reply, testable from Node.
// @state: parses the model's { mode, program|graph, verify } reply and gates it: read lane through compileGoalPlan, write lane needs confirm and is compiled server-side by the existing adhoc compiler.
// @dependencies: goal-plan.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaskReply,
  buildTaskPrompt,
  gateTaskReply
} from '../extension/lib/task-compile.js';

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

test('parseTaskReply: a read reply with program and verify parses', () => {
  const reply = parseTaskReply(JSON.stringify({
    mode: 'read',
    program: READ_PROGRAM,
    verify: {
      kind: 'text',
      value: 'Done'
    }
  }));
  assert.deepEqual(reply, {
    ok: true,
    mode: 'read',
    program: READ_PROGRAM,
    verify: {
      kind: 'text',
      value: 'Done'
    }
  });
});

test('parseTaskReply: malformed JSON is refused with a code', () => {
  const reply = parseTaskReply('not json');
  assert.equal(reply.ok, false);
  assert.equal(reply.code, 'TASK_NOT_JSON');
});

test('parseTaskReply: an unknown mode is refused', () => {
  const reply = parseTaskReply(JSON.stringify({
    mode: 'explode',
    program: {}
  }));
  assert.equal(reply.ok, false);
  assert.equal(reply.code, 'TASK_BAD_MODE');
});

test('parseTaskReply: an unknown verify kind is refused', () => {
  const reply = parseTaskReply(JSON.stringify({
    mode: 'read',
    program: READ_PROGRAM,
    verify: { kind: 'magic' }
  }));
  assert.equal(reply.ok, false);
  assert.equal(reply.code, 'TASK_BAD_VERIFY');
});

test('buildTaskPrompt: lessons are appended to the user message and the goal stays capped', () => {
  const prompt = buildTaskPrompt({
    task: 'open the transcript panel',
    lessons: [{
      task: 'open transcript panel',
      lesson: 'click the menu first'
    }],
    page: {
      url: 'https://x',
      text: 'hi',
      elements: []
    }
  });
  assert.equal(prompt.ok, true);
  assert.match(prompt.user, /GOAL: open the transcript panel/);
  assert.match(prompt.user, /<lessons>/);
  assert.match(prompt.user, /click the menu first/);
});

test('gateTaskReply: a read program is gated through compileGoalPlan and passes with a target', () => {
  const parsed = parseTaskReply(JSON.stringify({
    mode: 'read',
    program: READ_PROGRAM,
    verify: null
  }));
  const gated = gateTaskReply(parsed, {
    confirm: false,
    target: {
      device: 'opera',
      tabId: 1
    },
    budgets: {
      astDepth: 8,
      browserCommandLeavesPerRun: 12
    }
  });
  assert.equal(gated.ok, true);
  assert.equal(gated.mode, 'read');
  assert.ok(gated.program, 'the sealed program is returned');
});

test('gateTaskReply: a read program that sets an owned field is refused', () => {
  const owned = JSON.parse(JSON.stringify(READ_PROGRAM));
  owned.tenantId = 'x';
  const parsed = parseTaskReply(JSON.stringify({
    mode: 'read',
    program: owned,
    verify: null
  }));
  const gated = gateTaskReply(parsed, {
    confirm: false,
    target: {
      device: 'opera',
      tabId: 1
    },
    budgets: {}
  });
  assert.equal(gated.ok, false);
  assert.match(gated.code, /PLAN_/);
});

test('gateTaskReply: a write reply without confirm is refused and nothing is returned for registration', () => {
  const parsed = parseTaskReply(JSON.stringify({
    mode: 'write',
    graph: { nodes: [] },
    verify: null
  }));
  const gated = gateTaskReply(parsed, {
    confirm: false,
    target: {},
    budgets: {}
  });
  assert.equal(gated.ok, false);
  assert.equal(gated.code, 'TASK_NOT_CONFIRMED');
  assert.equal(gated.graph, undefined);
});

test('gateTaskReply: a write reply with confirm passes through for the server-side adhoc compiler', () => {
  const graph = { nodes: [{
    type: 'command',
    method: 'page.read'
  }] };
  const parsed = parseTaskReply(JSON.stringify({
    mode: 'write',
    graph,
    verify: null
  }));
  const gated = gateTaskReply(parsed, {
    confirm: true,
    target: {},
    budgets: {}
  });
  assert.equal(gated.ok, true);
  assert.equal(gated.mode, 'write');
  assert.deepEqual(gated.graph, graph);
});
