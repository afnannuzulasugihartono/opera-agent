// @last-edited: 2026-11-13 UTC+7.
// @title: digest - the canonical digest both roads share.
// @state: the one encoder; the VM digests itself with this, nothing else does.
// @dependencies: none.

// WHY THIS FILE EXISTS.
// The VM digests a program with the same function on both roads, and the digests are pinned by gates.
// A second implementation would drift; one file keeps them byte-identical by construction.

const DIGEST_PREFIX = 'sha256:';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function canonicalJson(value) {
  const active = new WeakSet();
  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    throw error;
  };
  function encode(item, path) {
    if (item === null) return 'null';
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item)) fail('UNSUPPORTED_CANONICAL_VALUE', `${path} must be a safe integer.`);
      return String(item);
    }
    if (typeof item === 'string') return JSON.stringify(item.normalize('NFC'));
    if (!item || typeof item !== 'object') fail('UNSUPPORTED_CANONICAL_VALUE', `${path} has an unsupported canonical value.`);
    if (active.has(item)) fail('UNSUPPORTED_CANONICAL_VALUE', `${path} contains a cycle.`);
    active.add(item);
    let encoded;
    if (Array.isArray(item)) encoded = `[${item.map((child, index) => encode(child, `${path}[${index}]`)).join(',')}]`;
    else {
      if (!isPlainObject(item)) fail('UNSUPPORTED_CANONICAL_VALUE', `${path} must be a plain object.`);
      const keys = Object.keys(item);
      for (const key of keys) if (!/^[\x20-\x7e]+$/.test(key)) fail('INVALID_CANONICAL_KEY', `${path} contains a non-ASCII key.`);
      keys.sort((a, b) => {
        const left = new TextEncoder().encode(a);
        const right = new TextEncoder().encode(b);
        const length = Math.min(left.length, right.length);
        for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
        return left.length - right.length;
      });
      encoded = `{${keys.map((key) => `${JSON.stringify(key)}:${encode(item[key], `${path}.${key}`)}`).join(',')}}`;
    }
    active.delete(item);
    return encoded;
  }
  return encode(value, '$');
}

export async function digestCanonical(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `${DIGEST_PREFIX}${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
