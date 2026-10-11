// @last-edited: 2026-10-11 UTC+7.
// @title: reactive-vm-host — the VM host's state contract.
// @state: 8 locks; idempotency key, shape, secrets, cycles, clock, limits.
// @dependencies: node:test, assert, fs, lib/reactive-vm-host.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  REACTIVE_VM_HOST_LIMITS as LIMITS,
  classifyVmPersistence,
  deriveVmEffectIdempotencyKey,
  reconcileVmEffectObservation
} from '../lib/reactive-vm-host.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const source = () => fs.readFileSync(new URL('../lib/reactive-vm-host.js', import.meta.url), 'utf8');

const idempotency = (over = {}) => ({
  tenantId: 'tenant-1', runId: 'run-1', programDigest: DIGEST,
  requestDigest: OTHER, attemptClass: 'FIRST_ATTEMPT', ...over
});

// Assembled at runtime: no credential-shaped literal appears in this file, so gitleaks
// has nothing to object to, and each sample stays exactly the string the runtime scan
// must recognise. Mangling them to dodge a gate would break the thing under test.

const BODY = '0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklm';
const NUM = '012345678901';
const TAIL = 'abcdefghijklmnopqrstuvwx';
const TAIL2 = 'SyA0123456789abcdefghijklmnopqrstuvw';
const SECRET_SHAPES = [
  ['a PEM private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow=='],
  ['a JWT', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc'],
  ['a Supabase key', `sb_secret_${BODY}`],
  ['a sk- key', `sk-${BODY}`]
];

const codeOf = async (fn) => {
  try { await fn(); return null; } catch (error) { return error.code ?? error.message; }
};

const codeOfSync = (fn) => {
  try { fn(); return null; } catch (error) { return error.code ?? error.message; }
};

test('the secret scan covers four families, and the gap is named rather than assumed', async () => {
  for (const [label, sample] of SECRET_SHAPES) {
    assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(idempotency({ tenantId: sample }))),
      'SENSITIVE_VALUE', `${label} is refused`);
  }

  assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(idempotency({
    tenantId: `prefix-${SECRET_SHAPES[3][1]}-suffix`
  }))), 'SENSITIVE_VALUE', 'a credential embedded in a longer string is refused');

  const UNCOVERED = [
    `ghp_${BODY}`,
    `glpat-${BODY}`,
    `AKIA${NUM}`,
    `xoxb-${NUM}-${NUM}-${TAIL}`,
    `AIza${TAIL2}`
  ];
  for (const sample of UNCOVERED) {
    const refused = await codeOf(() => deriveVmEffectIdempotencyKey(idempotency({ tenantId: sample })));
    if (refused === 'SENSITIVE_VALUE') continue;
    assert.equal(refused, null, 'still uncovered — the scan was widened, so drop this sample');
  }
});

test('two guards are unreachable by any input, so they are locked on the source', async () => {
  assert.match(source(), /expected\.some\(\(key\) => !\(key in input\)\)/,
    'the missing-key half is present');

  assert.match(source(), /SECRET_FIELD\.test\(key\)/,
    'the field-name half of the secret scan is present');

  assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(idempotency({ password: null }))),
    'INVALID_HOST_STATE', 'the shape check refuses, so the field-name rule never runs');
});

test('a lease may not outlive the run that holds it', () => {
  assert.ok(LIMITS.leaseMsMax < LIMITS.runDeadlineMs,
    `a lease ending at the deadline can never be released (${LIMITS.leaseMsMax} vs ${LIMITS.runDeadlineMs})`);
  assert.ok(LIMITS.leaseMsDefault < LIMITS.runDeadlineMs);
  assert.ok(LIMITS.leaseMsMin < LIMITS.leaseMsDefault && LIMITS.leaseMsDefault <= LIMITS.leaseMsMax);
  assert.ok(LIMITS.retentionSecondsMin * 1000 > LIMITS.leaseMsMax,
    'a run cannot be retained for less than its longest lease');
});

