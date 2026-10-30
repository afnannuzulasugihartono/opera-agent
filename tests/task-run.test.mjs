// @last-edited: 2026-10-30 UTC+7.
// @title: task-run — pure helpers for executing a compiled run_task artifact: the verify command and the saved lesson.
// @state: maps the model's verify clause to one allowlisted read command; lessonFromRun summarizes a run into capped skill fields.
// @dependencies: none.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyCommandFor,
  lessonFromRun
} from '../supabase/functions/_shared/task-run.js';

test('verifyCommandFor: a text clause maps to page.find on the target tab', () => {
  assert.deepEqual(verifyCommandFor({
    kind: 'text',
    value: 'Done'
  }, 7), {
    method: 'page.find',
    params: {
      tabId: 7,
      text: 'Done',
      limit: 1
    }
  });
});

test('verifyCommandFor: a selector clause maps to page.query', () => {
  assert.deepEqual(verifyCommandFor({
    kind: 'selector',
    value: '#done'
  }, 3), {
    method: 'page.query',
    params: {
      tabId: 3,
      selector: '#done',
      limit: 1
    }
  });
});

test('verifyCommandFor: a ref clause maps to a bounded page.read', () => {
  const command = verifyCommandFor({
    kind: 'ref',
    value: 'e12'
  }, null);
  assert.equal(command.method, 'page.read');
  assert.equal(command.params.includeElements, true);
  assert.ok(command.params.maxElements <= 200);
  assert.equal(command.params.tabId, null);
});

test('verifyCommandFor: a null clause maps to no command', () => {
  assert.equal(verifyCommandFor(null, 1), null);
});

test('verifyCommandFor: an unknown kind is refused', () => {
  assert.equal(verifyCommandFor({
    kind: 'magic',
    value: 'x'
  }, 1), null);
});

test('lessonFromRun: a passing run summarizes what worked, capped', () => {
  const lesson = lessonFromRun({
    task: 'download the statement',
    trace: [
      {
        node: 0,
        ok: true
      },
      {
        node: 1,
        ok: true
      }
    ],
    verify: { ok: true }
  });
  assert.ok(lesson.task.length <= 500);
  assert.ok(lesson.lesson.length <= 4000);
  assert.match(lesson.lesson, /2 of 2 nodes ok/);
  assert.match(lesson.lesson, /verified/);
});

test('lessonFromRun: a failing run names the failed node as the pitfall', () => {
  const lesson = lessonFromRun({
    task: 'pay the invoice',
    trace: [
      {
        node: 0,
        ok: true
      },
      {
        node: 1,
        ok: false,
        why: 'stale ref'
      }
    ],
    verify: { ok: false }
  });
  assert.match(lesson.pitfalls, /node 1 failed: stale ref/);
  assert.match(lesson.pitfalls, /verify failed/);
});
