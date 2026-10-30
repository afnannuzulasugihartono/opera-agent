// @last-edited: 2026-10-05 00:25 UTC+7.
// @title: goal-plan — compiles model text into a program the device may run.
// @state: The caller owns identity, target and budgets; the model owns the shape, and the prompt names the same allowlist.
// @dependencies: extension/lib/protocol.

// WHY this exists: a plan is handed over once and executed locally, so the model is not in the step loop.
// That removes the per-step round trip, and it also means model text becomes an action machine directly.
// This module is the narrow door between the two, and it is deliberately pure: no network, no DOM, no chrome, so it can be tested exhaustively and run anywhere.

// The rule it enforces is one sentence: the caller owns who runs, where, and under which budgets.
// The model only supplies the shape of the task.
// Anything else in the reply is refused rather than repaired, because a repaired refusal teaches the caller that model output is trusted.

import { ALLOWED_METHODS } from './protocol.js';

const GOAL_MAX_CHARS = 1200;
const PAGE_ELEMENT_LIMIT = 40;

function refuseRequest(
  code,
  message
) {
  return {
    ok: false,
    code,
    message
  };
}

function summarizePage(page) {
  const elements = Array.isArray(page?.elements) ? page.elements.slice(0, PAGE_ELEMENT_LIMIT) : [];
  const shown = elements.map((el) => ({
    ref: el?.ref,
    role: el?.role,
    label: el?.label || el?.text || '',
    actionable: el?.actionable === true
  }));
  return {
    url: page?.url || '',
    text: String(page?.text || '').slice(0, 1200),
    elements: shown,
    elementsShown: shown.length,
    elementsTotal: Array.isArray(page?.elements) ? page.elements.length : 0
  };
}

/**
 * Build the system and user prompts for a planning call from a goal and an observed page.
 * The prompt names the same primitive allowlist the device enforces, and refuses anything outside it.
 * @param {string} goal The goal text.
 * @param {{ page?: object, methods?: string[], maxCommands?: number }} [options] The observed page, allowlist override and command cap.
 * @returns {{ ok: true, system: string, user: string } | { ok: false, code: string, message: string }} The prompts, or the refusal.
 */

export function buildPlanRequest(
  goal,
  {
    page,
    methods = ALLOWED_METHODS,
    maxCommands = 12
  } = {}
) {
  const text = String(goal ?? '').trim();
  if (!text) return refuseRequest('GOAL_EMPTY', 'A plan needs a goal.');
  if (text.length > GOAL_MAX_CHARS) {
    return refuseRequest('GOAL_TOO_LONG', `The goal is ${text.length} characters; the bound is ${GOAL_MAX_CHARS}.`);
  }
  const observed = summarizePage(page);
  const system = [
    'You plan browser work for a paired browser extension. You do not execute anything yourself.',
    'Reply with one JSON object and nothing else: no prose, no markdown fence.',
    'Shape: {"root": <node>} where a node is one of SEQUENCE, COMMAND, LOOP, UNTIL, WAIT_EVENT, RETRY, ASSERT or RETURN. A SEQUENCE node carries its steps in "children" (never "steps"): {"type":"SEQUENCE","children":[<node>, ...]}.',
    `A COMMAND node is {"type":"COMMAND","method":"<primitive>","arguments":{...},"resultBinding":"<name>"}.`,
    `Use only these primitives: ${methods.join(', ')}.`,
    'Never set tenantId, goalId, target or budgets anywhere: the caller owns who runs, where, and under which budgets.',
    `Run at most ${maxCommands} COMMAND nodes in total.`,
    'Prefer one WAIT_EVENT or one verified read over a retry loop. Prefer a single find then click over a blind coordinate.',
    'The page observation below is the only ground truth you have. Do not invent refs, urls or labels that are not in it.',
    `If the goal cannot be done with these primitives on this page, reply {"root": null, "reason": "<one sentence>"} and refuse.`
  ].join('\n');
  const user = [
    `GOAL: ${text}`,
    `OBSERVED PAGE: ${JSON.stringify(observed)}`
  ].join('\n\n');
  return {
    ok: true,
    system,
    user
  };
}

const OWNED_FIELDS = new Set([
  'tenantId',
  'goalId',
  'target',
  'budgets',
  'root'
]);

const DEFAULT_DEPTH = 12;

function refuse(
  code,
  message
) {
  return {
    ok: false,
    code,
    message
  };
}

