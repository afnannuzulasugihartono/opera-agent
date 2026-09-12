import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  REACTIVE_VM_HOST_7E_LIMITS,
  ReactiveVmHostError,
  classifyVmPersistence7E,
  deriveVmEffectIdempotencyKey7E,
  retryDelayMs7E,
  validateVmPersistedMetadata7E,
} from '../lib/reactive-vm-host-7e.js';
import {
  decodeVmHostKey,
  openVmHostToken,
  sealVmHostToken,
} from '../supabase/functions/_shared/vm-token.js';

const digest = (c = 'a') => `sha256:${c.repeat(64)}`;

async function hostError(code, fn) {
  await assert.rejects(fn, (error) => error instanceof ReactiveVmHostError && error.code === code);
}

test('7E freezes bounded host/storage limits at or below Milestone 7 budgets', () => {
  assert.equal(REACTIVE_VM_HOST_7E_LIMITS.programBytes, 131072);
  assert.equal(REACTIVE_VM_HOST_7E_LIMITS.checkpointBytes, 131072);
  assert.equal(REACTIVE_VM_HOST_7E_LIMITS.resultBytes, 131072);
  assert.equal(REACTIVE_VM_HOST_7E_LIMITS.executionSliceMs, 20000);
  assert.equal(REACTIVE_VM_HOST_7E_LIMITS.runDeadlineMs, 300000);
  assert.equal(REACTIVE_VM_HOST_7E_LIMITS.tenantRunningRuns, 4);
  assert.equal(REACTIVE_VM_HOST_7E_LIMITS.tenantOutstandingRuns, 32);
  assert.equal(REACTIVE_VM_HOST_7E_LIMITS.enqueuePerMinute, 20);
  assert.ok(REACTIVE_VM_HOST_7E_LIMITS.opaqueTokenBytes > REACTIVE_VM_HOST_7E_LIMITS.checkpointBytes);
});

test('7E effect idempotency is deterministic and control-sensitive', async () => {
  const base = {
    tenantId: 'tenant-a', runId: 'run-a', programDigest: digest('1'),
    requestDigest: digest('2'), attemptClass: 'OBSERVATION',
  };
  const first = await deriveVmEffectIdempotencyKey7E(base);
  const replay = await deriveVmEffectIdempotencyKey7E({ ...base });
  const changed = await deriveVmEffectIdempotencyKey7E({ ...base, requestDigest: digest('3') });
  assert.match(first, /^vm1:[0-9a-f]{64}$/);
  assert.equal(first, replay);
  assert.notEqual(first, changed);
  assert.ok(Buffer.byteLength(first) <= 128);
});

