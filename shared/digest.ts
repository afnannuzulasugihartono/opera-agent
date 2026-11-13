// @last-edited: 2026-11-13 UTC+7.
// @title: digest - the canonical digest both roads share.
// @state: the one encoder; the VM digests itself with this, nothing else does.
// @dependencies: none.

// WHY THIS FILE EXISTS.
// The VM digests a program with the same function on both roads, and the digests are pinned by gates.
// A second implementation would drift; one file keeps them byte-identical by construction.

const DIGEST_PREFIX = 'sha256:';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

class DigestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DigestError';
    this.code = code;
  }
}

// The encoder validates arbitrary untrusted input itself, including the root value; the cast only introduces it.
// Every key in its object branch comes from Object.keys(item), so the lookup is always present.

export function canonicalJson(value: unknown): string {
  const active = new WeakSet<object>();
  const fail = (code: string, message: string): never => {
    throw new DigestError(code, message);
  };
  function encode(item: JsonValue, path: string): string {
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
    let encoded: string;
    if (Array.isArray(item)) encoded = `[${item.map((child, index) => encode(child, `${path}[${index}]`)).join(',')}]`;
    else {
      if (!isRecord(item)) fail('UNSUPPORTED_CANONICAL_VALUE', `${path} must be a plain object.`);
      const keys = Object.keys(item);
      for (const key of keys) if (!/^[\x20-\x7e]+$/.test(key)) fail('INVALID_CANONICAL_KEY', `${path} contains a non-ASCII key.`);
      keys.sort((a: string, b: string) => {
        const left = new TextEncoder().encode(a);
        const right = new TextEncoder().encode(b);
        const length = Math.min(left.length, right.length);
        for (let index = 0; index < length; index += 1) {
          const l = left[index];
          const r = right[index];
          if (l !== undefined && r !== undefined && l !== r) return l - r;
        }
        return left.length - right.length;
      });
      encoded = `{${keys.map((key) => `${JSON.stringify(key)}:${encode(item[key]!, `${path}.${key}`)}`).join(',')}}`;
    }
    active.delete(item);
    return encoded;
  }
  return encode(value as JsonValue, '$');
}

export async function digestCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `${DIGEST_PREFIX}${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
