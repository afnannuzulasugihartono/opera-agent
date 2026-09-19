import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const statePath = resolve(root, 'PROJECT_STATE.json');
const agentsPath = resolve(root, 'AGENTS.md');
const handoffPath = resolve(root, 'docs', 'next-session-handoff.md');

const errors = [];
const requireState = (condition, message) => {
  if (!condition) errors.push(message);
};

requireState(existsSync(statePath), 'PROJECT_STATE.json is missing');

let state = null;
if (existsSync(statePath)) {
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (error) {
    errors.push(`PROJECT_STATE.json is invalid JSON: ${error.message}`);
  }
}

function parseTasks(markdown) {
  const rows = [];
  let checkpoint = null;
  for (const line of markdown.split(/\r?\n/)) {
    const phase = line.match(/^## Phase (R\d+)\b/);
    if (phase) checkpoint = phase[1];
    const match = line.match(/^- \[([ xX])\] (T\d{3})\b/);
    if (match) rows.push({ id: match[2], complete: match[1].toLowerCase() === 'x', checkpoint });
  }
  return rows;
}

if (state) {
  requireState(state.schemaVersion === 1, 'schemaVersion must be 1');
  requireState(state.status === 'in_progress', 'current governance expects status=in_progress');
  requireState(/^T\d{3}$/.test(state.next?.task ?? ''), 'next.task must be a T### task id');
  requireState(typeof state.activeFeature === 'string' && state.activeFeature.length > 0, 'activeFeature is required');
  requireState(/^R\d+$/.test(state.activeCheckpoint ?? ''), 'activeCheckpoint must be an R# checkpoint');

  const tasksPath = resolve(root, state.activeFeature ?? '', 'tasks.md');
  requireState(existsSync(tasksPath), `active feature tasks file is missing: ${tasksPath}`);

  if (existsSync(tasksPath)) {
    const tasks = parseTasks(readFileSync(tasksPath, 'utf8'));
    const nextIndex = tasks.findIndex((task) => task.id === state.next?.task);
    requireState(nextIndex >= 0, `next task ${state.next?.task} is not present in canonical tasks.md`);

    if (nextIndex >= 0) {
      requireState(tasks[nextIndex].complete === false, `next task ${state.next.task} is already checked complete; advance PROJECT_STATE atomically`);
      requireState(tasks[nextIndex].checkpoint === state.activeCheckpoint, `next task ${state.next.task} belongs to ${tasks[nextIndex].checkpoint}, not active checkpoint ${state.activeCheckpoint}`);

      const earlierIncomplete = tasks.slice(0, nextIndex).filter((task) => !task.complete);
      requireState(earlierIncomplete.length === 0, `tasks before ${state.next.task} are incomplete: ${earlierIncomplete.map((task) => task.id).join(', ')}`);
    }
  }

  requireState(state.scopeLocks?.milestone8E === 'explicit_user_instruction_required', 'milestone8E scope lock changed');
  requireState(state.scopeLocks?.productionPromotion === 'explicit_user_instruction_required', 'productionPromotion scope lock changed');
  requireState(state.scopeLocks?.realtimeTransport === 'separate_review_required_if_T033_justifies', 'realtimeTransport scope lock changed');
  requireState(Array.isArray(state.requiredGates) && state.requiredGates.includes('ci/circleci: test') && state.requiredGates.includes('Vercel'), 'requiredGates must include CircleCI and Vercel');
}

const agents = readFileSync(agentsPath, 'utf8');
requireState(/PROJECT_STATE\.json[^\n]*current execution state/i.test(agents), 'AGENTS.md must declare PROJECT_STATE.json as current execution state');
requireState(/exact next task[^\n]*PROJECT_STATE\.json/i.test(agents), 'AGENTS.md must make PROJECT_STATE.json authoritative for the exact next task');
requireState(/must not override|must not redefine|not.*authority/i.test(agents), 'AGENTS.md must forbid duplicate next-task authority');

const handoffTop = readFileSync(handoffPath, 'utf8').split(/\r?\n/).slice(0, 30).join('\n');
requireState(/PROJECT_STATE\.json/.test(handoffTop), 'handoff top must point to PROJECT_STATE.json');
requireState(/exact next/i.test(handoffTop) && /authoritative|authority/i.test(handoffTop), 'handoff top must delegate exact-next authority to PROJECT_STATE.json');

if (errors.length > 0) {
  console.error('[project-state] DRIFT DETECTED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`[project-state] OK: ${state.activeCheckpoint} / next ${state.next.task}`);