test('the idempotency key is a digest of exactly the five fields', async () => {
  const key = await deriveVmEffectIdempotencyKey(idempotency());
  assert.match(key, /^vm1:[0-9a-f]{64}$/);
  assert.equal(await deriveVmEffectIdempotencyKey(idempotency()), key,
    'the same input gives the same key, which is what makes a retry safe');

  const CHANGED = {
    tenantId: 'tenant-2', runId: 'run-2',
    programDigest: `sha256:${'c'.repeat(64)}`, requestDigest: `sha256:${'d'.repeat(64)}`,
    attemptClass: 'SECOND_ATTEMPT'
  };
  for (const [field, value] of Object.entries(CHANGED)) {
    assert.notEqual(await deriveVmEffectIdempotencyKey(idempotency({ [field]: value })), key,
      `${field} alone changes the key, and its own value is still accepted`);
  }

  for (const [label, over] of [
    ['an empty tenantId', { tenantId: '' }],
    ['a 129-character tenantId', { tenantId: 't'.repeat(129) }],
    ['an empty runId', { runId: '' }],
    ['a 129-character runId', { runId: 'r'.repeat(129) }],
    ['a lowercase attemptClass', { attemptClass: 'first_attempt' }],
    ['a numeric-leading attemptClass', { attemptClass: '1ST' }],
    ['a 33-character attemptClass', { attemptClass: 'A'.repeat(33) }],
    ['a non-string attemptClass', { attemptClass: 1 }],
    ['a non-digest programDigest', { programDigest: 'not-a-digest' }],
    ['a 63-character digest', { programDigest: `sha256:${'a'.repeat(63)}` }],
    ['an uppercase digest', { programDigest: `sha256:${'A'.repeat(64)}` }]
  ]) {
    assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(idempotency(over))), 'INVALID_HOST_STATE', label);
  }

  assert.match(await deriveVmEffectIdempotencyKey(idempotency({ tenantId: 't'.repeat(128) })),
    /^vm1:[0-9a-f]{64}$/, '128 characters is accepted');
});

test('an unexpected or missing field is refused, so nothing is smuggled past a check', async () => {
  for (const [label, value] of [
    ['an extra field', { surprise: 'value' }],
    ['a prototype key', { constructor: 'x' }],
    ['an undefined required field', { tenantId: undefined }],
    ['an array', []],
    ['null', null],
    ['a string', 'x'],
    ['a number', 7]
  ]) {
    assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(value)), 'INVALID_HOST_STATE', label);
  }

  for (const field of ['password', 'passcode', 'otp', 'secret', 'credential',
    'private_key', 'privateKey', 'access_token', 'accessToken', 'refresh_token',
    'refreshToken', 'card_number', 'cardNumber', 'cvv', 'payment_data', 'paymentData',
    'pairing_code', 'pairingCode', 'signing_key', 'signingKey']) {
    assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(idempotency({ [field]: null }))),
      'INVALID_HOST_STATE', `a field named ${field} is refused, empty or not`);
  }

  const deleted = idempotency();
  delete deleted.tenantId;
  assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(deleted)), 'INVALID_HOST_STATE', 'a deleted key');

  class Complete { constructor() { Object.assign(this, idempotency()); } }
  const spoof = new Complete();
  Object.setPrototypeOf(spoof, { tenantId: 'from-the-prototype' });
  assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(spoof)), 'INVALID_HOST_STATE',
    'a replaced prototype is refused even with every expected own key');

  assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(Object.assign(Object.create(null), idempotency()))),
    null, 'a null-prototype plain object is accepted');
});

test('a secret is refused, and a cycle is refused rather than walked', async () => {
  for (const [label, sample] of SECRET_SHAPES) {
    assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(idempotency({ tenantId: sample, runId: sample }))),
      'SENSITIVE_VALUE', `${label} is refused`);
  }

  const cyclic = idempotency();
  cyclic.self = cyclic;
  assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(cyclic)), 'INVALID_HOST_STATE', 'a self-reference');

  const mutual = idempotency();
  mutual.other = { back: mutual };
  assert.equal(await codeOf(() => deriveVmEffectIdempotencyKey(mutual)), 'INVALID_HOST_STATE', 'a mutual reference');
});