function measure(
  node,
  maxDepth,
  depth = 1,
  counter = {
    commands: 0,
    tooDeep: false
  }
) {
  if (node === null || typeof node !== 'object') return counter;
  if (depth > maxDepth) {
    counter.tooDeep = true;
    return counter;
  }
  if (node.type === 'COMMAND') counter.commands += 1;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'arguments' || key === 'valueSpec' || key === 'value') continue;
    if (Array.isArray(value)) {
      for (const item of value) measure(item, maxDepth, depth + 1, counter);
    } else if (value && typeof value === 'object') {
      measure(value, maxDepth, depth + 1, counter);
    }
  }
  return counter;
}

/**
 * Compile raw model text into a sealed program the device may run, refusing anything that sets a caller-owned field, nests too deep, exceeds the command budget, or names a non-allowlisted primitive.
 * A refusal is never repaired, because a repaired refusal teaches the caller that model output is trusted.
 * @param {string} rawText The model's reply text.
 * @param {{ target?: object, budgets?: object, programId?: string, goalRevision?: number }} [options] The caller-owned target and budgets.
 * @returns {object} The sealed program, or `{ ok: false, code, message }`.
 */

export function compileGoalPlan(
  rawText,
  {
    target,
    budgets,
    programId = 'goal-plan',
    goalRevision = 1
  } = {}
) {
  if (!target || typeof target !== 'object') {
    return refuse('PLAN_NO_TARGET', 'The caller must supply a device and tab target.');
  }
  let parsed;
  try {
    parsed = JSON.parse(String(rawText ?? ''));
  } catch (error) {
    return refuse('PLAN_NOT_JSON', `The plan is not JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return refuse('PLAN_NOT_JSON', 'The plan must be a JSON object.');
  }
  if (!parsed.root || typeof parsed.root !== 'object') {
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? ` Model: ${parsed.reason.trim().slice(0, 300)}` : '';
    return refuse('PLAN_MISSING_ROOT', `The plan has no root node.${reason}`);
  }

  const owned = Object.keys(parsed).find((key) => OWNED_FIELDS.has(key) && key !== 'root');
  if (owned) {
    return refuse('PLAN_SETS_OWNED_FIELD', `The model may not set ${owned}; the caller owns it.`);
  }

  const nested = findOwnedField(parsed.root);
  if (nested) {
    return refuse('PLAN_SETS_OWNED_FIELD', `A nested node may not carry ${nested}.`);
  }

  const maxDepth = Number(budgets?.astDepth) > 0 ? Number(budgets.astDepth) : DEFAULT_DEPTH;
  const counted = measure(parsed.root, maxDepth);
  if (counted.tooDeep) {
    return refuse('PLAN_TOO_DEEP', `The plan nests deeper than the ${maxDepth} node budget.`);
  }

  const maxCommands = Number(budgets?.browserCommandLeavesPerRun) > 0
    ? Number(budgets.browserCommandLeavesPerRun)
    : 1;
  if (counted.commands > maxCommands) {
    return refuse('PLAN_TOO_MANY_COMMANDS', `The plan runs ${counted.commands} browser commands; the budget is ${maxCommands}.`);
  }

  const method = findCommandMethod(parsed.root);
  if (method && !ALLOWED_METHODS.includes(method)) {
    return refuse('PLAN_METHOD_NOT_ALLOWED', `${method} is not one of the ${ALLOWED_METHODS.length} allowlisted primitives.`);
  }

  return {
    ok: true,
    program: {
      schemaVersion: 'OA_REACTIVE_VM_V1',
      programId,
      tenantId: 'caller',
      goalId: 'caller',
      goalRevision,
      target,
      budgets,
      root: parsed.root
    }
  };
}

function findOwnedField(
  node,
  depth = 0
) {
  if (node === null || typeof node !== 'object' || depth > 64) return null;
  for (const key of Object.keys(node)) {
    if (OWNED_FIELDS.has(key)) return key;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'arguments' || key === 'valueSpec' || key === 'value') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = findOwnedField(item, depth + 1);
        if (hit) return hit;
      }
    } else if (value && typeof value === 'object') {
      const hit = findOwnedField(value, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function findCommandMethod(root) {
  let found = null;
  const visit = (
    node,
    depth = 1
  ) => {
    if (found || node === null || typeof node !== 'object' || depth > 64) return;
    if (node.type === 'COMMAND' && typeof node.method === 'string') {
      found = node.method;
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'arguments' || key === 'valueSpec' || key === 'value') continue;
      if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
      else if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };
  visit(root);
  return found;
}
