// @last-edited: 2026-10-30 UTC+7.
// @title: task-compile — pure parse and gate for the run_task model reply, shared by the device and the tests.
// @state: parses the model's { mode, program|graph, verify } reply, builds the capped prompt, and gates the read lane through compileGoalPlan; the write lane needs confirm and is compiled server-side.
// @dependencies: goal-plan.

// WHY THE REPLY SHAPE IS { mode, program|graph, verify } AND NOT A BARE PROGRAM.
// One model call must answer three questions — read or write, what to run, and how to tell it worked — and a bare program answers only one of them, so the verify clause would be invented by the caller after the fact instead of by the model that saw the page.

import {
  buildPlanRequest,
  compileGoalPlan
} from './goal-plan.js';

const MODES = new Set([
  'read',
  'write'
]);

const VERIFY_KINDS = new Set([
  'text',
  'selector',
  'ref'
]);

// WHY THE LESSONS BLOCK IS CAPPED.
// Skill memory is shared across accounts, so recalled lesson text is third-party prompt surface; a cap keeps five lessons from pushing the prompt far past the goal's own cap.

const LESSONS_BLOCK_MAX_CHARS = 2000;

/**
 * Parse the model's run_task reply text into a validated reply object.
 * @param {string} text The raw model reply.
 * @returns {{ ok: true, mode: 'read'|'write', program?: object, graph?: object, verify: { kind: string, value: string }|null } | { ok: false, code: string, message: string }} The parsed reply, or the refusal.
 */

export function parseTaskReply(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch (error) {
    return {
      ok: false,
      code: 'TASK_NOT_JSON',
      message: `The task reply is not JSON: ${error.message}`
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !MODES.has(parsed.mode)) {
    return {
      ok: false,
      code: 'TASK_BAD_MODE',
      message: 'The task reply must have mode "read" or "write".'
    };
  }
  if (parsed.mode === 'read' && (!parsed.program || typeof parsed.program !== 'object')) {
    return {
      ok: false,
      code: 'TASK_NO_PROGRAM',
      message: 'A read reply must carry a program object.'
    };
  }
  if (parsed.mode === 'write' && (!parsed.graph || typeof parsed.graph !== 'object')) {
    return {
      ok: false,
      code: 'TASK_NO_GRAPH',
      message: 'A write reply must carry a graph object.'
    };
  }
  let verify = null;
  if (parsed.verify !== undefined && parsed.verify !== null) {
    if (!parsed.verify || typeof parsed.verify !== 'object' || !VERIFY_KINDS.has(parsed.verify.kind) || typeof parsed.verify.value !== 'string' || !parsed.verify.value) {
      return {
        ok: false,
        code: 'TASK_BAD_VERIFY',
        message: 'verify must be { kind: "text"|"selector"|"ref", value: string } or null.'
      };
    }
    verify = {
      kind: parsed.verify.kind,
      value: parsed.verify.value
    };
  }
  const reply = {
    ok: true,
    mode: parsed.mode,
    verify
  };
  if (parsed.mode === 'read') reply.program = parsed.program;
  else reply.graph = parsed.graph;
  return reply;
}

/**
 * Build the capped prompt for the one device-local model call of a task.
 * Lessons recalled from the shared skill memory ride along inside the user message.
 * @param {{ task: string, lessons?: Array<{ task?: string, lesson?: string, pitfalls?: string }>, page?: object, methods?: string[], maxCommands?: number }} input The task, the recalled lessons, and the capped page observation.
 * @returns {{ ok: true, system: string, user: string } | { ok: false, code: string, message: string }} The prompts, or the refusal from buildPlanRequest.
 */

export function buildTaskPrompt({
  task,
  lessons = [],
  page,
  methods,
  maxCommands
}) {
  const request = buildPlanRequest(task, {
    page,
    ...(methods ? { methods } : {}),
    ...(maxCommands ? { maxCommands } : {})
  });
  if (!request.ok) return request;
  const lessonLines = lessons
    .filter((lesson) => lesson && (lesson.lesson || lesson.pitfalls))
    .map((lesson) => `- task: ${String(lesson.task ?? '')}\n  lesson: ${String(lesson.lesson ?? '')}${lesson.pitfalls ? `\n  pitfalls: ${
      String(lesson.pitfalls)
    }` : ''}`);
  const lessonsBlock = lessonLines.length
    ? `<lessons>\n${lessonLines.join('\n')}\n</lessons>`.slice(0, LESSONS_BLOCK_MAX_CHARS)
    : '';
  const user = lessonsBlock
    ? `${request.user}\n\n${lessonsBlock}`
    : request.user;
  return {
    ok: true,
    system: request.system,
    user
  };
}

/**
 * Gate a parsed task reply before anything executes.
 * The read lane is sealed by compileGoalPlan; the write lane requires confirm and is compiled server-side by the existing adhoc compiler, so only the graph travels on.
 * @param {{ ok: true, mode: 'read'|'write', program?: object, graph?: object, verify: unknown }} reply A reply from parseTaskReply.
 * @param {{ confirm?: boolean, target?: object, budgets?: object }} options confirm gates writes; target and budgets feed the read-lane gate.
 * @returns {{ ok: true, mode: string, program?: object, graph?: object, verify: unknown } | { ok: false, code: string, message: string }} The gated reply, with the sealed program on the read lane.
 */

export function gateTaskReply(
  reply,
  {
    confirm = false,
    target = {},
    budgets = {}
  } = {}
) {
  if (!reply || reply.ok !== true) {
    return {
      ok: false,
      code: 'TASK_BAD_REPLY',
      message: 'The task reply did not parse.'
    };
  }
  if (reply.mode === 'write') {
    if (confirm !== true) {
      return {
        ok: false,
        code: 'TASK_NOT_CONFIRMED',
        message: 'A write task needs confirm: true at the tool; nothing was registered.'
      };
    }
    return {
      ok: true,
      mode: 'write',
      graph: reply.graph,
      verify: reply.verify
    };
  }
  const sealed = compileGoalPlan(JSON.stringify(reply.program), {
    target,
    budgets
  });
  if (!sealed.ok) return sealed;
  return {
    ok: true,
    mode: 'read',
    program: sealed.program ?? sealed,
    verify: reply.verify
  };
}
