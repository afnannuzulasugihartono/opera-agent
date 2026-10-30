// @last-edited: 2026-10-30 UTC+7.
// @title: task-validate — pure input validation for the run_task tool, shared by the edge function and the tests.
// @state: one validator over the run_task input: task, tabId, confirm, requestId, timeoutMs; refusal codes are stable so the tool can switch on them.
// @dependencies: none.

// WHY THE VALIDATION LIVES IN A PURE MODULE.
// The edge function cannot be unit-tested from Node without a Deno runtime, so the rule that decides whether a task may be enqueued lives here, where a test can drive it directly, and the edge function only wires it to the transport.

export const TASK_MAX_CHARS = 1200;
export const TASK_TIMEOUT_MIN_MS = 1000;

// WHY 30000 AND NOT 120000.
// The task.run compile hop is awaited through runCommand, which clamps every command to 30 s, so advertising 120 s promised a timeout the transport never delivers; the execution lanes (VM host, adhoc runner) carry their own budgets after the compile hop returns.

export const TASK_TIMEOUT_MAX_MS = 30000;
export const TASK_TIMEOUT_DEFAULT_MS = 60000;

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Validate the run_task tool input before anything is enqueued.
 * @param {{ task?: unknown, tabId?: unknown, confirm?: unknown, requestId?: unknown, timeoutMs?: unknown }} input The raw tool input.
 * @returns {{ ok: true, value: { task: string, tabId: number|null, confirm: boolean, requestId: string, timeoutMs: number } } | { ok: false, code: string, message: string }} The verdict; on ok, the normalized value with defaults applied.
 */

export function validateTaskInput(input) {
  const task = typeof input?.task === 'string' ? input.task : '';
  if (!task || task.length > TASK_MAX_CHARS) {
    return {
      ok: false,
      code: 'INVALID_TASK',
      message: `task must be a string of 1..${TASK_MAX_CHARS} characters.`
    };
  }
  const requestId = typeof input?.requestId === 'string' ? input.requestId : '';
  if (!REQUEST_ID_RE.test(requestId)) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message: 'requestId must match /^[A-Za-z0-9_-]{1,100}$/. A malformed key is rejected so replay protection is never silent.'
    };
  }
  let tabId = null;
  if (input?.tabId !== undefined && input?.tabId !== null) {
    if (typeof input.tabId !== 'number' || !Number.isInteger(input.tabId) || input.tabId < 0) {
      return {
        ok: false,
        code: 'INVALID_TAB',
        message: 'tabId must be a non-negative integer when present.'
      };
    }
    tabId = input.tabId;
  }
  let confirm = false;
  if (input?.confirm !== undefined) {
    if (typeof input.confirm !== 'boolean') {
      return {
        ok: false,
        code: 'INVALID_CONFIRM',
        message: 'confirm must be a boolean when present.'
      };
    }
    confirm = input.confirm;
  }
  const rawTimeout = Number(input?.timeoutMs);
  const timeoutMs = !Number.isFinite(rawTimeout) || rawTimeout <= 0
    ? TASK_TIMEOUT_DEFAULT_MS
    : Math.max(TASK_TIMEOUT_MIN_MS, Math.min(TASK_TIMEOUT_MAX_MS, Math.floor(rawTimeout)));
  return {
    ok: true,
    value: {
      task,
      tabId,
      confirm,
      requestId,
      timeoutMs
    }
  };
}
