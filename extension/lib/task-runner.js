// @last-edited: 2026-10-30 UTC+7.
// @title: task-runner — the device-side run_task command: validate, one model call, gate, execute, verify.
// @state: owns the task.run command on the device; every failure carries a stable code the tool can switch on.
// @dependencies: task-compile, model-client, log.

// WHY THE ORCHESTRATION LIVES ON THE DEVICE.
// The model key never leaves the device (docs/security.md), so the one model call per task happens here, not on the server; the server only relays the task text and the answer.

import { log } from './log.js';
import { callModelText } from './model-client.js';
import {
  buildTaskPrompt,
  gateTaskReply,
  parseTaskReply
} from './task-compile.js';

const TASK_BUDGETS = {
  astDepth: 8,
  browserCommandLeavesPerRun: 12
};

function failure(
  code,
  message
) {
  return Object.assign(new Error(message), { code });
}

/**
 * Run one task.run command on the device.
 * @param {{ task?: unknown, tabId?: unknown, confirm?: unknown, requestId?: unknown, lessons?: unknown }} params The command params from the server.
 * @param {{ storage?: object, fetchImpl?: typeof fetch, taskDeps?: { observePage?: Function, executeProgram?: Function, verifyTask?: Function, runAdhoc?: Function } }} context The dispatch context; taskDeps carries the production seams (page observation, program executor, verifier, adhoc lane) and is injectable for tests.
 * @returns {Promise<{ ok: true, mode: 'read'|'write', trace: Array<object>, verify: { ok: boolean, evidence: unknown }, lesson?: string }>} The task envelope.
 */

export async function runTaskCommand(
  params,
  context = {}
) {
  const task = typeof params?.task === 'string' ? params.task : '';
  if (!task || task.length > 1200) throw failure('INVALID_TASK', 'task must be a string of 1..1200 characters.');
  const confirm = params?.confirm === true;
  const lessons = Array.isArray(params?.lessons) ? params.lessons : [];
  const deps = context.taskDeps ?? {};

  const page = deps.observePage ? await deps.observePage({ tabId: params?.tabId ?? null }) : {};
  const prompt = buildTaskPrompt({
    task,
    lessons,
    page
  });
  if (!prompt.ok) throw failure(prompt.code, prompt.message);

  const answer = await callModelText({
    storage: context.storage,
    fetchImpl: context.fetchImpl ?? fetch
  }, {
    system: prompt.system,
    user: prompt.user
  });
  if (!answer.ok) throw failure(answer.code, answer.message);

  const parsed = parseTaskReply(answer.text);
  if (!parsed.ok) throw failure(parsed.code, parsed.message);

  const gated = gateTaskReply(parsed, {
    confirm,
    target: {
      device: 'opera',
      tabId: params?.tabId ?? null
    },
    budgets: TASK_BUDGETS
  });
  if (!gated.ok) throw failure(gated.code, gated.message);

  let trace;
  if (gated.mode === 'read') {
    if (!deps.executeProgram) throw failure('TASK_NO_EXECUTOR', 'No program executor is wired on this device.');
    const run = await deps.executeProgram(gated.program, { tabId: params?.tabId ?? null });
    trace = run?.trace ?? [];
  } else {
    if (!deps.runAdhoc) throw failure('TASK_NO_ADHOC', 'No adhoc lane is wired on this device.');
    const run = await deps.runAdhoc(gated.graph, {
      tabId: params?.tabId ?? null,
      requestId: params?.requestId ?? null
    });
    trace = run?.trace ?? [];
  }

  const verify = deps.verifyTask
    ? await deps.verifyTask(gated.verify, { tabId: params?.tabId ?? null })
    : {
      ok: true,
      evidence: null
    };

  log.debug('TASK_RUN', {
    mode: gated.mode,
    nodes: trace.length,
    verifyOk: verify?.ok === true
  });

  return {
    ok: true,
    mode: gated.mode,
    trace,
    verify
  };
}
