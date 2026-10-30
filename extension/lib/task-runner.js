// @last-edited: 2026-10-30 UTC+7.
// @title: task-runner — the device-side run_task command: validate, one model call, parse, gate, and return the compiled artifact.
// @state: owns the task.run command on the device; the server executes the returned artifact through the existing VM/adhoc lanes, so the browser work still runs on this device via enqueued commands.
// @dependencies: task-compile, model-client, log.

// WHY THE DEVICE ONLY COMPILES AND THE SERVER EXECUTES.
// The model key never leaves the device (docs/security.md), so the one model call per task happens here.
// Execution is orchestrated by the existing run_program / run_adhoc lanes, which enqueue browser commands back to this device — so splitting compile (device) from execute (server) invents no new channel and reuses the sealed-program and adhoc gates that are already tested.

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
 * Run one task.run command on the device: validate, observe the page, make the single device-local model call, parse and gate the reply, and return the compiled artifact.
 * @param {{ task?: unknown, tabId?: unknown, confirm?: unknown, requestId?: unknown, lessons?: unknown }} params The command params from the server.
 * @param {{ storage?: object, fetchImpl?: typeof fetch, observePage?: (input: { tabId: number|null }) => Promise<object> }} context The dispatch context; observePage is the production page reader and injectable for tests.
 * @returns {Promise<{ ok: true, mode: 'read'|'write', program?: object, graph?: object, verify: { kind: string, value: string }|null, page?: object }>} The compiled artifact for the server to execute.
 */

export async function runTaskCommand(
  params,
  context = {}
) {
  const task = typeof params?.task === 'string' ? params.task : '';
  if (!task || task.length > 1200) throw failure('INVALID_TASK', 'task must be a string of 1..1200 characters.');
  const confirm = params?.confirm === true;
  const lessons = Array.isArray(params?.lessons) ? params.lessons : [];

  const page = context.observePage
    ? await context.observePage({ tabId: params?.tabId ?? null })
    : {};
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

  log.debug('TASK_COMPILED', `mode=${gated.mode} verify=${JSON.stringify(gated.verify ?? null)}`);

  // WHY THE PAGE OBSERVATION DOES NOT TRAVEL BACK.
  // The prompt is capped at 1200 chars of page text plus 40 elements before it reaches the model, but the command result is persisted server-side, so the raw observation must not ride back with the artifact; the server only needs the compiled artifact and the verify clause.

  return {
    ok: true,
    mode: gated.mode,
    ...(gated.mode === 'read' ? { program: gated.program } : { graph: gated.graph }),
    verify: gated.verify ?? null
  };
}