test('7E persisted metadata is digest-only and rejects raw/sensitive browser payload fields', async () => {
  const safe = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    requestId: 'req-1', programDigest: digest('1'), goalId: 'goal-1', goalRevision: 2,
    targetDigest: digest('2'), status: 'QUEUED', checkpointDigest: digest('3'), checkpointBytes: 4096,
    resultDigest: null, resultBytes: null, logicalTransition: 4, leaseEpoch: 2,
    expiresAt: '2026-09-12T06:00:00.000Z', availableAt: '2026-09-12T05:56:00.000Z', errorCode: null,
  };
  assert.deepEqual(validateVmPersistedMetadata7E(safe), safe);
  for (const field of ['program', 'checkpoint', 'result', 'params', 'pageText', 'screenshot', 'privateUrl', 'token']) {
    await hostError('PROHIBITED_PERSISTENCE', async () => validateVmPersistedMetadata7E({ ...safe, [field]: 'raw-value' }));
  }
  await hostError('SENSITIVE_VALUE', async () => validateVmPersistedMetadata7E({ ...safe, errorCode: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' }));
});

test('7E persistence classification never upgrades non-terminal work to completion', () => {
  assert.deepEqual(classifyVmPersistence7E({ status: 'RUNNING' }, { kind: 'CONTINUE' }, 1000), {
    status: 'QUEUED', availableAtMs: 1000, terminal: false,
  });
  assert.deepEqual(classifyVmPersistence7E({ status: 'RUNNING' }, { kind: 'WAITING_EVENT', nextPollAtMs: 1500 }, 1000), {
    status: 'QUEUED', availableAtMs: 1500, terminal: false,
  });
  assert.deepEqual(classifyVmPersistence7E({ status: 'SUSPENDED' }, { kind: 'TERMINAL', status: 'SUSPENDED' }, 1000), {
    status: 'SUSPENDED', availableAtMs: null, terminal: true,
  });
  assert.deepEqual(classifyVmPersistence7E({ status: 'RETURNED' }, { kind: 'TERMINAL', status: 'RETURNED' }, 1000), {
    status: 'RETURNED', availableAtMs: null, terminal: true,
  });
});

test('7E retry scheduling is bounded and deterministic', () => {
  assert.equal(retryDelayMs7E(0), 250);
  assert.equal(retryDelayMs7E(1), 500);
  assert.equal(retryDelayMs7E(4), 4000);
  assert.equal(retryDelayMs7E(20), 5000);
});

test('7E opaque tokens authenticate kind and ciphertext while retaining bounded plaintext', async () => {
  const key = decodeVmHostKey('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  const payload = { schemaVersion: 'OA_REACTIVE_VM_STATE_7D_V1', runId: 'run-a', status: 'READY' };
  const token = await sealVmHostToken(payload, key, { kind: 'CHECKPOINT' });
  assert.match(token, /^oavm1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await openVmHostToken(token, key, { kind: 'CHECKPOINT' }), payload);
  await assert.rejects(() => openVmHostToken(token, key, { kind: 'PROGRAM' }));
  const parts = token.split('.');
  const cipher = parts[2];
  const index = Math.floor(cipher.length / 2);
  const changedCipher = `${cipher.slice(0, index)}${cipher[index] === 'A' ? 'B' : 'A'}${cipher.slice(index + 1)}`;
  const changed = `${parts[0]}.${parts[1]}.${changedCipher}`;
  await assert.rejects(() => openVmHostToken(changed, key, { kind: 'CHECKPOINT' }));
});

test('7E SQL migration is private, default-off, lease-fenced, queue-bounded, and service-role only', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260912130000_opera_agent_reactive_vm_host.sql', import.meta.url), 'utf8');
  assert.match(sql, /milestone7_vm_enabled', 'false'/);
  assert.match(sql, /create table if not exists opera_agent_private\.vm_runs/i);
  assert.match(sql, /create table if not exists opera_agent_private\.vm_effects/i);
  assert.match(sql, /create table if not exists opera_agent_private\.vm_rate_windows/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /opera_vm_effect_reserve/i);
  assert.match(sql, /opera_vm_effect_attach/i);
  assert.match(sql, /opera_vm_checkpoint/i);
  assert.match(sql, /opera_vm_cancel/i);
  assert.match(sql, /opera_vm_cleanup/i);
  assert.match(sql, /grant execute on function public\.opera_vm_claim/i);
  assert.match(sql, /to service_role/i);
  assert.match(sql, /revoke all on table opera_agent_private\.vm_runs from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|execute)[\s\S]{0,120}\b(?:anon|authenticated)\b/i);
});

test('7E Edge host authenticates OAuth users, invokes 7D, and reuses opera_enqueue request IDs', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/opera-agent-vm/index.ts', import.meta.url), 'utf8');
  assert.match(source, /auth\.getUser/);
  assert.match(source, /validateReactiveProgram7D/);
  assert.match(source, /createReactiveVm7D/);
  assert.match(source, /advanceReactiveVm7D/);
  assert.match(source, /opera_vm_claim/);
  assert.match(source, /opera_vm_checkpoint/);
  assert.match(source, /opera_vm_effect_reserve/);
  assert.match(source, /opera_enqueue/);
  assert.match(source, /p_request_id:\s*idempotencyKey/);
  assert.doesNotMatch(source, /opera-agent-vm[^\n]*fetch\(/i);
});

test('7E source keeps public MCP and extension outside the checkpoint', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260912130000_opera_agent_reactive_vm_host.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(migration, /opera_methods\s*\(/i);
  assert.doesNotMatch(migration, /opera_devices\s+set/i);
  assert.doesNotMatch(migration, /opera_pairing/i);
});
