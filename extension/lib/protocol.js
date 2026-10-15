// @last-edited: 2026-10-13 UTC+7.
// @title: protocol — the wire contract: primitive allowlist, parameter schemas, burst vocabulary.
// @state: exports the method spec table, the allowlist derived from it, and the burst and command validators; npm run check reads this file for the primitive count.
// @dependencies: keyboard.

// The wire contract: the allowlist of browser primitives, their parameter schemas,
// and the burst step vocabulary. This file is what `npm run check` reads to report the
// primitive count, and it is frozen by tests/fixtures and the boundary locks.
//
// WHY one file: the service worker, the MCP server, and the Node tests must agree on
// exactly which primitives exist. A second copy of the list would eventually disagree.

export const PRODUCT_VERSION = '1.6.27';
export const PROTOCOL_VERSION = 1;

import { resolveKeyInput } from './keyboard.js';

export const BURST_MAX_STEPS = 8;
export const BURST_MAX_TIMEOUT_MS = 12000;
export const EXECUTION_MODES = Object.freeze(['background', 'foreground']);
export const BURST_ACTION_METHODS = Object.freeze({
  read: 'page.read',
  find: 'page.find',
  click: 'page.click',
  fill: 'page.fill',
  key: 'page.key',
  scroll: 'page.scroll',
  wait: 'page.wait_for',
  hover: 'page.hover',
  pointer: 'page.pointer',

  navigate: 'tabs.navigate'
});
export const BURST_STEP_KEYS = Object.freeze({
  read: ['action', 'offset', 'limit', 'includeElements', 'maxElements', 'tabId'],
  find: ['action', 'text', 'role', 'tag', 'exact', 'limit', 'tabId'],
  click: ['action', 'ref', 'refFromStep', 'refIndex', 'tabId'],
  fill: ['action', 'ref', 'value', 'refFromStep', 'refIndex', 'tabId'],
  key: ['action', 'key', 'modifiers', 'text', 'keyEvents', 'tabId'],
  scroll: ['action', 'x', 'y', 'absolute', 'smooth', 'tabId'],
  wait: ['action', 'ref', 'selector', 'text', 'visibleOnly', 'timeoutMs', 'intervalMs', 'tabId'],
  hover: ['action', 'ref', 'refFromStep', 'refIndex', 'text', 'timeoutMs', 'tabId'],
  pointer: ['action', 'pointerAction', 'x', 'y', 'endX', 'endY', 'deltaX', 'deltaY', 'tabId'],
  navigate: ['action', 'url', 'tabId']
});

export const METHOD_SPECS = Object.freeze({
  'browser.ping': { timeoutMs: 3000 },
  'browser.burst': { timeoutMs: BURST_MAX_TIMEOUT_MS },
  'tabs.list': { timeoutMs: 5000 },
  'tabs.get': { timeoutMs: 5000 },
  'tabs.find': { timeoutMs: 5000 },
  'tabs.open': { timeoutMs: 10000 },
  'tabs.activate': { timeoutMs: 5000 },
  'tabs.close': { timeoutMs: 5000 },
  'tabs.navigate': { timeoutMs: 15000 },
  'tabs.reload': { timeoutMs: 15000 },
  'page.read': { timeoutMs: 10000 },
  'page.query': { timeoutMs: 8000 },
  'page.find': { timeoutMs: 8000 },
  'page.collect_links': { timeoutMs: 10000 },
  'page.click': { timeoutMs: 8000 },
  'page.pointer': { timeoutMs: 8000 },
  'page.capture': { timeoutMs: 10000 },
  'page.fill': { timeoutMs: 8000 },
  'page.focus': { timeoutMs: 5000 },
  'page.scroll': { timeoutMs: 5000 },
  'page.key': { timeoutMs: 5000 },
  'page.stream': { timeoutMs: 30000 },
  'page.wait_for': { timeoutMs: 15000 },
  'media.state': { timeoutMs: 5000 },
  'media.play': { timeoutMs: 5000 },
  'media.pause': { timeoutMs: 5000 },
  'media.seek': { timeoutMs: 5000 },
  'media.stream_start': { timeoutMs: 15000 },
  'media.stream_stop': { timeoutMs: 15000 }
});

export const ALLOWED_METHODS = Object.freeze(Object.keys(METHOD_SPECS));

export function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validRef(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 300;
}

