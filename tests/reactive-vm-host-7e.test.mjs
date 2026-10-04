// @last-edited: 2026-10-04 11:10 UTC.
// @title: reactive-vm-host-7e.test — vm-host-7e.test — Test.
// @context: Test.
// @state: consolidate the 7E host boundary into its own surface file.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: strict, node:fs, node:test, reactive-vm-host-7e, vm-token.

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

// 7E host surface, consolidated 2026-10-03.
//
// Two files locked the 7E host: its limits, tokens, persistence and migration
// contract, and its fail-closed boundary in the Edge function. The second was
// filed separately as "boundaries", which read as a different subsystem; it is
// the same host, and the two share both the Edge source and the migration.
//
//   tests/reactive-vm-host-7e.test.mjs          9 tests  55 assertions
//   tests/reactive-vm-host-7e-boundaries.test.mjs 2 tests 17 assertions
//   -> tests/reactive-vm-host-7e.test.mjs       11 tests, 72 assertions
//
//   A  limits, idempotency, persistence, tokens
//   B  the SQL migration contract
//   C  the Edge host boundary: fail-closed and authority
//
// Test count and assertion count are the invariants: 11 tests and 72
// assertions before, 11 and 72 after, none dropped, weakened or added. Both
// numbers were measured before this header was written.
//
// The two files read the same two sources -- the Edge function and the
// migration -- so those reads are declared once and shared. No test body
// changed. The siblings reactive-vm-7c, 7d, 7f, core and contract stay
// separate: each is one checkpoint's engine or contract, and folding them
// together would erase the milestone boundary their names carry.

const edgeSource = fs.readFileSync(
  new URL('../supabase/functions/opera-agent-vm/index.ts', import.meta.url),
  'utf8',
);
const hostMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260912061541_opera_agent_reactive_vm_host.sql', import.meta.url),
  'utf8',
);

const digest = (c = 'a') => `sha256:${c.repeat(64)}`;

async function hostError(code, fn) {
  await assert.rejects(fn, (error) => error instanceof ReactiveVmHostError && error.code === code);
}

// --- A. limits, idempotency, persistence, tokens -----------------------------

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

// --- B. the SQL migration contract -------------------------------------------

test('7E SQL migration is private, default-off, lease-fenced, queue-bounded, and service-role only', () => {
  assert.match(hostMigration, /milestone7_vm_enabled', 'false'/);
  assert.match(hostMigration, /create table if not exists opera_agent_private\.vm_runs/i);
  assert.match(hostMigration, /create table if not exists opera_agent_private\.vm_effects/i);
  assert.match(hostMigration, /create table if not exists opera_agent_private\.vm_rate_windows/i);
  assert.match(hostMigration, /for update skip locked/i);
  assert.match(hostMigration, /pg_advisory_xact_lock/i);
  assert.match(hostMigration, /opera_vm_effect_reserve/i);
  assert.match(hostMigration, /opera_vm_effect_attach/i);
  assert.match(hostMigration, /opera_vm_checkpoint/i);
  assert.match(hostMigration, /opera_vm_cancel/i);
  assert.match(hostMigration, /opera_vm_cleanup/i);
  assert.match(hostMigration, /grant execute on function public\.opera_vm_claim/i);
  assert.match(hostMigration, /to service_role/i);
  assert.match(hostMigration, /revoke all on table opera_agent_private\.vm_runs from public, anon, authenticated/i);
  assert.doesNotMatch(hostMigration, /grant\s+(?:select|insert|update|delete|execute)[\s\S]{0,120}\b(?:anon|authenticated)\b/i);
});

test('7E source keeps public MCP and extension outside the checkpoint', () => {
  assert.doesNotMatch(hostMigration, /opera_methods\s*\(/i);
  assert.doesNotMatch(hostMigration, /opera_devices\s+set/i);
  assert.doesNotMatch(hostMigration, /opera_pairing/i);
});

// --- C. the Edge host boundary -----------------------------------------------
//
// Why source-text pins, stated per AGENTS.md: the 7E host is a Deno edge
// function that cannot be imported in node, so its boundary is locked in
// source. The two hazards are fail-closed on every identity input (tenant,
// target, tab, goal, and document generation must all match) and never
// widening authority (the OAuth allowlist stays closed and the storage RPCs
// stay service-role only). Both are claims about what the handler checks before
// it executes anything, which is exactly what source text can show. Runtime
// behavior for the same host is exercised by the live suites.

test('7E Edge host authenticates OAuth users, invokes 7D, and reuses opera_enqueue request IDs', () => {
  assert.match(edgeSource, /auth\.getUser/);
  assert.match(edgeSource, /validateReactiveProgram7D/);
  assert.match(edgeSource, /createReactiveVm7D/);
  assert.match(edgeSource, /advanceReactiveVm7D/);
  assert.match(edgeSource, /opera_vm_claim/);
  assert.match(edgeSource, /opera_vm_checkpoint/);
  assert.match(edgeSource, /opera_vm_effect_reserve/);
  assert.match(edgeSource, /opera_enqueue/);
  assert.match(edgeSource, /p_request_id:\s*idempotencyKey/);
  assert.doesNotMatch(edgeSource, /opera-agent-vm[^\n]*fetch\(/i);
});

test('7E Edge host fails closed on tenant, target, tab, goal, and document generations', () => {
  assert.match(edgeSource, /candidate\.tenantId\s*!==\s*tenantId/);
  assert.match(edgeSource, /HostError\("CROSS_TENANT"/);
  assert.match(edgeSource, /HostError\("GOAL_REVISED"/);
  assert.match(edgeSource, /HostError\("STALE_TARGET"/);
  assert.match(edgeSource, /HostError\("CROSS_TAB"/);
  assert.match(edgeSource, /extractDocumentGeneration\(awaited\.result\)/);
  assert.match(edgeSource, /observedGeneration\s*!==\s*program\.target\.documentGeneration/);
  assert.match(edgeSource, /errorCode:\s*"STALE_DOCUMENT"/);
  assert.match(edgeSource, /\["GOAL_REVISED",\s*"STALE_TARGET",\s*"STALE_DOCUMENT",\s*"MISSING_AUTHORITY",\s*"CROSS_TAB"\]/);
});

test('7E authority remains OAuth-allowlisted and storage RPCs remain service-role only', () => {
  assert.match(edgeSource, /auth\.getUser\(token\)/);
  assert.match(edgeSource, /ALLOWED_USER_IDS\.size\s*===\s*0\s*&&\s*ALLOWED_USER_EMAILS\.size\s*===\s*0/);
  assert.match(edgeSource, /if \(!user\) return response\(\{ ok: false, error: \{ code: "UNAUTHORIZED" \} \}, 401\)/);
  assert.match(edgeSource, /p_tenant_id:\s*user\.id/);
  assert.match(hostMigration, /revoke all on function public\.opera_vm_get\(uuid,uuid\) from public, anon, authenticated/i);
  assert.match(hostMigration, /grant execute on function public\.opera_vm_get\(uuid,uuid\) to service_role/i);
  assert.match(hostMigration, /revoke all on schema opera_agent_private from public, anon, authenticated/i);
  assert.match(hostMigration, /grant usage on schema opera_agent_private to service_role/i);
});
