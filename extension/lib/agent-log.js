// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: agent-log — MV3 runtime library, shared with the Node suite..
// @context: MV3 runtime library, shared with the Node suite.
// @state: MV3 runtime library, shared with the Node suite..
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

// Ring buffer of the last 200 log entries, published on globalThis as
// OperaAgentLog for the popup's log view.
//
// WHY a classic script and not a module: the manifest loads this file into both the
// module service worker and a classic content script, and a classic script cannot
// import. Hence the IIFE and the globalThis publish, and hence the guard below.

(() => {
  'use strict';
  if (globalThis.OperaAgentLog) return;
  const MAX_ENTRIES = 200;
  const LEVELS = { debug: 10, warn: 30, error: 50 };
  const VALID = new Set(['debug', 'warn', 'error']);
  let threshold = LEVELS.warn;
  let buffer = [];
  function shape(code, message) {
    return {
      code: String(code || 'LOG').slice(0, 100),
      message: String(message ?? '').slice(0, 1000)
    };
  }
  function emit(level, code, message, fields) {
    const s = shape(code, message);
    const entry = {
      t: new Date().toISOString(),
      level,
      code: s.code,
      message: s.message,
      commandId: fields && typeof fields.commandId === 'string' ? fields.commandId : null
    };
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(buffer.length - MAX_ENTRIES);
    if (LEVELS[level] >= threshold) {
      const text = `[opera-agent:${level}] ${entry.code} ${entry.message}`;
      if (level === 'error') console.error(text);
      else if (level === 'warn') console.warn(text);
      else console.debug(text);
    }
    return entry;
  }
  globalThis.OperaAgentLog = {
    configure(options) {
      const level = options && options.level;
      if (!VALID.has(level)) throw new Error('Invalid log level.');
      threshold = LEVELS[level];
    },
    log: emit,
    debug: (code, message, fields) => emit('debug', code, message, fields),
    warn: (code, message, fields) => emit('warn', code, message, fields),
    error: (code, message, fields) => emit('error', code, message, fields),
    entries() { return buffer.slice(); },
    clear() { buffer = []; }
  };
})();