function validateBurstStep(step) {
  if (!isPlainObject(step)) return 'Each burst step must be an object.';
  const action = String(step.action || '');
  if (action === 'grid') return validateGridStep(step);
  if (action === 'file') return validateFileStep(step);
  if (!BURST_ACTION_METHODS[action]) return 'Burst action is not allowlisted.';
  const allowedKeys = new Set(BURST_STEP_KEYS[action]);
  const unexpectedKey = Object.keys(step).find((key) => !allowedKeys.has(key));
  if (unexpectedKey) return `Burst ${action} does not allow ${unexpectedKey}.`;

  if (step.tabId !== undefined && step.tabId !== null) {
    if (typeof step.tabId === 'boolean' || !Number.isInteger(step.tabId) || step.tabId < 0) return 'Invalid burst step tabId.';
  }

  if (action === 'click' && !validRef(step.ref) && step.refFromStep === undefined) return 'Burst click requires a valid ref or refFromStep.';
  if (action === 'fill' && !validRef(step.ref) && step.refFromStep === undefined) return 'Burst fill requires a valid ref or refFromStep and a value of at most 20000 characters.';

  if (action === 'fill' && (typeof step.value !== 'string' || step.value.length > 20000)) {
    return 'Burst fill requires a valid ref or refFromStep and a value of at most 20000 characters.';
  }
  if (action === 'key') {
    if (step.keyEvents !== undefined && typeof step.keyEvents !== 'boolean') {
      return 'Burst key keyEvents must be a boolean.';
    }

    try {
      resolveKeyInput({ key: step.key, modifiers: step.modifiers, text: step.text });
    } catch (error) {
      return `Burst key is not allowlisted: ${error.message}`;
    }
  }
  if (action === 'scroll' && !Number.isFinite(Number(step.y))) return 'Burst scroll requires a finite y value.';
  if (action === 'wait' && !validRef(step.ref) && !(typeof step.selector === 'string' && step.selector.length >= 1 && step.selector.length <= 500) && !(typeof step.text === 'string' && step.text.length >= 1 && step.text.length <= 300)) {
    return 'Burst wait requires a ref, selector, or text target.';
  }

  if (action === 'hover' && !validRef(step.ref) && step.refFromStep === undefined) {
    return 'Burst hover requires a valid ref or refFromStep.';
  }
  if (action === 'pointer') {
    const pointerAction = String(step.pointerAction || 'click');
    if (!['move', 'click', 'drag', 'wheel'].includes(pointerAction)) return 'Invalid burst pointer action.';
    for (const key of ['x', 'y']) if (!Number.isFinite(Number(step[key]))) return `Invalid burst pointer ${key}.`;
    if (pointerAction === 'drag') for (const key of ['endX', 'endY']) if (!Number.isFinite(Number(step[key]))) return `Invalid burst pointer ${key}.`;
    if (pointerAction === 'wheel' && !Number.isFinite(Number(step.deltaY))) return 'Invalid burst pointer deltaY.';
  }

  if (action === 'navigate' && (typeof step.url !== 'string' || !step.url)) return 'Burst navigate requires a URL.';
  return null;
}

const BURST_GRID_MAX = 20;
const BURST_FILE_DATA_MAX = 2000000;

function validateGridStep(step) {
  const unexpectedKey = Object.keys(step).find((key) => !['action', 'rows', 'cols', 'tabId'].includes(key));
  if (unexpectedKey) return `Burst grid does not allow ${unexpectedKey}.`;
  for (const key of ['rows', 'cols']) {
    const value = Number(step[key]);
    if (!Number.isInteger(value) || value < 1 || value > BURST_GRID_MAX) return `Invalid burst grid ${key}.`;
  }
  return null;
}

function validateFileStep(step) {
  const unexpectedKey = Object.keys(step).find((key) => !['action', 'filename', 'data', 'tabId'].includes(key));
  if (unexpectedKey) return `Burst file does not allow ${unexpectedKey}.`;
  if (typeof step.filename !== 'string' || !step.filename || step.filename.length > 300) return 'Burst file requires a filename.';
  if (typeof step.data !== 'string' || !step.data || step.data.length > BURST_FILE_DATA_MAX) return 'Burst file requires data within the byte cap.';
  return null;
}

