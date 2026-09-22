export const PRODUCT_VERSION = '1.6.6';
export const PROTOCOL_VERSION = 1;

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
  pointer: 'page.pointer'
});
export const BURST_STEP_KEYS = Object.freeze({
  read: ['action', 'offset', 'limit', 'includeElements', 'maxElements'],
  find: ['action', 'text', 'role', 'tag', 'exact', 'limit'],
  click: ['action', 'ref', 'refFromStep', 'refIndex'],
  fill: ['action', 'ref', 'value', 'refFromStep', 'refIndex'],
  key: ['action', 'key'],
  scroll: ['action', 'x', 'y', 'absolute', 'smooth'],
  wait: ['action', 'ref', 'selector', 'text', 'visibleOnly', 'timeoutMs', 'intervalMs'],
  pointer: ['action', 'pointerAction', 'x', 'y', 'endX', 'endY', 'deltaX', 'deltaY']
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
  'page.wait_for': { timeoutMs: 15000 },
  'media.state': { timeoutMs: 5000 },
  'media.play': { timeoutMs: 5000 },
  'media.pause': { timeoutMs: 5000 },
  'media.seek': { timeoutMs: 5000 }
});

export const ALLOWED_METHODS = Object.freeze(Object.keys(METHOD_SPECS));

export function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validRef(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 300;
}

function validateBurstStep(step) {
  if (!isPlainObject(step)) return 'Each burst step must be an object.';
  const action = String(step.action || '');
  if (!BURST_ACTION_METHODS[action]) return 'Burst action is not allowlisted.';
  const allowedKeys = new Set(BURST_STEP_KEYS[action]);
  const unexpectedKey = Object.keys(step).find((key) => !allowedKeys.has(key));
  if (unexpectedKey) return `Burst ${action} does not allow ${unexpectedKey}.`;

  if (action === 'click' && !validRef(step.ref) && step.refFromStep === undefined) return 'Burst click requires a valid ref or refFromStep.';
  if (action === 'fill' && !validRef(step.ref) && step.refFromStep === undefined) return 'Burst fill requires a valid ref or refFromStep and a value of at most 20000 characters.';
  if (action === 'fill' && step.refFromStep === undefined && (typeof step.value !== 'string' || step.value.length > 20000)) {
    return 'Burst fill requires a valid ref or refFromStep and a value of at most 20000 characters.';
  }
  if (action === 'key' && !['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space'].includes(step.key)) {
    return 'Burst key is not allowlisted.';
  }
  if (action === 'scroll' && !Number.isFinite(Number(step.y))) return 'Burst scroll requires a finite y value.';
  if (action === 'wait' && !validRef(step.ref) && !(typeof step.selector === 'string' && step.selector.length >= 1 && step.selector.length <= 500) && !(typeof step.text === 'string' && step.text.length >= 1 && step.text.length <= 300)) {
    return 'Burst wait requires a ref, selector, or text target.';
  }
  if (action === 'pointer') {
    const pointerAction = String(step.pointerAction || 'click');
    if (!['move', 'click', 'drag', 'wheel'].includes(pointerAction)) return 'Invalid burst pointer action.';
    for (const key of ['x', 'y']) if (!Number.isFinite(Number(step[key]))) return `Invalid burst pointer ${key}.`;
    if (pointerAction === 'drag') for (const key of ['endX', 'endY']) if (!Number.isFinite(Number(step[key]))) return `Invalid burst pointer ${key}.`;
    if (pointerAction === 'wheel' && !Number.isFinite(Number(step.deltaY))) return 'Invalid burst pointer deltaY.';
  }
  return null;
}

export function validateBurst(params) {
  if (!isPlainObject(params)) return { ok: false, error: 'Burst params must be an object.' };
  const unexpectedParam = Object.keys(params).find((key) => !['tabId', 'steps', 'executionMode'].includes(key));
  if (unexpectedParam) return { ok: false, error: `Burst params do not allow ${unexpectedParam}.` };
  if (params.tabId != null && (!Number.isInteger(Number(params.tabId)) || Number(params.tabId) < 0)) {
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
    if (!['move', 'click', 'drag', 'wheel'].includes(action)) return { ok: false, error: 'Invalid pointer action.' };
    for (const key of ['x', 'y']) if (!Number.isFinite(Number(params[key]))) return { ok: false, error: `Invalid pointer ${key}.` };
    if (action === 'drag') for (const key of ['endX', 'endY']) if (!Number.isFinite(Number(params[key]))) return { ok: false, error: `Invalid pointer ${key}.` };
    if (action === 'wheel' && !Number.isFinite(Number(params.deltaY))) return { ok: false, error: 'Invalid pointer deltaY.' };
  }
  if (command.method === 'page.capture') {
    const params = command.params || {};
    const allowedKeys = new Set(['tabId', 'crop', 'quality', 'maxWidth', 'maxHeight', 'previousHash']);
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
  } catch {
    return null;
  }
}
