export const PRODUCT_VERSION = '1.0.1';
export const PROTOCOL_VERSION = 1;

export const METHOD_SPECS = Object.freeze({
  'browser.ping': { timeoutMs: 3000 },
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
  return {
    ok: true,
    command: {
      id: command.id,
      method: command.method,
      params: command.params || {},
      timeoutMs: clamp(command.timeoutMs, 500, 55000, METHOD_SPECS[command.method].timeoutMs)
    }
  };
}

export function normalizeError(error, code = 'EXECUTION_ERROR') {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return { code, message: message.slice(0, 1000) };
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
