// @last-edited: 2026-10-05 00:25 UTC+7.
// @title: goal-plan — compiles model text into a program the device may run.
// @state: The caller owns identity, target and budgets; the model owns the shape, and the prompt names the same allowlist.
// @dependencies: extension/lib/protocol.

// WHY this exists: a plan is handed over once and executed locally, so the model
// is not in the step loop. That removes the per-step round trip, and it also
// means model text becomes an action machine directly. This module is the narrow
// door between the two, and it is deliberately pure: no network, no DOM, no
// chrome, so it can be tested exhaustively and run anywhere.
//
// The rule it enforces is one sentence: the caller owns who runs, where, and
// under which budgets. The model only supplies the shape of the task. Anything
// else in the reply is refused rather than repaired, because a repaired refusal
// teaches the caller that model output is trusted.

import { ALLOWED_METHODS } from './protocol.js';

// WHY the prompt is built here and not in the edge function: the gate and the
// prompt have to agree on the same allowlist and the same caller-owned fields. If
// the prompt lived next to the fetch, the list would be typed twice and would
// drift, and the model would be told about a method the gate refuses.
//
// It is bounded on purpose. The model plans against observed page facts, not the
// whole page, and the observation is capped: a prompt that carries 500 elements
// costs tokens, slows the first token, and gets worse at exactly the pages where
// the model most needs to be told no.

const GOAL_MAX_CHARS = 1200;
const PAGE_ELEMENT_LIMIT = 40;

function refuseRequest(code, message) {
  return { ok: false, code, message };
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

export function buildPlanRequest(goal, { page, methods = ALLOWED_METHODS, maxCommands = 12 } = {}) {
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
  return { ok: true, system, user };
}

// Fields the caller fills in and the model may not set, at the top level or on
// any nested node. A nested root is the smuggle case: a node that carries its own
// identity would execute as itself.

const OWNED_FIELDS = new Set(['tenantId', 'goalId', 'target', 'budgets', 'root']);

const DEFAULT_DEPTH = 12;

function refuse(code, message) {
  return { ok: false, code, message };
}

// Counts COMMAND nodes and reports whether the tree went deeper than allowed,
// in one pass. Counting by node type rather than by key name means a new node
// type in the VM cannot slip past this by living under a child key nobody listed.

function measure(node, maxDepth, depth = 1, counter = { commands: 0, tooDeep: false }) {
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

export function compileGoalPlan(rawText, { target, budgets, programId = 'goal-plan', goalRevision = 1 } = {}) {
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
    // WHY the model's own reason is kept: a refusal that says nothing leaves the
    // caller guessing whether the model failed, the page lacked a control, or the
    // goal is out of scope. One sentence from the model is the diagnosis.
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? ` Model: ${parsed.reason.trim().slice(0, 300)}` : '';
    return refuse('PLAN_MISSING_ROOT', `The plan has no root node.${reason}`);
  }

  // WHY refuse instead of strip: a model that sets tenantId is either confused
  // or aiming at another tenant. Silently overwriting it would hide both.
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

// WHY not a recursive scan here: the walk in measure() already visits every node,
// and a second visitor would have to be kept in step with it. This is a shallow
// check on the node it passes, and it stops at the first offender on purpose.
//
// Every owned field counts here, `root` included. A nested root is the smuggle:
// a node that carries its own program would execute as itself. Only the top level
// may hold one, and that case is settled before this function is called.

function findOwnedField(node, depth = 0) {
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
  const visit = (node, depth = 1) => {
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