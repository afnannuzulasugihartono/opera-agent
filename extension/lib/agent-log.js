// @last-edited: 2026-11-08 UTC+7.
// @title: agent-log — the no-export logger that classic scripts and the worker share.
// @state: level-aware console sink published on globalThis, with a bounded fault list beside its ring; deliberately has no export so manifest content_scripts can load it as a classic script.
// @dependencies: none.

// Ring buffer of the last 200 log entries, published on globalThis as OperaAgentLog for the popup's log view.

// WHY a classic script and not a module: the manifest loads this file into both the module service worker and a classic content script, and a classic script cannot import.
// Hence the IIFE and the globalThis publish, and hence the guard below.

// WHY the browser is named here and not imported: this file cannot import, so the page's copy of the detection lives inline.
// The worker's copy lives in lib/browser-id.js, and tests/extension/browser-identity.test.mjs runs both over the same browsers and fails when they answer differently.
// The order is the one that does not lie: what the browser publishes about itself, then the brand list, then the string.

(() => {
  'use strict';

  if (!globalThis.OperaAgentBrowserId) {
    const ua = String(navigator?.userAgent || '');
    let brands = [];
    try {
      brands = (navigator?.userAgentData?.brands ?? []).map((brand) => String(brand?.brand ?? ''));
    } catch {
      brands = [];
    }
    let brave = false;
    try {
      brave = navigator?.brave?.isBrave?.() === true;
    } catch {
      brave = false;
    }
    const branded = brands.find((brand) => /brave|edge|opera|vivaldi|chromium|chrome/i.test(brand)) || '';
    let browserName = 'Unknown';
    if (brave) browserName = 'Brave';
    else if (/brave/i.test(branded)) browserName = 'Brave';
    else if (/edge/i.test(branded)) browserName = 'Edge';
    else if (/opera/i.test(branded)) browserName = 'Opera';
    else if (/vivaldi/i.test(branded)) browserName = 'Vivaldi';
    else if (/chromium/i.test(branded)) browserName = 'Chromium';
    else if (/Brave/i.test(ua)) browserName = 'Brave';
    else if (/Edg\//i.test(ua)) browserName = 'Edge';
    else if (/OPR\//i.test(ua)) browserName = 'Opera';
    else if (/Vivaldi/i.test(ua)) browserName = 'Vivaldi';
    else if (/Firefox/i.test(ua)) browserName = 'Firefox';
    else if (/Chrome/i.test(ua)) browserName = 'Chrome';
    globalThis.OperaAgentBrowserId = { browserName };
  }

  if (globalThis.OperaAgentLog) return;
  const MAX_ENTRIES = 200;
  const MAX_FAULTS = 20;
  const LEVELS = { debug: 10, warn: 30, error: 50 };
  const VALID = new Set(['debug', 'warn', 'error']);
  let threshold = LEVELS.warn;
  let buffer = [];
  let faults = [];
  let faultTotal = 0;

  // A fault keeps one row per distinct code and message, so a repeating error counts instead of filling the list.

  function recordFault(entry) {
    faultTotal += 1;
    const key = entry.code + '|' + entry.message;
    const found = faults.find((row) => row.code + '|' + row.message === key);
    if (found) {
      found.count += 1;
      found.lastAt = entry.t;
      return;
    }
    faults.unshift({ code: entry.code, message: entry.message, count: 1, firstAt: entry.t, lastAt: entry.t });
    if (faults.length > MAX_FAULTS) faults = faults.slice(0, MAX_FAULTS);
  }

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
    if (level === 'error') recordFault(entry);
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
    clear() { buffer = []; },
    errors() { return faults.map((row) => ({ ...row })); },
    clearErrors() { faults = []; },
    errorCount() { return faultTotal; }
  };
})();