export function expandGridSteps(steps) {
  const out = [];
  const startOf = [];
  for (const step of steps) {
    startOf.push(out.length);
    if (!step || step.action !== 'grid') {
      out.push(step);
      continue;
    }
    const at = step.tabId === undefined || step.tabId === null ? {} : { tabId: step.tabId };
    for (let c = 1; c < Number(step.cols); c += 1) out.push({ action: 'key', key: 'ArrowRight', ...at });
    for (let r = 1; r < Number(step.rows); r += 1) out.push({ action: 'key', key: 'ArrowDown', ...at });
    out.push({ action: 'key', key: 'Enter', ...at });
  }
  return out.map((step) => {
    if (step == null || typeof step !== 'object' || step.refFromStep === undefined || step.refFromStep === null) return step;
    const from = Number(step.refFromStep);
    if (!Number.isInteger(from) || from < 0 || from >= startOf.length) return step;
    return { ...step, refFromStep: startOf[from] };
  });
}

export function validateBurst(params) {
  if (!isPlainObject(params)) return { ok: false, error: 'Burst params must be an object.' };
  const unexpectedParam = Object.keys(params).find((key) => !['tabId', 'steps', 'executionMode'].includes(key));
  if (unexpectedParam) return { ok: false, error: `Burst params do not allow ${unexpectedParam}.` };
  if (params.tabId != null && (typeof params.tabId === 'boolean' || String(params.tabId).trim() === '' || !Number.isInteger(Number(params.tabId)) || Number(params.tabId) < 0)) {
    return { ok: false, error: 'Invalid burst tabId.' };
  }
  if (!Array.isArray(params.steps) || params.steps.length < 1 || params.steps.length > BURST_MAX_STEPS) {
    return { ok: false, error: `Burst requires 1-${BURST_MAX_STEPS} steps.` };
  }
  if (params.executionMode != null && !EXECUTION_MODES.includes(params.executionMode)) {
    return { ok: false, error: 'Invalid executionMode.' };
  }
  for (let index = 0; index < params.steps.length; index += 1) {
    const error = validateBurstStep(params.steps[index]);
    if (error) return { ok: false, error: `Invalid burst step ${index}: ${error}` };
    const passthrough = params.steps[index].refFromStep;
    if (passthrough !== undefined && passthrough !== null) {
      const fromIndex = Number(passthrough);
      if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= index) {
        return { ok: false, error: `Invalid burst step ${index}: refFromStep must reference an earlier burst step.` };
      }
      const refIndex = params.steps[index].refIndex;
      if (refIndex !== undefined && refIndex !== null && (!Number.isInteger(Number(refIndex)) || Number(refIndex) < 0)) {
        return { ok: false, error: `Invalid burst step ${index}: refIndex must be a non-negative integer.` };
      }
    }
  }
  return { ok: true };
}

export function burstStaleRef(results, from, stepTabId) {

  const list = results || [];
  for (let index = Number(from); index < list.length; index += 1) {
    const entry = list[index];
    if (entry && entry.action === 'navigate' && entry.tabId === stepTabId) return true;
  }
  return false;
}

export function burstCrossTabRef(results, from, stepTabId) {

  const source = (results || [])[Number(from)];
  const sourceTab = source ? source.tabId : undefined;
  if (sourceTab === undefined || sourceTab === null) return false;
  return sourceTab !== stepTabId;
}