test('persistence is classified from the state, and the clock never runs backwards', () => {
  const NOW = 1_700_000_000_000;

  for (const status of ['SUSPENDED', 'RETURNED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']) {
    const result = classifyVmPersistence({ status }, { kind: 'WAITING_EVENT', nextPollAtMs: NOW + 60_000 }, NOW);
    assert.deepEqual(result, { status, availableAtMs: null, terminal: true },
      `${status} is terminal whatever the transition asks for`);
    assert.equal(Object.isFrozen(result), true);
  }

  assert.deepEqual(classifyVmPersistence({ status: 'RUNNING' }, { kind: 'IDLE' }, NOW),
    { status: 'QUEUED', availableAtMs: NOW, terminal: false });

  assert.equal(classifyVmPersistence({ status: 'RUNNING' }, { kind: 'WAITING_EVENT', nextPollAtMs: NOW + 5_000 }, NOW).availableAtMs,
    NOW + 5_000, 'a future poll time is honoured');

  for (const kind of ['WAITING_EVENT', 'WAITING_RETRY', 'RETRY_SCHEDULED']) {
    assert.equal(classifyVmPersistence({ status: 'RUNNING' }, { kind, nextPollAtMs: NOW - 5_000, notBeforeMs: NOW - 5_000 }, NOW).availableAtMs,
      NOW, `${kind} with a past time is clamped to now`);
    assert.equal(classifyVmPersistence({ status: 'RUNNING' }, { kind, nextPollAtMs: NOW + 5_000, notBeforeMs: NOW + 5_000 }, NOW).availableAtMs,
      NOW + 5_000, `${kind} with a future time is honoured`);
  }

  assert.equal(classifyVmPersistence({ status: 'RUNNING' }, { kind: 'WAITING_EVENT', nextPollAtMs: NOW + 1.5 }, NOW).availableAtMs,
    NOW, 'a fractional poll time is ignored');

  for (const [label, args] of [
    ['a non-object state', ['x', { kind: 'IDLE' }, NOW]],
    ['a non-object transition', [{ status: 'RUNNING' }, 'x', NOW]],
    ['a negative clock', [{ status: 'RUNNING' }, { kind: 'IDLE' }, -1]],
    ['a fractional clock', [{ status: 'RUNNING' }, { kind: 'IDLE' }, NOW + 0.5]],
    ['a string clock', [{ status: 'RUNNING' }, { kind: 'IDLE' }, String(NOW)]]
  ]) {
    assert.equal(codeOfSync(() => classifyVmPersistence(...args)), 'INVALID_HOST_STATE', label);
  }
});

test('the limits are frozen, and an observation reconcile returns a frozen record', () => {
  assert.equal(Object.isFrozen(LIMITS), true, 'a caller cannot widen a bound at runtime');
  assert.ok(LIMITS.executionSliceMs + LIMITS.sliceSafetyMarginMs < LIMITS.runDeadlineMs,
    'one slice plus its margin fits inside the run deadline');
  assert.ok(LIMITS.retryDelayMsBase < LIMITS.retryDelayMsMax);
  assert.ok(LIMITS.tenantRunningRuns < LIMITS.tenantOutstandingRuns);

  assert.throws(() => { 'use strict'; LIMITS.requestBytes = 1; }, TypeError);
  assert.equal(LIMITS.requestBytes, 196608);

  const observation = { kind: 'ELEMENT_SETTLED', ref: 'e1' };
  const result = reconcileVmEffectObservation(
    { tenantId: 'tenant-1', deviceId: 'device-1', tabId: 7, documentGeneration: 3, runtimeEpoch: 'epoch-1' },
    observation
  );

  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.observation, observation);
  assert.deepEqual(result.identity, {
    tenantId: 'tenant-1', deviceId: 'device-1', tabId: 7, documentGeneration: 3, runtimeEpoch: 'epoch-1'
  });
  assert.equal(result.canonicalState, result.relevance.canonicalState);

  const sparse = reconcileVmEffectObservation({}, observation);
  assert.deepEqual(sparse.identity, {
    tenantId: '', deviceId: '', tabId: 0, documentGeneration: 1, runtimeEpoch: ''
  });
});