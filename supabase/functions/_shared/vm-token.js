// @last-edited: 2026-10-04 11:10 UTC.
// @title: vm-token — Deno edge function..
// @context: Deno edge function.
// @state: Deno edge function..
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

const TOKEN_PREFIX = 'oavm1';
const KINDS = new Set(['PROGRAM', 'CHECKPOINT', 'RESULT']);
// The VM contract bounds the raw canonical payload at 128 KiB. The encrypted
// envelope adds a tiny authenticated JSON wrapper, so its internal plaintext cap
// must leave room for that wrapper without weakening the raw payload limit enforced
// by the host.
const MAX_PLAINTEXT_BYTES = 132096;
const MAX_TOKEN_BYTES = 196608;

export class VmHostTokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VmHostTokenError';
    this.code = code;
  }
}

/**
 * @returns {never} Always throws; annotated so Deno infers that key decoders
 * return bytes rather than bytes-or-undefined.
 */
function fail(code, message) {
  throw new VmHostTokenError(code, message);
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function toBase64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail('INVALID_TOKEN', `${path} is invalid.`);
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    fail('INVALID_TOKEN', `${path} is invalid.`);
  }
}

function assertKind(kind) {
  if (typeof kind !== 'string' || !KINDS.has(kind)) fail('INVALID_TOKEN_KIND', 'VM token kind is invalid.');
  return kind;
}

function aad(kind) {
  return new TextEncoder().encode(`opera-agent-vm:v1:${assertKind(kind)}`);
}

export function decodeVmHostKey(encoded) {
  const key = fromBase64Url(encoded, 'key');
  if (key.byteLength !== 32) fail('INVALID_SERVER_KEY', 'VM host key must contain exactly 32 bytes.');
  return key;
}

async function importKey(keyBytes) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.byteLength !== 32) fail('INVALID_SERVER_KEY', 'VM host key must contain exactly 32 bytes.');
  return await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function sealVmHostToken(payload, keyBytes, { kind } = {}) {
  const checkedKind = assertKind(kind);
  let serialized;
  try {
    serialized = JSON.stringify({ version: 1, kind: checkedKind, payload });
  } catch {
    fail('INVALID_PAYLOAD', 'VM host payload must be JSON serializable.');
  }
  const plaintext = new TextEncoder().encode(serialized);
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) fail('OVER_LIMIT', 'VM host payload exceeds the plaintext byte limit.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(keyBytes);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(checkedKind) }, key, plaintext));
  const token = `${TOKEN_PREFIX}.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
  if (byteLength(token) > MAX_TOKEN_BYTES) fail('OVER_LIMIT', 'VM host token exceeds the ciphertext byte limit.');
  return token;
}

export async function openVmHostToken(token, keyBytes, { kind } = {}) {
  const checkedKind = assertKind(kind);
  if (typeof token !== 'string' || byteLength(token) > MAX_TOKEN_BYTES) fail('INVALID_TOKEN', 'VM host token is invalid or over its byte limit.');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) fail('INVALID_TOKEN', 'VM host token has an unsupported format.');
  const iv = fromBase64Url(parts[1], 'token.iv');
  const ciphertext = fromBase64Url(parts[2], 'token.ciphertext');
  if (iv.byteLength !== 12 || ciphertext.byteLength < 17) fail('INVALID_TOKEN', 'VM host token is malformed.');
  try {
    const key = await importKey(keyBytes);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(checkedKind) }, key, ciphertext);
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) fail('OVER_LIMIT', 'VM host plaintext exceeds its byte limit.');
    const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    if (!decoded || decoded.version !== 1 || decoded.kind !== checkedKind
        || Object.keys(decoded).some((field) => !['version', 'kind', 'payload'].includes(field))) {
      fail('INVALID_TOKEN', 'VM host token payload is invalid.');
    }
    return decoded.payload;
  } catch (error) {
    if (error instanceof VmHostTokenError) throw error;
    fail('INVALID_TOKEN', 'VM host token authentication failed.');
  }
}
