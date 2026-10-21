// @last-edited: 2026-10-21 UTC+7.
// @title: edge-log — the structured log line every edge function writes.
// @state: the fields it carries, the message cap, and the level each call writes at.
// @dependencies: none.

const MAX_LOG_MESSAGE = 1000;
export function createEdgeLog(context) {
  const commandId = context && typeof context.commandId === 'string' ? context.commandId : null;
  const requestId = context && typeof context.requestId === 'string' ? context.requestId : null;
  function emit(level, code, message) {
    const record = {
      t: new Date().toISOString(),
      level,
      code: String(code || 'LOG').slice(0, 100),
      message: String(message ?? '').slice(0, MAX_LOG_MESSAGE),
      commandId,
      requestId
    };
    if (level === 'error') console.error(JSON.stringify(record));
    else if (level === 'warn') console.warn(JSON.stringify(record));
    else console.debug(JSON.stringify(record));
    return record;
  }
  return {
    debug: (code, message) => emit('debug', code, message),
    warn: (code, message) => emit('warn', code, message),
    error: (code, message) => emit('error', code, message)
  };
}
