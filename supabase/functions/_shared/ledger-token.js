// @last-edited: 2026-10-04 11:10 UTC.
// @title: ledger-token — token — Repository file.
// @context: Deno edge function.
// @state: resolve deno check type errors in gateway/ledger/vm/runner.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: goal-ledger.

import { LEDGER_LIMITS, validateLedger } from './goal-ledger.js';

const TOKEN_PREFIX = 'oal1';
const TOKEN_AAD = new TextEncoder().encode('opera-agent-ledger:v1');
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const LEDGER_SERVER_LIMITS = Object.freeze({
  requestBytes: 131072,
  tokenBytes: LEDGER_LIMITS.ledgerTokenBytes,
  mutationRequestsPerMinute: 20,
  readRequestsPerMinute: 60,
});

export class LedgerTokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LedgerTokenError';
    this.code = code;
  }
}
/**
 * @returns {never} Always throws; annotated so Deno infers that callers
 * never fall through (otherwise token openers look nullable).
 */
function fail(code, message) {
  throw new LedgerTokenError(code, message);
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

function assertRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) fail('INVALID_REQUEST_ID', 'requestId is invalid.');
  return value;
}

export function decodeLedgerKey(encoded) {
  const key = fromBase64Url(encoded, 'key');
  if (key.byteLength !== 32) fail('INVALID_SERVER_KEY', 'Ledger key must contain exactly 32 bytes.');
  return key;
}

async function importKey(keyBytes) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.byteLength !== 32) fail('INVALID_SERVER_KEY', 'Ledger key must contain exactly 32 bytes.');
  return await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function sealLedgerToken(ledgerInput, keyBytes, { requestId, issuedAt } = {}) {
  const checkedRequestId = assertRequestId(requestId);
  const ledger = await validateLedger(ledgerInput, { now: issuedAt });
  const payload = new TextEncoder().encode(JSON.stringify({ version: 1, requestId: checkedRequestId, issuedAt, ledger }));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(keyBytes);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: TOKEN_AAD }, key, payload));
  const token = `${TOKEN_PREFIX}.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
  if (new TextEncoder().encode(token).byteLength > LEDGER_SERVER_LIMITS.tokenBytes) fail('OVER_LIMIT', 'Ledger token exceeds its byte limit.');
  return token;
}

/**
 * @param {string} token
 * @param {Uint8Array} keyBytes
 * @param {{ now?: string, allowExpired?: boolean }} [options]
 */
export async function openLedgerToken(token, keyBytes, { now, allowExpired = false } = {}) {
  if (typeof token !== 'string' || new TextEncoder().encode(token).byteLength > LEDGER_SERVER_LIMITS.tokenBytes) {
    fail('INVALID_TOKEN', 'Ledger token is invalid or over its byte limit.');
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) fail('INVALID_TOKEN', 'Ledger token has an unsupported format.');
  const iv = fromBase64Url(parts[1], 'token.iv');
  const ciphertext = fromBase64Url(parts[2], 'token.ciphertext');
  if (iv.byteLength !== 12 || ciphertext.byteLength < 17) fail('INVALID_TOKEN', 'Ledger token is malformed.');
  try {
    const key = await importKey(keyBytes);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: TOKEN_AAD }, key, ciphertext);
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    if (!payload || payload.version !== 1 || Object.keys(payload).some((field) => !['version', 'requestId', 'issuedAt', 'ledger'].includes(field))) {
      fail('INVALID_TOKEN', 'Ledger token payload is invalid.');
    }
    assertRequestId(payload.requestId);
    const ledger = await validateLedger(payload.ledger, allowExpired ? {} : { now });
    return Object.freeze({ requestId: payload.requestId, issuedAt: payload.issuedAt, ledger });
  } catch (error) {
    if (error instanceof LedgerTokenError || error?.code === 'LEDGER_EXPIRED') throw error;
    fail('INVALID_TOKEN', 'Ledger token authentication failed.');
  }
}
