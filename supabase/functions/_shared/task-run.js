// @last-edited: 2026-10-30 UTC+7.
// @title: task-run — pure helpers for executing a compiled run_task artifact: the verify command and the saved lesson.
// @state: maps the model's verify clause to one allowlisted read command; lessonFromRun summarizes a run into capped skill fields, never page content or credentials.
// @dependencies: none.

// WHY VERIFY IS ONE ALLOWLISTED READ COMMAND.
// The model's verify clause names what "done" looks like; mapping it to page.find / page.query / a bounded page.read keeps verification inside the 31 primitives, so a task can never smuggle in an eval-shaped check.

export const VERIFY_MAX_ELEMENTS = 200;

const LESSON_TASK_MAX = 500;
const LESSON_TEXT_MAX = 4000;
const PITFALLS_MAX = 2000;

/**
 * Map the model's verify clause to the one read command that checks it.
 * @param {{ kind: string, value: string }|null} verify The verify clause from the compiled task.
 * @param {number|null} tabId The target tab, or null for the driven tab.
 * @returns {{ method: string, params: Record<string, unknown> }|null} The command to enqueue, or null when nothing is claimed.
 */

export function verifyCommandFor(
  verify,
  tabId
) {
  if (!verify || typeof verify !== 'object') return null;
  if (verify.kind === 'text') {
    return {
      method: 'page.find',
      params: {
        tabId,
        text: String(verify.value ?? ''),
        limit: 1
      }
    };
  }
  if (verify.kind === 'selector') {
    return {
      method: 'page.query',
      params: {
        tabId,
        selector: String(verify.value ?? ''),
        limit: 1
      }
    };
  }
  if (verify.kind === 'ref') {
    return {
      method: 'page.read',
      params: {
        tabId,
        includeElements: true,
        maxElements: VERIFY_MAX_ELEMENTS
      }
    };
  }
  return null;
}

/**
 * Summarize a finished run into the capped skill fields saved to the shared memory.
 * Only the task text, node counts, and failure reasons travel — never page content, refs, tokens, or the model key.
 * @param {{ task: string, trace?: Array<{ node?: unknown, ok?: boolean, why?: unknown }>, verify?: { ok?: boolean } }} run The finished run.
 * @returns {{ task: string, lesson: string, pitfalls: string }} The capped lesson fields.
 */

export function lessonFromRun({
  task,
  trace = [],
  verify
}) {
  const nodes = Array.isArray(trace) ? trace : [];
  const okCount = nodes.filter((node) => node?.ok === true).length;
  const failed = nodes.filter((node) => node?.ok === false);
  const lesson = `Task "${String(task ?? '').slice(0, 120)}" ran ${okCount} of ${nodes.length} nodes ok${verify?.ok === true ? ', verified' : ''}.`;
  const pitfalls = [
    ...failed.map((node) => `node ${String(node?.node ?? '?')} failed: ${String(node?.why ?? 'unknown')}`),
    ...(verify?.ok === false ? ['verify failed'] : [])
  ].join('; ');
  return {
    task: String(task ?? '').slice(0, LESSON_TASK_MAX),
    lesson: lesson.slice(0, LESSON_TEXT_MAX),
    pitfalls: pitfalls.slice(0, PITFALLS_MAX)
  };
}