export function validateCommand(command) {
  if (!isPlainObject(command)) return { ok: false, error: 'Command must be an object.' };
  if (typeof command.id !== 'string' || command.id.length < 8 || command.id.length > 128) {
    return { ok: false, error: 'Invalid command id.' };
  }
  if (typeof command.method !== 'string' || !METHOD_SPECS[command.method]) {
    return { ok: false, error: 'Method is not allowlisted.' };
  }
  if (command.params != null && !isPlainObject(command.params)) {
    return { ok: false, error: 'Command params must be an object.' };
  }
  if (command.method === 'page.pointer') {
    const params = command.params || {};
    const action = String(params.action || 'click');
    if (!['move', 'click', 'drag', 'wheel', 'hover'].includes(action)) return { ok: false, error: 'Invalid pointer action.' };
    if (action === 'hover') {
      if (typeof params.ref !== 'string' || !params.ref) return { ok: false, error: 'Invalid pointer ref.' };
    } else {
      for (const key of ['x', 'y']) if (!Number.isFinite(Number(params[key]))) return { ok: false, error: `Invalid pointer ${key}.` };
      if (action === 'drag') for (const key of ['endX', 'endY']) if (!Number.isFinite(Number(params[key]))) return { ok: false, error: `Invalid pointer ${key}.` };
      if (action === 'wheel' && !Number.isFinite(Number(params.deltaY))) return { ok: false, error: 'Invalid pointer deltaY.' };
    }
  }
  if (command.method === 'page.capture') {
    const params = command.params || {};
    const allowedKeys = new Set(['tabId', 'crop', 'quality', 'maxWidth', 'maxHeight', 'previousHash', 'fullPage']);
    const unexpectedKey = Object.keys(params).find((key) => !allowedKeys.has(key));
    if (unexpectedKey) return { ok: false, error: `Capture params do not allow ${unexpectedKey}.` };
    if (params.crop != null) {
      if (!isPlainObject(params.crop)) return { ok: false, error: 'Capture crop must be an object.' };
      const cropKeys = new Set(['x', 'y', 'width', 'height']);
      const unexpectedCropKey = Object.keys(params.crop).find((key) => !cropKeys.has(key));
      if (unexpectedCropKey) return { ok: false, error: `Capture crop does not allow ${unexpectedCropKey}.` };
      for (const key of ['x', 'y']) {
        if (!Number.isFinite(Number(params.crop[key])) || Number(params.crop[key]) < 0) return { ok: false, error: `Invalid capture crop ${key}.` };
      }
      for (const key of ['width', 'height']) {
        if (!Number.isFinite(Number(params.crop[key])) || Number(params.crop[key]) <= 0) return { ok: false, error: `Invalid capture crop ${key}.` };
      }
    }
    if (params.quality != null && (!Number.isInteger(Number(params.quality)) || Number(params.quality) < 40 || Number(params.quality) > 80)) {
      return { ok: false, error: 'Capture quality must be an integer from 40 to 80.' };
    }
    if (params.maxWidth != null && (!Number.isInteger(Number(params.maxWidth)) || Number(params.maxWidth) < 320 || Number(params.maxWidth) > 1600)) {
      return { ok: false, error: 'Capture maxWidth must be an integer from 320 to 1600.' };
    }
    if (params.maxHeight != null && (!Number.isInteger(Number(params.maxHeight)) || Number(params.maxHeight) < 240 || Number(params.maxHeight) > 1200)) {
      return { ok: false, error: 'Capture maxHeight must be an integer from 240 to 1200.' };
    }
    if (params.previousHash != null && !/^[a-f0-9]{64}$/i.test(String(params.previousHash))) {
      return { ok: false, error: 'Capture previousHash must be a SHA-256 hex digest.' };
    }
    if (params.fullPage != null && typeof params.fullPage !== 'boolean') {
      return { ok: false, error: 'Capture fullPage must be a boolean.' };
    }
  }
  if (command.method === 'page.fill') {

    const value = (command.params || {}).value;
    if (typeof value !== 'string') {
      return { ok: false, error: 'page.fill requires a string value. Use "" to clear the field.' };
    }
    if (value.length > 20000) {
      return { ok: false, error: 'page.fill value must be at most 20000 characters.' };
    }
  }
  if (command.params?.executionMode != null && !EXECUTION_MODES.includes(command.params.executionMode)) {
    return { ok: false, error: 'Invalid executionMode.' };
  }
  if (command.method === 'browser.burst') {
    const burst = validateBurst(command.params || {});
    if (!burst.ok) return burst;
  }
  const timeoutMax = command.method === 'browser.burst' ? BURST_MAX_TIMEOUT_MS : 55000;
  return {
    ok: true,
    command: {
      id: command.id,
      method: command.method,
      params: command.params || {},
      timeoutMs: clamp(command.timeoutMs, 500, timeoutMax, METHOD_SPECS[command.method].timeoutMs)
    }
  };
}

export function normalizeError(error, code = 'EXECUTION_ERROR') {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const errorCode = typeof error?.code === 'string' && error.code ? error.code : code;
  const normalized = { code: errorCode.slice(0, 100), message: message.slice(0, 1000) };
  if (isPlainObject(error?.details)) normalized.details = error.details;
  return normalized;
}

export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch (error) {

    globalThis.OperaAgentLog?.debug?.('SAFE_URL_PARSE_FAILED', error?.message || String(error));
    return null;
  }
}
