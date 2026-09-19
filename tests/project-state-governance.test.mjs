import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const statePath = resolve(root, 'PROJECT_STATE.json');
const agentsPath = resolve(root, 'AGENTS.md');

function parseTasks(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^- \[([ xX])\] (T\d{3})\b/);
    if (match) rows.push({ id: match[2], complete: match[1].toLowerCase() === 'x' });
  }
  return rows;
}

test('repository has one machine-readable current execution state', () => {
  assert.equal(
    existsSync(statePath),
    true,
    'PROJECT_STATE.json must exist as the single machine-readable current execution state',
  );
});

test('PROJECT_STATE next task agrees with canonical Spec Kit tasks', () => {
  assert.equal(existsSync(statePath), true, 'PROJECT_STATE.json must exist before validating it');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  assert.equal(state.schemaVersion, 1);
  assert.match(state.next?.task ?? '', /^T\d{3}$/);
  assert.equal(typeof state.activeFeature, 'string');
  assert.equal(state.status, 'in_progress');

  const tasksPath = resolve(root, state.activeFeature, 'tasks.md');
  assert.equal(existsSync(tasksPath), true, `active feature tasks file must exist: ${tasksPath}`);

  const tasks = parseTasks(readFileSync(tasksPath, 'utf8'));
  const nextIndex = tasks.findIndex((task) => task.id === state.next.task);
  assert.notEqual(nextIndex, -1, `next task ${state.next.task} must exist in canonical tasks.md`);
  assert.equal(tasks[nextIndex].complete, false, `next task ${state.next.task} must still be unchecked`);

  const earlierIncomplete = tasks.slice(0, nextIndex).filter((task) => !task.complete);
  assert.deepEqual(
    earlierIncomplete,
    [],
    `all tasks before ${state.next.task} must be complete before advancing PROJECT_STATE`,
  );
});

test('PROJECT_STATE keeps critical scope locks explicit', () => {
  assert.equal(existsSync(statePath), true, 'PROJECT_STATE.json must exist before validating scope locks');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  assert.equal(state.scopeLocks?.milestone8E, 'explicit_user_instruction_required');
  assert.equal(state.scopeLocks?.productionPromotion, 'explicit_user_instruction_required');
  assert.equal(state.scopeLocks?.realtimeTransport, 'separate_review_required_if_T033_justifies');
});

test('AGENTS declares PROJECT_STATE as current-state authority and forbids duplicate next-task authority', () => {
  const agents = readFileSync(agentsPath, 'utf8');

  assert.match(agents, /PROJECT_STATE\.json[^\n]*current execution state/i);
  assert.match(agents, /exact next task[^\n]*PROJECT_STATE\.json/i);
  assert.match(agents, /roadmap|spec|handoff/i);
  assert.match(agents, /must not override|must not redefine|not.*authority/i);
});
