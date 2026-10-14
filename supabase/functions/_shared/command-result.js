// @last-edited: 2026-10-14 UTC+7.
// @title: command-result — one verdict over a workflow command outcome, transport and device.
// @state: commandFailure null-or-failure; runner fails fast on it, continueOnError opts out.
// @dependencies: none.

// WHY one helper for two levels. The runner used to judge a command by its
// transport envelope alone, so a burst that failed in-page — recorded
// transport-ok with { ok: false } inside — walked every workflow past the
// miss. A read or find carries no ok field at all, so only an explicit false
// fails; anything else passes through untouched.

function parts(error) {
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const code = typeof error.code === 'string' && error.code ? error.code : 'COMMAND_FAILED';
    const message = typeof error.message === 'string' && error.message ? error.message : String(code);
    return { code, message, details: error };
  }
  return { code: 'COMMAND_FAILED', message: 'Workflow command failed.', details: null };
}

export function commandFailure(result) {
  if (!result || result.ok !== true) {
    return parts(result?.error);
  }
  if (result.result && result.result.ok === false) {
    return parts(result.result.error);
  }
  return null;
}
