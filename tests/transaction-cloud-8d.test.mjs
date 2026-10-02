import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCloudAcceptanceController8D } from './helpers/transaction-cloud-controller-8d.mjs';
import { createCloudFixtureData8D } from './helpers/transaction-cloud-fixture-8d.mjs';
import {
  createManagementOperatorBackend8D,
  EXPECTED_TRANSACTION_BUNDLE_SHA_8D,
  TRANSACTION_FUNCTION_8D
} from './helpers/transaction-cloud-management-backend-8d.mjs';
import {
  CALLBACK_8D,
  PROJECT_REF_8D,
  createFileOwnershipStore8D,
  createInternalOperatorTransport8D
} from './helpers/transaction-cloud-operator-8d.mjs';
import { ISSUER, CLIENT_ID } from './helpers/transaction-oauth-8d.mjs';
import { transactionFixture } from './helpers/transaction-dark-fixture.mjs';
import {
  LEASE_TTL_MS_8D,
  parseAcceptanceArgs8D,
  runAcceptanceCli8D,
  SDK_SPECIFIER_8D,
  STATE_DIRECTORY_8D
} from './cloud/transaction-cloud-acceptance-8d.mjs';
import { validateLedger, digestCanonical } from '../lib/goal-ledger.js';
import { validatePreparedTransaction } from '../lib/transaction-prepare.js';
import { validateTransactionProvenance } from '../lib/transaction-authority.js';
import { sealLedgerToken, openLedgerToken } from '../lib/ledger-token.js';

// 8D cloud acceptance surface, consolidated 2026-10-03.
//
// Seven files each drove one part of the same in-process acceptance pipeline:
// fixture data, the internal operator transport over a file ownership store,
// the server fence under concurrency, the management backend, the acceptance
// controller, the live CLI runner, and the static fence migration. They shared
// the same five helpers, the same synthetic tenant UUID, the same user and
// session ids, and the same OAuth client id, each redeclared locally.
//
//   tests/transaction-cloud-fixture-8d.test.mjs             5 tests
//   tests/transaction-cloud-operator-8d.test.mjs            16 tests
//   tests/transaction-cloud-ownership-fence-8d.test.mjs      2 tests
//   tests/transaction-cloud-management-backend-8d.test.mjs 13 tests
//   tests/transaction-cloud-controller-8d.test.mjs          11 tests
//   tests/transaction-cloud-live-runner-8d.test.mjs          3 tests
//   tests/transaction-cloud-server-fence-static-8d.test.mjs  3 tests
//   -> tests/transaction-cloud-8d.test.mjs                  53 tests
//
// Sections run in pipeline order: A fixture, B operator transport, C server
// fence under concurrency, D management backend, E controller, F live runner,
// G static fence migration.
//
// Test count and assertion count are the invariants: 53 tests and 258
// assertions before, 53 and 258 after, none weakened, dropped or added. Test
// bodies are otherwise byte-identical; two things changed mechanically, both
// forced by the merge:
//
//   - Five module-scope names collided, so one side of each pair was renamed:
//     the fixture's `options` -> `fixtureOptions`, the management backend's
//     `fixture()` -> `cloudFixture()`, the operator's `fixture` object ->
//     `fixtureInput`, the operator's `ownInstallSeal` -> `ownAndInstallSeal`,
//     and the fence file's `tempStore` -> `fencedTempStore`.
//   - `namespace`, `userId`, `sessionId` and `identity` were declared with
//     byte-identical values in two or three files each. They are declared once
//     now. `namespaceA` is defined as `namespace` because it was the same
//     literal.
//
// `cleanup` (operator) and `cleanupA` (fence) stay separate on purpose: the
// actor, goal and transaction ids differ by one letter, and each file's mock
// asserts against its own constant.

const namespace = '12345678-1234-4234-8234-123456789abc';
const userId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sessionId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const identity = { iss: 'https://example.invalid/auth/v1', aud: 'authenticated', role: 'authenticated', sub: userId, client_id: CLIENT_ID, session_id: sessionId, iat: 1, exp: 2 };

// --- A. the synthetic cloud fixture ----------------------------------------

const fixtureOptions = { namespace, userId, preparedAt: '2026-09-14T00:00:00.000Z' };
test('8D cloud fixture binds UUID tenant and complete production goal-head metadata', async () => {
  const f = await createCloudFixtureData8D(fixtureOptions);
  const ledger = await validateLedger(f.ledger, { now: '2026-09-14T00:01:00.000Z' });
  await validatePreparedTransaction(f.request.prepared);
  assert.equal(f.principal.tenant_id, fixtureOptions.namespace);
  assert.equal(f.principal.user_id, fixtureOptions.userId);
  assert.deepEqual(f.goalHead, { tenant_id: fixtureOptions.namespace, goal_id: ledger.goalId, head_revision: ledger.revision, head_digest: ledger.ledgerDigest, status: ledger.status, created_at: ledger.createdAt, updated_at: ledger.createdAt, expires_at: ledger.expiresAt });
  assert.equal(f.binding.goal_id, ledger.goalId);
  assert.equal(f.binding.metadata.ledgerDigest, ledger.ledgerDigest);
  assert.equal(f.binding.metadata.preparedDigest, f.request.prepared.prepareDigest);
  assert.equal(f.binding.metadata.mode, 'DARK');
});
test('8D cloud fixture uses inert synthetic target with matching provenance and grant', async () => {
  const f = await createCloudFixtureData8D(fixtureOptions), tx = f.request.prepared;
  assert.match(tx.target.deviceId, /^m8d_fixture_/);
  assert.equal(tx.target.tabId, 0);
  assert.equal(tx.target.targetDigest, await digestCanonical({ deviceId: tx.target.deviceId, tabId: 0, documentGeneration: tx.target.documentGeneration }));
  assert.equal(tx.provenance[1].deviceId, tx.target.deviceId);
  assert.equal(tx.provenance[1].tabId, 0);
  assert.equal(tx.provenance[1].documentGeneration, tx.target.documentGeneration);
  assert.equal(f.binding.metadata.grant.scopeId, '0');
  assert.equal(f.binding.metadata.grant.targetDigest, tx.target.targetDigest);
  assert.equal(f.browserDispatchAllowed, false);
  assert.equal(tx.provenance[1].observedAt, fixtureOptions.preparedAt);
  await validateTransactionProvenance(tx, { evaluatedAt: fixtureOptions.preparedAt });
});
test('8D cloud fixture is deterministic, immutable and cleanup ownership is exact', async () => {
  const a = await createCloudFixtureData8D(fixtureOptions), b = await createCloudFixtureData8D(fixtureOptions);
  assert.deepEqual(a, b);
  assert.throws(() => { a.request.prepared.target.tabId = 42; }, TypeError);
  const other = await createCloudFixtureData8D({ ...fixtureOptions, namespace: '22345678-1234-4234-8234-123456789abc' });
  assert.notEqual(a.request.prepared.prepareDigest, other.request.prepared.prepareDigest);
  assert.notEqual(a.goalHead.goal_id, other.goalHead.goal_id);
  assert.notEqual(a.request.prepared.target.deviceId, other.request.prepared.target.deviceId);
  assert.deepEqual(a.cleanup, { tenantId: fixtureOptions.namespace, actorId: a.principal.actor_id, goalId: a.goalHead.goal_id, transactionId: a.request.prepared.transactionId });
});
test('8D cloud fixture rejects missing/unknown credentials and invalid scope inputs', async () => {
  for (const input of [null, {}, { ...fixtureOptions, namespace: 'tenant_alpha' }, { ...fixtureOptions, userId: 'user_alpha' }, { ...fixtureOptions, preparedAt: 'tomorrow' }, { ...fixtureOptions, accessToken: 'do-not-accept' }, { ...fixtureOptions, target: { deviceId: 'opera', tabId: 42 } }]) {
    await assert.rejects(createCloudFixtureData8D(input), { message: 'INVALID_CLOUD_FIXTURE_CONFIGURATION' });
  }
});
test('8D cloud fixture ledger seals locally and leaves existing native fixture unchanged', async () => {
  const before = await transactionFixture(), f = await createCloudFixtureData8D(fixtureOptions), key = new Uint8Array(32).fill(11);
  const token = await sealLedgerToken(f.ledger, key, { requestId: 'synthetic_cloud_fixture', issuedAt: '2026-09-14T00:01:00.000Z' });
  assert.deepEqual((await openLedgerToken(token, key, { now: '2026-09-14T00:01:00.000Z' })).ledger, f.ledger);
  assert.deepEqual((await transactionFixture()).request, before.request);
});

// --- B. the internal operator transport and the file ownership store --------

const cleanup = { tenantId: namespace, actorId: 'm8d_fixture_actor_x', goalId: 'm8d_fixture_goal_x', transactionId: 'm8d_fixture_tx_x' };
const fixtureInput = { cleanup };
function backend(options = {}) {
  const state = { installed: false, host: false, mode: 'OFF', calls: [], fenceEpoch: 0, fence: null };
  const assertFence = input => { if (!input || !state.fence || input.epoch !== state.fence.epoch || input.ownerId !== state.fence.ownerId || input.namespace !== state.fence.namespace) throw new Error('8D_SERVER_FENCE_LOST'); };
  const b = {
    async describe() { state.calls.push('describe'); return { projectRef: options.projectRef ?? PROJECT_REF_8D, clientId: CLIENT_ID, callback: CALLBACK_8D }; },
    async preflight() { state.calls.push('preflight'); return { hostFlag: false, mode: 'OFF', ledgerEnabled: true, agentCommitEnabled: false, legacyGated: false, namespaceEmpty: true, locksVerified: true }; },
    async acquireFence(input) { state.fenceEpoch += 1; state.fence = { ownerId: input.ownerId, namespace: input.namespace, epoch: state.fenceEpoch }; return { epoch: state.fenceEpoch }; },
    async heartbeatFence(input) { assertFence(input); return { epoch: input.epoch }; },
    async releaseFence(input) { assertFence(input); if (state.host || state.mode !== 'OFF') throw new Error('8D_SERVER_FENCE_NOT_CLEAN'); state.fence = null; return { released: true }; },
    async verifySession(input) { state.calls.push('verifySession'); if (options.verifySession) return options.verifySession(input); return { exists: true, userId: input.userId, clientId: input.clientId, sessionId: input.sessionId }; },
    async insertFixture() { state.calls.push('insertFixture'); if (state.installed) throw new Error('duplicate'); state.installed = true; if (options.lostReply) throw new Error('lost reply'); return { inserted: true }; },
    async sealLedger() { state.calls.push('sealLedger'); return 'oal1.synthetic.cipher'; },
    async enableHost() { state.calls.push('enableHost'); state.host = true; },
    async setDark() { state.calls.push('setDark'); state.mode = 'DARK'; },
    async verifyCancelled() { state.calls.push('verifyCancelled'); return { status: 'CANCELLED', payloadRows: 0 }; },
    async disableHost() { state.calls.push('disableHost'); if (options.failDisable) throw new Error('disable failed'); state.host = false; },
    async setOff() { state.calls.push('setOff'); if (options.failSetOff) throw new Error('off failed'); state.mode = 'OFF'; },
    async cleanupFixture(input) { state.calls.push('cleanupFixture'); assert.deepEqual(input, cleanup); if (options.failCleanup) throw new Error('cleanup failed'); state.installed = false; },
    async verifyClean() { state.calls.push('verifyClean'); if (options.failVerify) throw new Error('verify failed'); return { hostFlag: state.host, mode: state.mode, ownedRows: state.installed ? 1 : 0, payloadRows: 0, agentCommitEnabled: false, legacyGated: false }; },
  }; return { backend: b, state };
}
async function tempStore() { const dir = await mkdtemp(join(tmpdir(), 'oa-8d-')); return { dir, store: createFileOwnershipStore8D({ directory: dir, isProcessAlive: pid => pid === process.pid }) }; }

test('8D unfinished lock initialization is BUSY, never permission to delete a peer lock', async () => {
  const { dir, store } = await tempStore();
  try {
    await mkdir(join(dir, 'global-control.lock'));
    await assert.rejects(store.acquire(namespace, 'contender_owner_01', 1000, 10000), /8D_GLOBAL_CONTROL_BUSY/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D parallel acquisition and expired reclaim have exactly one winner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oa-8d-parallel-'));
  try {
    for (let i = 0; i < 40; i++) {
      const store = createFileOwnershipStore8D({ directory: join(root, String(i)), isProcessAlive: pid => pid === process.pid });
      if (i % 2) await store.acquire(namespace, 'dead_original_01', 0, 1000, 987654);
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, j) => store.acquire(namespace, 'contender_owner_' + j, 2000, 10000)));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, 'exactly one owner for trial ' + i);
      for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.message, '8D_GLOBAL_CONTROL_BUSY');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function ownAndInstall(transport) {
  await transport.operator.preflight(namespace, new AbortController().signal);
  await transport.operator.recordOwnership(cleanup, new AbortController().signal);
  return transport.operator.installFixture({ fixture: fixtureInput, identity }, new AbortController().signal);
}
async function ownAndInstallSeal(transport) {
  await ownAndInstall(transport);
  return transport.operator.sealLedger({ tenantId: namespace, goalId: cleanup.goalId }, new AbortController().signal);
}

test('8D internal operator is pinned to exact project/client/callback before mutation', async () => {
  const { dir, store } = await tempStore(); try {
    const wrong = backend({ projectRef: 'other' }); const t = createInternalOperatorTransport8D({ backend: wrong.backend, store, ownerId: 'writer_owner_01' });
    assert.deepEqual(Object.keys(t.operator).sort(), ['cleanupFixture', 'disableHost', 'enableHost', 'installFixture', 'preflight', 'recordOwnership', 'sealLedger', 'setDark', 'setOff', 'verifyCancelled', 'verifyClean'].sort());
    await assert.rejects(t.operator.preflight(namespace, new AbortController().signal), /8D_OPERATOR_TARGET_MISMATCH/);
    assert.deepEqual(wrong.state.calls, ['describe']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D ownership is durable, exclusive and manifest contains only nonsecret cleanup state', async () => {
  const { dir, store } = await tempStore(); let now = 1000; try {
    const a = backend(), b = backend(); const first = createInternalOperatorTransport8D({ backend: a.backend, store, ownerId: 'writer_owner_01', now: () => now, leaseTtlMs: 10000 });
    await first.operator.preflight(namespace, new AbortController().signal); await first.operator.recordOwnership(cleanup, new AbortController().signal);
    const raw = await readFile(join(dir, `manifest-${namespace}.json`), 'utf8');
    assert.equal(raw.includes('Bearer'), false); assert.equal(raw.includes(userId), false); assert.equal(raw.includes(sessionId), false); assert.equal(raw.includes(CLIENT_ID), false);
    await assert.rejects(store.acquire(namespace, 'writer_owner_02', now, 10000), /8D_GLOBAL_CONTROL_BUSY/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D verifies existing session before insert-only fixture provisioning', async () => {
  const { dir, store } = await tempStore(); try {
    const ok = backend(); const t = createInternalOperatorTransport8D({ backend: ok.backend, store, ownerId: 'writer_owner_01' });
    assert.deepEqual(await ownAndInstall(t), { sessionBound: true }); assert.deepEqual(ok.state.calls.slice(-2), ['verifySession', 'insertFixture']);
    const bad = backend({ verifySession: input => ({ exists: false, userId: input.userId, clientId: input.clientId, sessionId: input.sessionId }) });
    const otherDir = await mkdtemp(join(tmpdir(), 'oa-8d-')); try { const u = createInternalOperatorTransport8D({ backend: bad.backend, store: createFileOwnershipStore8D({ directory: otherDir }), ownerId: 'writer_owner_02' }); await u.operator.preflight(namespace); await u.operator.recordOwnership(cleanup); await assert.rejects(u.operator.installFixture({ fixture: fixtureInput, identity }), /8D_SESSION_BINDING_FAILED/); assert.equal(bad.state.calls.includes('insertFixture'), false); } finally { await rm(otherDir, { recursive: true, force: true }); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D aborted session check quiesces before provisioning and cannot become a late insert', async () => {
  const { dir, store } = await tempStore(); let release; const gate = new Promise(r => release = r); try {
    const b = backend({ verifySession: async input => { await gate; return { exists: true, userId: input.userId, clientId: input.clientId, sessionId: input.sessionId }; } });
    const t = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'writer_owner_01' }); await t.operator.preflight(namespace); await t.operator.recordOwnership(cleanup);
    const abort = new AbortController(); const pending = t.operator.installFixture({ fixture: fixtureInput, identity }, abort.signal); abort.abort(); release();
    await assert.rejects(pending, /8D_OPERATOR_ABORTED/); assert.equal(b.state.calls.includes('insertFixture'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D pending crash manifest blocks a new preflight until explicit recovery', async () => {
  const { dir, store } = await tempStore(); let now = 1000; try {
    const b = backend(); const parent = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'dead_parent_01', now: () => now, leaseTtlMs: 10000, processId: 987654 });
    await parent.operator.preflight(namespace); await parent.operator.recordOwnership(cleanup);
    const next = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'writer_owner_02', now: () => now, leaseTtlMs: 10000 });
    await assert.rejects(next.operator.preflight(namespace), /8D_RECOVERY_REQUIRED/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D stale-parent recovery reclaims expired global control and restores OFF/exact cleanup', async () => {
  const { dir, store } = await tempStore(); let now = 1000; try {
    const b = backend(); const parent = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'dead_parent_01', now: () => now, leaseTtlMs: 10000, processId: 987654 });
    await ownAndInstallSeal(parent); await parent.operator.enableHost(); await parent.operator.setDark(); assert.equal(b.state.installed, true); assert.equal(b.state.mode, 'DARK');
    now = 12000;
    const recovery = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'recovery_owner_01', now: () => now, leaseTtlMs: 10000 });
    assert.deepEqual(await recovery.recover(namespace, new AbortController().signal), { recovered: true });
    assert.equal(b.state.installed, false); assert.equal(b.state.host, false); assert.equal(b.state.mode, 'OFF'); assert.equal(await store.readManifest(namespace), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D durable manifest survives real child-process death and is recoverable after lease expiry', async () => {
  const { dir, store } = await tempStore(); try {
    const moduleUrl = new URL('./helpers/transaction-cloud-operator-8d.mjs', import.meta.url).href;
    const script = `import {createFileOwnershipStore8D} from ${JSON.stringify(moduleUrl)};\nconst s=createFileOwnershipStore8D({directory:${JSON.stringify(dir)}});\nconst cleanup=${JSON.stringify(cleanup)};\nawait s.acquire(${JSON.stringify(namespace)},'dead_child_01',1000,10000);\nawait s.writeManifest({version:1,ownerId:'dead_child_01',namespace:${JSON.stringify(namespace)},phase:'DARK',dirty:true,cleanup,updatedAt:1000});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr); assert.ok(await store.readManifest(namespace));
    const b = backend(); b.state.installed = true; b.state.host = true; b.state.mode = 'DARK';
    const recovery = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'recovery_owner_01', now: () => 12000, leaseTtlMs: 10000 });
    assert.deepEqual(await recovery.recover(namespace), { recovered: true }); assert.equal(b.state.installed, false); assert.equal(b.state.mode, 'OFF'); assert.equal(await store.readManifest(namespace), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D lost insert reply leaves durable ownership and later recovery removes partial install', async () => {
  const { dir, store } = await tempStore(); let now = 1000; try {
    const b = backend({ lostReply: true }); const parent = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'dead_parent_01', now: () => now, leaseTtlMs: 10000, processId: 987654 });
    await parent.operator.preflight(namespace); await parent.operator.recordOwnership(cleanup); await assert.rejects(parent.operator.installFixture({ fixture: fixtureInput, identity }), /lost reply/); assert.equal(b.state.installed, true); assert.ok(await store.readManifest(namespace));
    now = 12000; const recovery = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'recovery_owner_01', now: () => now, leaseTtlMs: 10000 }); await recovery.recover(namespace); assert.equal(b.state.installed, false); assert.equal(await store.readManifest(namespace), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D exact cleanup scope cannot be widened by recovery or caller input', async () => {
  const { dir, store } = await tempStore(); try {
    const b = backend(); const t = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'writer_owner_01' }); await ownAndInstall(t);
    await assert.rejects(t.operator.cleanupFixture({ ...cleanup, transactionId: 'other' }), /8D_CLEANUP_SCOPE_MISMATCH/);
    assert.equal(b.state.installed, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D phase machine forbids host mutation without durable ownership or before sealing', async () => {
  const { dir, store } = await tempStore(); try {
    const b = backend(); const t = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'writer_owner_01' });
    await assert.rejects(t.operator.disableHost(), /8D_CONTROL_OWNERSHIP_REQUIRED/); assert.equal(b.state.calls.includes('disableHost'), false);
    await t.operator.preflight(namespace); await t.operator.recordOwnership(cleanup); await t.operator.installFixture({ fixture: fixtureInput, identity });
    await assert.rejects(t.operator.enableHost(), /8D_OPERATOR_PHASE_MISMATCH/); assert.equal(b.state.calls.includes('enableHost'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D install and observation scope must match the exact durable ownership manifest', async () => {
  const { dir, store } = await tempStore(); try {
    const b = backend(); const t = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'writer_owner_01' }); await t.operator.preflight(namespace); await t.operator.recordOwnership(cleanup);
    const other = { ...cleanup, transactionId: 'm8d_fixture_tx_other' };
    await assert.rejects(t.operator.installFixture({ fixture: { cleanup: other }, identity }), /8D_CLEANUP_SCOPE_MISMATCH/); assert.equal(b.state.calls.includes('insertFixture'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D failed recovery keeps durable dirty evidence and does not delete rows while host disable fails', async () => {
  const { dir, store } = await tempStore(); let now = 1000; try {
    const seedBackend = backend(); const parent = createInternalOperatorTransport8D({ backend: seedBackend.backend, store, ownerId: 'dead_parent_01', now: () => now, leaseTtlMs: 10000, processId: 987654 });
    await ownAndInstallSeal(parent); await parent.operator.enableHost(); await parent.operator.setDark();
    const manifestBefore = await store.readManifest(namespace); assert.ok(manifestBefore);
    now = 12000; const broken = backend({ failDisable: true }); broken.state.installed = true; broken.state.host = true; broken.state.mode = 'DARK';
    const recovery = createInternalOperatorTransport8D({ backend: broken.backend, store, ownerId: 'recovery_owner_01', now: () => now, leaseTtlMs: 10000 });
    await assert.rejects(recovery.recover(namespace), /8D_RECOVERY_FAILED/);
    assert.equal(broken.state.calls.includes('setOff'), true); assert.equal(broken.state.calls.includes('cleanupFixture'), false);
    const manifestAfter = await store.readManifest(namespace); assert.equal(manifestAfter?.phase, 'CLEANING'); assert.equal(manifestAfter?.ownerId, 'recovery_owner_01');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D expired lease is not reclaimed while the recorded local owner process is still alive', async () => {
  const { dir, store } = await tempStore(); try {
    await store.acquire(namespace, 'writer_owner_01', 1000, 10000, process.pid);
    await assert.rejects(store.acquire(namespace, 'recovery_owner_01', 12000, 10000, process.pid), /8D_GLOBAL_CONTROL_BUSY/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D ownership rechecks durable manifest after lease acquisition and cannot overwrite a crashed peer', async () => {
  const { dir, store } = await tempStore(); let now = 1000; try {
    const b = backend(); const candidate = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'writer_owner_01', now: () => now, leaseTtlMs: 10000 });
    await candidate.operator.preflight(namespace);
    await store.acquire(namespace, 'dead_peer_01', 1000, 10000, 987654);
    await store.writeManifest({ version: 1, ownerId: 'dead_peer_01', namespace, phase: 'DARK', dirty: true, cleanup, updatedAt: 1000 });
    now = 12000;
    await assert.rejects(candidate.operator.recordOwnership(cleanup), /8D_RECOVERY_REQUIRED/);
    const manifest = await store.readManifest(namespace); assert.equal(manifest?.ownerId, 'dead_peer_01'); assert.equal(manifest?.phase, 'DARK');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// --- C. the server fence under concurrency ----------------------------------
//
// Same transport as section B, but the backend holds a real server-side fence
// and one host mutation is deliberately left in flight across a recovery.

const namespaceA = namespace;
const namespaceB = '22345678-1234-4234-8234-123456789abc';
const cleanupA = { tenantId: namespaceA, actorId: 'm8d_fixture_actor_a', goalId: 'm8d_fixture_goal_a', transactionId: 'm8d_fixture_tx_a' };
const fixtureA = { cleanup: cleanupA };

function createFencedBackend({ delayEnable = false } = {}) {
  const state = { installed: false, host: false, mode: 'OFF', calls: [], epoch: 0, fence: null };
  let releaseEnable, markEnableStarted;
  const enableGate = delayEnable ? new Promise(resolve => { releaseEnable = resolve; }) : Promise.resolve();
  const enableStarted = delayEnable ? new Promise(resolve => { markEnableStarted = resolve; }) : Promise.resolve();
  const isFence = value => value && typeof value === 'object' && Number.isSafeInteger(value.epoch) && typeof value.ownerId === 'string' && typeof value.namespace === 'string';
  const assertFence = value => {
    if (!isFence(value) || !state.fence || value.epoch !== state.fence.epoch || value.ownerId !== state.fence.ownerId || value.namespace !== state.fence.namespace) throw new Error('8D_SERVER_FENCE_LOST');
  };
  const optionalFence = value => { if (isFence(value)) assertFence(value); };
  const backend = {
    async describe() { state.calls.push('describe'); return { projectRef: PROJECT_REF_8D, clientId: CLIENT_ID, callback: CALLBACK_8D }; },
    async preflight() { state.calls.push('preflight'); return { hostFlag: false, mode: 'OFF', ledgerEnabled: true, agentCommitEnabled: false, legacyGated: false, namespaceEmpty: true, locksVerified: true }; },
    async acquireFence(input) { state.calls.push('acquireFence'); state.epoch += 1; state.fence = { ownerId: input.ownerId, namespace: input.namespace, epoch: state.epoch }; state.host = false; return { epoch: state.epoch }; },
    async heartbeatFence(input) { state.calls.push('heartbeatFence'); assertFence(input); return { epoch: input.epoch }; },
    async releaseFence(input) { state.calls.push('releaseFence'); assertFence(input); if (state.host || state.mode !== 'OFF') throw new Error('8D_SERVER_FENCE_NOT_CLEAN'); state.fence = null; return { released: true }; },
    async verifySession(input) { state.calls.push('verifySession'); return { exists: true, userId: input.userId, clientId: input.clientId, sessionId: input.sessionId }; },
    async insertFixture(_fixture, maybeFence) { state.calls.push('insertFixture'); optionalFence(maybeFence); state.installed = true; return { inserted: true }; },
    async sealLedger() { state.calls.push('sealLedger'); return 'oal1.synthetic.cipher'; },
    async enableHost(maybeFence) { state.calls.push('enableHost:start'); markEnableStarted?.(); await enableGate; optionalFence(maybeFence); state.host = true; state.calls.push('enableHost:commit'); return { hostFlag: true }; },
    async setDark(maybeFence) { state.calls.push('setDark'); optionalFence(maybeFence); state.mode = 'DARK'; return { mode: 'DARK' }; },
    async verifyCancelled() { state.calls.push('verifyCancelled'); return { status: 'CANCELLED', payloadRows: 0 }; },
    async disableHost(maybeFence) { state.calls.push('disableHost'); optionalFence(maybeFence); state.host = false; return { hostFlag: false }; },
    async setOff(maybeFence) { state.calls.push('setOff'); optionalFence(maybeFence); state.mode = 'OFF'; return { mode: 'OFF' }; },
    async cleanupFixture(_input, maybeFence) { state.calls.push('cleanupFixture'); optionalFence(maybeFence); state.installed = false; return { cleaned: true }; },
    async verifyClean(_input, maybeFence) { state.calls.push('verifyClean'); optionalFence(maybeFence); return { hostFlag: state.host, mode: state.mode, ownedRows: state.installed ? 1 : 0, payloadRows: 0, agentCommitEnabled: false, legacyGated: false }; },
  };
  return { backend, state, enableStarted, releaseEnable: () => releaseEnable?.() };
}

async function fencedTempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'oa-8d-fence-'));
  return { dir, store: createFileOwnershipStore8D({ directory: dir, isProcessAlive: pid => pid === process.pid }) };
}

async function ownInstallSeal(transport) {
  await transport.operator.preflight(namespaceA);
  await transport.operator.recordOwnership(cleanupA);
  await transport.operator.installFixture({ fixture: fixtureA, identity });
  await transport.operator.sealLedger({ tenantId: namespaceA, goalId: cleanupA.goalId });
}

test('8D fresh namespace is blocked by any globally pending dirty manifest', async () => {
  const { dir, store } = await fencedTempStore(); let now = 1000;
  try {
    await store.acquire(namespaceA, 'dead_owner_01', now, 10000, 987654);
    await store.writeManifest({ version: 1, ownerId: 'dead_owner_01', namespace: namespaceA, phase: 'DARK', dirty: true, cleanup: cleanupA, updatedAt: now });
    now = 12000;
    const b = createFencedBackend();
    const next = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'writer_owner_02', now: () => now, leaseTtlMs: 10000 });
    await assert.rejects(next.operator.preflight(namespaceB), /8D_RECOVERY_REQUIRED/);
    assert.equal(b.state.calls.includes('preflight'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('8D recovery server fence rejects a delayed pre-recovery host mutation after clean verification', async () => {
  const { dir, store } = await fencedTempStore(); let now = 1000;
  try {
    const b = createFencedBackend({ delayEnable: true });
    const parent = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'dead_parent_01', now: () => now, leaseTtlMs: 10000, processId: 987654 });
    await ownInstallSeal(parent);
    const delayed = parent.operator.enableHost();
    await b.enableStarted;
    assert.equal(b.state.calls.includes('enableHost:start'), true);

    now = 12000;
    const recovery = createInternalOperatorTransport8D({ backend: b.backend, store, ownerId: 'recovery_owner_01', now: () => now, leaseTtlMs: 10000 });
    assert.deepEqual(await recovery.recover(namespaceA), { recovered: true });
    assert.equal(await store.readManifest(namespaceA), null);
    assert.equal(b.state.host, false);
    assert.equal(b.state.mode, 'OFF');

    b.releaseEnable();
    await assert.rejects(delayed, /8D_SERVER_FENCE_LOST|8D_CONTROL_OWNERSHIP_LOST|ENOENT/);
    assert.equal(b.state.host, false);
    assert.equal(b.state.calls.includes('enableHost:commit'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- D. the management backend ----------------------------------------------

const preparedAt = '2026-09-14T00:00:00.000Z';
const accessToken = 'sbp_' + ('a'.repeat(40));
const transactionSecret = Buffer.alloc(32, 9).toString('base64url');
const unrelatedSecret = 'unrelated-secret-never-retain';
const ledgerKey = Buffer.alloc(32, 7).toString('base64url');
const ownerId = 'writer_owner_01';
const digest = value => createHash('sha256').update(value).digest('hex');
const publicAnon = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.public_fixture_signature';

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function harness(options = {}) {
  const state = { master: options.master ?? 'true', mode: options.mode ?? 'OFF', rows: options.rows ?? 0, goalRows: options.goalRows ?? 0, calls: [], db: [], secretWrites: [], epoch: 0, serverOwner: null, serverNamespace: null, serverHost: false };
  const transactionKey = options.transactionSecret ?? transactionSecret;
  const assertFence = parameters => { if (parameters[0] !== state.serverOwner || parameters[1] !== state.serverNamespace || Number(parameters[2]) !== state.epoch) throw new Error('stale fence'); };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url); state.calls.push({ url, method: init.method ?? 'GET' });
    if (parsed.origin === `https://${PROJECT_REF_8D}.supabase.co`) {
      assert.equal(parsed.pathname, `/functions/v1/${TRANSACTION_FUNCTION_8D}`);
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, `Bearer ${publicAnon}`); assert.equal(init.headers.apikey, publicAnon);
      assert.equal(init.body, undefined); assert.ok(init.signal);
      return json(options.healthBody ?? { error: 'METHOD_NOT_ALLOWED', browserDispatchAllowed: false }, options.healthStatus ?? 405);
    }
    assert.equal(parsed.origin, 'https://api.supabase.com'); assert.ok(parsed.pathname.startsWith(`/v1/projects/${PROJECT_REF_8D}/`));
    assert.equal(init.headers?.Authorization, `Bearer ${accessToken}`); assert.equal(String(init.headers?.Authorization).includes(transactionSecret), false);
    if (options.failFetch) throw new Error(`network ${transactionKey} ${unrelatedSecret} ${accessToken}`);
    if (parsed.pathname.endsWith('/functions')) return json([{ slug: TRANSACTION_FUNCTION_8D, status: 'ACTIVE', verify_jwt: true, ezbr_sha256: options.bundle ?? EXPECTED_TRANSACTION_BUNDLE_SHA_8D, version: 7 }]);
    if (parsed.pathname.endsWith('/secrets') && (init.method ?? 'GET') === 'GET') return json([{ name: 'UNRELATED_SECRET', value: digest(unrelatedSecret) }, { name: 'OPERA_AGENT_TRANSACTION_DARK_8D', value: options.masterDigest ?? digest(state.master) }, { name: 'OPERA_AGENT_TRANSACTION_KEY_8D', value: options.keyDigest ?? digest(transactionKey) }]);
    if (parsed.pathname.endsWith('/api-keys')) return json(options.apiKeys ?? [{ name: 'anon', api_key: publicAnon }, { name: 'service_role', api_key: 'private_fixture_never_select' }]);
    if (parsed.pathname.endsWith('/secrets') && init.method === 'POST') { state.secretWrites.push(JSON.parse(init.body)); throw new Error('per-run secret writes forbidden'); }
    if (parsed.pathname.endsWith('/database/query') && init.method === 'POST') {
      const body = JSON.parse(init.body); state.db.push(body); const q = body.query, p = body.parameters ?? [];
      // Actual Management read_only selects a restricted database role, not
      // merely a read-only transaction under the internal operator identity.
      if (body.read_only === true || options.denyOperator) return json({ message: 'permission denied' }, 400);
      if (q.includes('as synthetic_rows')) return json([{ mode: state.mode, legacy_gated: false, agent_commit_enabled: false, ledger_enabled: true, server_owner_id: state.serverOwner, server_host_enabled: state.serverHost, synthetic_rows: state.rows, goal_rows: state.goalRows }]);
      if (q.includes('opera_tx_operator_acquire_8d')) { state.epoch += 1; state.serverOwner = p[0]; state.serverNamespace = p[1]; state.serverHost = false; return json([{ epoch: state.epoch }]); }
      if (q.includes('opera_tx_operator_heartbeat_8d')) { assertFence(p); return json([{ epoch: state.epoch }]); }
      if (q.includes('opera_tx_operator_release_8d')) { assertFence(p); if (state.serverHost || state.mode !== 'OFF') return json([], 400); state.serverOwner = null; state.serverNamespace = null; return json([{ released: true }]); }
      if (q.includes('from auth.sessions')) return json([{ matches: options.sessionMatches ?? 1 }]);
      if (q.includes('insert into opera_agent_tx_candidate.principals')) { assertFence([p[13], p[0], p[14]]); state.rows = Math.max(state.rows, 3); state.goalRows = Math.max(state.goalRows, 1); return json([{ principals: 1, goals: 1, bindings: 1 }]); }
      if (q === 'select public.opera_goal_crypto_key() as crypto') return json([{ crypto: { enabled: true, key: ledgerKey } }]);
      if (q.includes('opera_tx_operator_set_host_8d')) { assertFence(p); state.serverHost = p[3] === true; return json([{ host_enabled: state.serverHost }]); }
      if (q.includes("set mode='DARK'")) { assertFence(p); if (!state.serverHost) return json([]); state.mode = 'DARK'; return json([{ mode: 'DARK', legacy_gated: false, agent_commit_enabled: false }]); }
      if (q.includes("set mode='OFF'")) { assertFence(p); state.mode = 'OFF'; return json([{ mode: 'OFF', legacy_gated: false, agent_commit_enabled: false }]); }
      if (q.includes("coalesce(max(status),'')")) return json([{ status: 'CANCELLED', payload_rows: 0 }]);
      if (q.includes('opera_tx_operator_cleanup_fixture_8d')) { assertFence(p); if (state.serverHost || state.mode !== 'OFF') return json([], 400); state.rows = 0; state.goalRows = 0; return json([{ cleaned: true }]); }
      if (q.includes('as owned_rows')) { assertFence(p); return json([{ host_enabled: state.serverHost, mode: state.mode, legacy_gated: false, agent_commit_enabled: false, owned_rows: state.rows + state.goalRows, payload_rows: 0 }]); }
      throw new Error('unexpected fixed query');
    }
    throw new Error('unexpected route');
  };
  const backend = createManagementOperatorBackend8D({ credentialProvider: async () => accessToken, fetchImpl, now: () => Date.parse(preparedAt) + 1000 });
  return { backend, state };
}

async function cloudFixture() { return createCloudFixtureData8D({ namespace, userId, preparedAt }); }
async function acquire(backend) { const { epoch } = await backend.acquireFence({ ownerId, namespace, ttlMs: 180000 }); return { ownerId, namespace, epoch }; }

test('8D management backend exposes only fixed fenced methods and a pinned target', async () => {
  const { backend } = harness();
  assert.deepEqual(Object.keys(backend).sort(), ['acquireFence', 'cleanupFixture', 'describe', 'disableHost', 'enableHost', 'heartbeatFence', 'insertFixture', 'preflight', 'releaseFence', 'sealLedger', 'setDark', 'setOff', 'verifyCancelled', 'verifyClean', 'verifySession'].sort());
  assert.deepEqual(await backend.describe(), { projectRef: PROJECT_REF_8D, clientId: CLIENT_ID, callback: CALLBACK_8D });
});

test('8D recovery descriptor checks actual bundle integrity before control mutations', async () => {
  const { backend, state } = harness({ bundle: 'wrong' });
  await assert.rejects(backend.describe(), /8D_HOST_BUNDLE_MISMATCH/);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].url.endsWith('/functions'), true);
  assert.equal(state.db.length, 0);
});

test('8D management preflight requires fenced pin, real secret digests, idle OFF and initialized Edge', async () => {
  const { backend, state } = harness(); assert.equal(EXPECTED_TRANSACTION_BUNDLE_SHA_8D, '96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1');
  assert.deepEqual(await backend.preflight(namespace), { hostFlag: false, mode: 'OFF', ledgerEnabled: true, agentCommitEnabled: false, legacyGated: false, namespaceEmpty: true, locksVerified: true });
  const query = state.db.find(item => item.query.includes('as synthetic_rows')); assert.equal(query.read_only, false); assert.deepEqual(query.parameters, [namespace]);
  await assert.rejects(harness({ bundle: 'wrong' }).backend.preflight(namespace), /8D_HOST_BUNDLE_MISMATCH/);
  await assert.rejects(harness({ master: 'false' }).backend.preflight(namespace), /8D_HOST_MASTER_NOT_ENABLED/);
  await assert.rejects(harness({ keyDigest: 'not-a-digest' }).backend.preflight(namespace), /8D_SECRET_DIGEST_INVALID/);
  const occupied = harness(); occupied.state.serverOwner = 'other_owner_01'; await assert.rejects(occupied.backend.preflight(namespace), /8D_PREFLIGHT_STATE_INVALID/);
  assert.equal((await harness({ rows: 1 }).backend.preflight(namespace)).namespaceEmpty, false);
});

test('8D preflight never decodes secret digests and refuses invalid startup or spoofed health', async () => {
  for (const healthStatus of [200, 401, 500, 503]) await assert.rejects(harness({ healthStatus }).backend.preflight(namespace), /8D_HOST_CONFIGURATION_UNVERIFIED/);
  for (const healthBody of [{ error: 'METHOD_NOT_ALLOWED', browserDispatchAllowed: true }, { error: 'METHOD_NOT_ALLOWED', browserDispatchAllowed: false, extra: true }, { result: true }])
    await assert.rejects(harness({ healthBody }).backend.preflight(namespace), /8D_HOST_CONFIGURATION_UNVERIFIED/);
  await assert.rejects(harness({ masterDigest: 'true' }).backend.preflight(namespace), /8D_SECRET_DIGEST_INVALID/);
  await assert.rejects(harness({ apiKeys: [] }).backend.preflight(namespace), /8D_PUBLIC_ANON_KEY_UNAVAILABLE/);
  await assert.rejects(harness({ apiKeys: [{ name: 'anon', api_key: publicAnon }, { name: 'anon', api_key: publicAnon }] }).backend.preflight(namespace), /8D_PUBLIC_ANON_KEY_UNAVAILABLE/);
  await assert.rejects(harness({ apiKeys: [{ name: 'anon', api_key: 'not-a-jwt' }] }).backend.preflight(namespace), /8D_PUBLIC_ANON_KEY_UNAVAILABLE/);
  const { backend, state } = harness(); await backend.preflight(namespace);
  assert.equal(state.calls.filter(call => new URL(call.url).hostname === `${PROJECT_REF_8D}.supabase.co`).length, 1);
  assert.equal(state.calls.some(call => call.method === 'POST' && !call.url.endsWith('/database/query')), false);
  assert.equal(state.db.every(call => call.read_only === false), true);
  assert.equal(state.db.every(call => /^with control as/.test(call.query)), true);
});

test('8D private observational checks retain operator authority without granting client roles', async () => {
  const { backend, state } = harness(); await backend.preflight(namespace);
  await backend.verifySession({ userId, clientId: CLIENT_ID, sessionId });
  await backend.sealLedger((await cloudFixture()).ledger);
  assert.equal(state.db.every(call => call.read_only === false), true);
  assert.equal(state.db.some(call => /\bgrant\b|\balter\b|\bcreate\b/i.test(call.query)), false);
  await assert.rejects(harness({ denyOperator: true }).backend.preflight(namespace), /8D_MANAGEMENT_REQUEST_FAILED/);
});

test('8D management fence acquire/heartbeat/release is fixed, parameterized and epoch-bound', async () => {
  const { backend, state } = harness(); const fence = await acquire(backend); assert.deepEqual(fence, { ownerId, namespace, epoch: 1 });
  assert.deepEqual(await backend.heartbeatFence({ ...fence, ttlMs: 180000 }), { epoch: 1 });
  assert.deepEqual(await backend.releaseFence(fence), { released: true }); assert.equal(state.serverOwner, null); assert.equal(state.serverHost, false);
  const queries = state.db.filter(item => item.query.includes('opera_tx_operator_'));
  assert.deepEqual(queries[0].parameters, [ownerId, namespace, 180000]); assert.deepEqual(queries[1].parameters, [ownerId, namespace, 1, 180000]); assert.deepEqual(queries[2].parameters, [ownerId, namespace, 1]);
});

test('8D management session check is exact and parameterized before provisioning', async () => {
  const { backend, state } = harness(); const input = { userId, clientId: CLIENT_ID, sessionId }; assert.deepEqual(await backend.verifySession(input), { exists: true, ...input });
  const query = state.db.find(item => item.query.includes('from auth.sessions')); assert.equal(query.query.includes(userId), false); assert.deepEqual(query.parameters, [userId, CLIENT_ID, sessionId]); assert.equal(query.read_only, false);
  assert.equal((await harness({ sessionMatches: 0 }).backend.verifySession(input)).exists, false);
});

test('8D management provisioning is insert-only and carries exact server fence in the same SQL statement', async () => {
  const f = await cloudFixture(); const { backend, state } = harness(); const fence = await acquire(backend); assert.deepEqual(await backend.insertFixture(f, fence), { inserted: true });
  const query = state.db.find(item => item.query.includes('insert into opera_agent_tx_candidate.principals')); assert.ok(query); assert.ok(query.query.includes('opera_tx_operator_assert_8d')); assert.equal(query.query.includes('on conflict'), false); assert.equal(query.query.includes(namespace), false); assert.equal(query.query.includes(f.cleanup.actorId), false);
  assert.equal(query.parameters[0], namespace); assert.equal(query.parameters[11], f.cleanup.transactionId); assert.equal(query.parameters[13], ownerId); assert.equal(query.parameters[14], fence.epoch);
  await assert.rejects(backend.insertFixture({ ...f, cleanup: { ...f.cleanup, transactionId: 'other' } }, fence), /INVALID_8D_FIXTURE/);
});

test('8D management ledger sealing uses existing crypto only in memory and returns bounded ciphertext', async () => {
  const f = await cloudFixture(); const { backend, state } = harness(); const token = await backend.sealLedger(f.ledger);
  assert.match(token, /^oal1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); assert.equal(token.includes(ledgerKey), false); assert.equal(JSON.stringify(state.calls).includes(ledgerKey), false); assert.equal(JSON.stringify(state.db).includes(ledgerKey), false);
  const query = state.db.find(item => item.query === 'select public.opera_goal_crypto_key() as crypto'); assert.equal(query.read_only, false);
});

test('8D management host control is DB-fenced and never performs per-run project secret writes', async () => {
  const { backend, state } = harness(); const fence = await acquire(backend); assert.deepEqual(await backend.enableHost(fence), { hostFlag: true }); assert.equal(state.serverHost, true); assert.deepEqual(await backend.disableHost(fence), { hostFlag: false }); assert.equal(state.serverHost, false);
  assert.deepEqual(state.secretWrites, []); const hostQueries = state.db.filter(item => item.query.includes('opera_tx_operator_set_host_8d')); assert.deepEqual(hostQueries.map(item => item.parameters), [[ownerId, namespace, 1, true], [ownerId, namespace, 1, false]]);
});

test('8D management DARK/OFF mutations carry the fence and never grant agent commit', async () => {
  const f = await cloudFixture(); const { backend, state } = harness(); const fence = await acquire(backend); await backend.enableHost(fence); assert.deepEqual(await backend.setDark(fence), { mode: 'DARK' }); assert.equal(state.mode, 'DARK');
  assert.deepEqual(await backend.verifyCancelled(f.cleanup), { status: 'CANCELLED', payloadRows: 0 }); assert.deepEqual(await backend.setOff(fence), { mode: 'OFF' }); assert.equal(state.mode, 'OFF');
  for (const call of state.db.filter(item => item.query.includes('set mode='))) { assert.ok(call.query.includes('opera_tx_operator_assert_8d')); assert.equal(call.query.includes('agent_commit_enabled=true'), false); assert.deepEqual(call.parameters, [ownerId, namespace, 1]); }
});

test('8D management cleanup is one fenced server operation and clean verification is epoch-bound', async () => {
  const f = await cloudFixture(); const { backend, state } = harness({ rows: 1, goalRows: 1 }); const fence = await acquire(backend); await backend.cleanupFixture(f.cleanup, fence);
  const cleanupQuery = state.db.find(item => item.query.includes('opera_tx_operator_cleanup_fixture_8d')); assert.deepEqual(cleanupQuery.parameters, [ownerId, namespace, 1, f.cleanup.actorId, f.cleanup.goalId, f.cleanup.transactionId]);
  assert.deepEqual(await backend.verifyClean(f.cleanup, fence), { hostFlag: false, mode: 'OFF', ownedRows: 0, payloadRows: 0, agentCommitEnabled: false, legacyGated: false });
  const cleanQuery = state.db.find(item => item.query.includes('as owned_rows')); assert.ok(cleanQuery.query.includes('opera_tx_operator_assert_8d')); assert.deepEqual(cleanQuery.parameters, [ownerId, namespace, 1]);
  await assert.rejects(backend.cleanupFixture({ ...f.cleanup, transactionId: 'bad/slash' }, fence), /INVALID_8D_CLEANUP_SCOPE/);
});

test('8D management failures redact operator credentials and remote secret text', async () => {
  const { backend } = harness({ failFetch: true }); let error; try { await backend.preflight(namespace); } catch (e) { error = e; }
  assert.equal(error?.message, '8D_MANAGEMENT_REQUEST_FAILED'); assert.equal(error.message.includes(accessToken), false); assert.equal(error.message.includes(transactionSecret), false); assert.equal(error.message.includes(unrelatedSecret), false);
});

// --- E. the acceptance controller -------------------------------------------

const time = Date.parse('2026-09-14T00:00:00.000Z');
function fixture({ fail, badMetadata, badPreflight, badIdentity, responseBytes, badClean, expiredDuringUser, abortAfterInstall, badBinding } = {}) {
  const calls = []; let data; let committed = false; let requestCount = 0; let cancelled = false;
  let currentTime = time;
  const claims = { iss: ISSUER + '/auth/v1', aud: 'authenticated', role: 'authenticated', sub: userId, session_id: sessionId, client_id: CLIENT_ID, iat: time / 1000 - 1, exp: time / 1000 + 300 };
  const sdk = { auth: { getClaims: async () => ({ data: { claims: badIdentity ? { ...claims, client_id: 'wrong' } : claims } }), getUser: async () => {
    if (expiredDuringUser) { currentTime = time + 400000; claims.exp = currentTime / 1000 + 300; }
    return { data: { user: { id: userId } } };
  } } };
  const operator = Object.fromEntries(['preflight', 'recordOwnership', 'installFixture', 'sealLedger', 'enableHost', 'setDark', 'verifyCancelled', 'disableHost', 'setOff', 'cleanupFixture', 'verifyClean'].map(name => [name, async (input, signal) => {
    calls.push(name); assert.ok(signal instanceof AbortSignal);
    if (name === fail) throw new Error('private.operator.credential');
    if (name === 'preflight') return { hostFlag: false, mode: 'OFF', ledgerEnabled: true, agentCommitEnabled: false, legacyGated: false, namespaceEmpty: !badPreflight, locksVerified: true };
    if (name === 'recordOwnership') return { recorded: true };
    if (name === 'installFixture') { data = input.fixture; committed = true; abortAfterInstall?.abort(); return { sessionBound: !badBinding }; }
    if (name === 'sealLedger') return 'oal1.synthetic.cipher';
    if (name === 'verifyCancelled') return { status: 'CANCELLED', payloadRows: 0 };
    if (name === 'cleanupFixture') { committed = false; assert.equal(input.tenantId, namespace); }
    if (name === 'verifyClean') {
      const result = { hostFlag: false, mode: 'OFF', ownedRows: 0, payloadRows: 0, agentCommitEnabled: false, legacyGated: false };
      if (badClean) result[badClean] = badClean === 'mode' ? 'DARK' : badClean.endsWith('Rows') ? 1 : true;
      return result;
    }
  }]));
  const fetchImpl = async (url, init) => {
    assert.equal(url, ISSUER + '/functions/v1/opera-agent-transactions-8d');
    assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer synthetic.test.token');
    const body = JSON.parse(init.body); calls.push(body.operation); requestCount++;
    if (fail === 'request') throw new Error('private.oauth.token');
    if (responseBytes) return new Response('x'.repeat(responseBytes), { status: 200 });
    assert.equal(committed, true);
    const tx = data.request.prepared;
    const digestValue = await digestCanonical({ tenantId: namespace, transactionId: tx.transactionId, prepareDigest: tx.prepareDigest, targetDigest: tx.target.targetDigest });
    const replay = requestCount === 2 || body.operation === 'cancel' && cancelled;
    if (body.operation === 'cancel') cancelled = true;
    const result = { transactionId: tx.transactionId, status: cancelled ? 'CANCELLED' : 'PREPARED', leaseEpoch: cancelled ? 1 : 0, transition: cancelled ? 1 : 0, commitKey: 'tx1:' + digestValue.slice(7), replay, browserDispatchAllowed: false };
    if (badMetadata) result[badMetadata] = badMetadata === 'browserDispatchAllowed' ? true : 'private-value';
    return new Response(JSON.stringify({ result, browserDispatchAllowed: false }), { status: 200 });
  };
  const controller = createCloudAcceptanceController8D({ namespace, sdk, operator, publicKey: 'sb_publishable_synthetic', now: () => currentTime, fetchImpl });
  return { controller, calls };
}
test('8D controller preflights before OAuth and runs exact prepare/replay/status/cancel then cleanup', async () => {
  const f = fixture(); await f.controller.ready;
  assert.deepEqual(f.calls, ['preflight']);
  const result = await f.controller.run('synthetic.test.token', new AbortController().signal);
  assert.deepEqual(result, { signedClaimsVerified: true, hostStatusHttpStatus: 200, hostIdentityAccepted: true, hostDisabled: false, browserDispatchAllowed: false });
  assert.deepEqual(f.calls, ['preflight', 'recordOwnership', 'installFixture', 'sealLedger', 'enableHost', 'setDark', 'prepare', 'prepare', 'status', 'cancel', 'cancel', 'status', 'verifyCancelled', 'disableHost', 'setOff', 'cleanupFixture', 'verifyClean']);
  await assert.rejects(f.controller.run('synthetic.test.token'), /^Error: CLOUD_ACCEPTANCE_CLOSED$/);
});
test('8D controller rejects preflight and signed identity failures without installation or enablement', async () => {
  const f = fixture({ badPreflight: true }); await assert.rejects(f.controller.ready, /CLOUD_PREFLIGHT_FAILED/);
  await assert.rejects(f.controller.run('synthetic.test.token'), /CLOUD_PREFLIGHT_FAILED/);
  assert.deepEqual(f.calls, ['preflight']);
  const g = fixture({ badIdentity: true }); await g.controller.ready; await assert.rejects(g.controller.run('synthetic.test.token'), /^Error: CLOUD_ACCEPTANCE_FAILED$/);
  assert.deepEqual(g.calls, ['preflight']);
});
test('8D controller partial install and every later failure restore OFF and exact-owned cleanup', async () => {
  for (const fail of ['installFixture', 'sealLedger', 'enableHost', 'setDark', 'request', 'verifyCancelled']) {
    const f = fixture({ fail }); await f.controller.ready;
    await assert.rejects(f.controller.run('synthetic.test.token'), /^Error: CLOUD_ACCEPTANCE_FAILED$/);
    assert.deepEqual(f.calls.slice(-4), ['disableHost', 'setOff', 'cleanupFixture', 'verifyClean']);
  }
});
test('8D controller concurrent run attempts cannot install or send a second workflow', async () => {
  const f = fixture(); await f.controller.ready;
  const first = f.controller.run('synthetic.test.token');
  await assert.rejects(f.controller.run('synthetic.test.token'), /^Error: CLOUD_ACCEPTANCE_CLOSED$/);
  await first; assert.equal(f.calls.filter(name => name === 'installFixture').length, 1);
  assert.equal(f.calls.filter(name => name === 'prepare').length, 2);
});
test('8D controller failed durable ownership recording forbids all mutation', async () => {
  const f = fixture({ fail: 'recordOwnership' }); await f.controller.ready;
  await assert.rejects(f.controller.run('synthetic.test.token'), /^Error: CLOUD_ACCEPTANCE_FAILED$/);
  assert.deepEqual(f.calls, ['preflight', 'recordOwnership']);
});
test('8D controller rejects forged metadata, never skipping cleanup', async () => {
  for (const badMetadata of ['transactionId', 'status', 'commitKey', 'browserDispatchAllowed', 'secret']) {
    const f = fixture({ badMetadata }); await f.controller.ready; await assert.rejects(f.controller.run('synthetic.test.token'), /^Error: CLOUD_ACCEPTANCE_FAILED$/);
    assert.deepEqual(f.calls.slice(-4), ['disableHost', 'setOff', 'cleanupFixture', 'verifyClean']);
  }
});
test('8D controller bounds HTTP bytes and refuses nonzero cleanup verification', async () => {
  const f = fixture({ responseBytes: 32769 }); await f.controller.ready; await assert.rejects(f.controller.run('synthetic.test.token'), /^Error: CLOUD_ACCEPTANCE_FAILED$/);
  assert.deepEqual(f.calls.slice(-4), ['disableHost', 'setOff', 'cleanupFixture', 'verifyClean']);
  for (const badClean of ['ownedRows', 'payloadRows', 'hostFlag', 'mode', 'agentCommitEnabled', 'legacyGated', 'extra']) {
    const g = fixture({ badClean }); await g.controller.ready; await assert.rejects(g.controller.run('synthetic.test.token'), /^Error: CLOUD_CLEANUP_FAILED$/);
  }
});
test('8D controller snapshots claims and rechecks expiry across SDK awaits', async () => {
  const f = fixture({ expiredDuringUser: true }); await f.controller.ready; await assert.rejects(f.controller.run('synthetic.test.token'), /^Error: CLOUD_ACCEPTANCE_FAILED$/);
  assert.deepEqual(f.calls, ['preflight']);
});
test('8D controller cancellation and failed server session binding preserve independent cleanup', async () => {
  const abort = new AbortController();
  for (const options of [{ abortAfterInstall: abort }, { badBinding: true }]) {
    const f = fixture(options); await f.controller.ready; await assert.rejects(f.controller.run('synthetic.test.token', options.abortAfterInstall?.signal), /^Error: CLOUD_ACCEPTANCE_FAILED$/);
    assert.equal(f.calls.includes('enableHost'), false); assert.deepEqual(f.calls.slice(-4), ['disableHost', 'setOff', 'cleanupFixture', 'verifyClean']);
  }
});
test('8D controller never deletes owned fixture rows when host disable or OFF restoration is unconfirmed', async () => {
  for (const fail of ['disableHost', 'setOff']) {
    const f = fixture({ fail }); await f.controller.ready;
    await assert.rejects(f.controller.run('synthetic.test.token'), /^Error: CLOUD_CLEANUP_FAILED$/);
    assert.equal(f.calls.includes('cleanupFixture'), false);
    assert.equal(f.calls.includes('verifyClean'), false);
    assert.deepEqual(f.calls.slice(-2), ['disableHost', 'setOff']);
  }
});
test('8D controller verifies cleanup after row cleanup attempt and refuses PASS on cleanup uncertainty', async () => {
  for (const fail of ['cleanupFixture', 'verifyClean']) {
    const f = fixture({ fail }); await f.controller.ready;
    await assert.rejects(f.controller.run('synthetic.test.token'), /^Error: CLOUD_CLEANUP_FAILED$/);
    assert.deepEqual(f.calls.slice(-4), ['disableHost', 'setOff', 'cleanupFixture', 'verifyClean']);
  }
});

// --- F. the live acceptance CLI ---------------------------------------------

const credential = 'sbp_' + ('a'.repeat(40));

test('8D live runner freezes exact CLI modes, pinned SDK and ownership window', () => {
  assert.deepEqual(parseAcceptanceArgs8D([]), { mode: 'accept' });
  assert.deepEqual(parseAcceptanceArgs8D(['--recover', namespace]), { mode: 'recover', namespace });
  assert.throws(() => parseAcceptanceArgs8D(['--recover']), /INVALID_8D_RUNNER_ARGUMENTS/);
  assert.throws(() => parseAcceptanceArgs8D(['--recover', 'not-a-uuid']), /INVALID_8D_RUNNER_ARGUMENTS/);
  assert.throws(() => parseAcceptanceArgs8D(['--sql', 'select 1']), /INVALID_8D_RUNNER_ARGUMENTS/);
  assert.equal(SDK_SPECIFIER_8D, 'npm:@supabase/supabase-js@2.57.4');
  assert.equal(STATE_DIRECTORY_8D, '.opera-agent-8d-state');
  assert.equal(LEASE_TTL_MS_8D, 180000);
});

test('8D recovery mode needs no OAuth key, SDK call, browser or network when no dirty manifest exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-8d-runner-')); let sdkCalls = 0, fetchCalls = 0; const lines = [];
  try {
    const result = await runAcceptanceCli8D({ args: ['--recover', namespace], createClient: () => { sdkCalls++; throw new Error('sdk must not run'); }, credential, publicKey: null,
      fetchImpl: async () => { fetchCalls++; throw new Error('network must not run'); }, now: () => 1000, randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', stateDirectory: dir, write: value => lines.push(value) });
    assert.deepEqual(result, { mode: 'recover', namespace, recovered: false }); assert.equal(sdkCalls, 0); assert.equal(fetchCalls, 0);
    assert.equal(lines.length, 1); assert.equal(lines[0].includes(credential), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('8D acceptance fails preflight before emitting namespace or OAuth URL when deployed bundle is not exact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-8d-runner-')); const lines = []; let sdkCalls = 0;
  try {
    const fetchImpl = async url => {
      if (String(url).endsWith('/functions')) return new Response(JSON.stringify([{ slug: 'opera-agent-transactions-8d', status: 'ACTIVE', verify_jwt: true, ezbr_sha256: 'wrong' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      throw new Error('unexpected request');
    };
    const sdk = { auth: { getClaims: async () => ({ data: {}, error: null }), getUser: async () => ({ data: {}, error: null }) } };
    await assert.rejects(runAcceptanceCli8D({ args: [], createClient: () => { sdkCalls++; return sdk; }, credential, publicKey: 'sb_publishable_' + ('x'.repeat(24)), fetchImpl, now: () => Date.parse('2026-09-14T00:00:00.000Z'), randomUUID: () => namespace, stateDirectory: dir, write: value => lines.push(value) }), /CLOUD_PREFLIGHT_FAILED/);
    assert.equal(sdkCalls, 1); assert.deepEqual(lines, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// --- G. the static fence migration and the Edge host gate -------------------

const migrationUrl = new URL('../supabase/migrations/20260914043049_transaction_operator_fence_8d.sql', import.meta.url);
const edgeUrl = new URL('../supabase/functions/opera-agent-transactions-8d/index.ts', import.meta.url);

test('8D release checks all owned tables inside the exclusive barrier before clearing ownership', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const release = sql.slice(sql.indexOf('create function public.opera_tx_operator_release_8d'), sql.indexOf('create function public.opera_tx_operator_state_8d'));
  const check = release.indexOf('if exists(');
  assert.ok(release.indexOf('for update') < check);
  assert.ok(check < release.indexOf('set owner_id=null'));
  assert.match(release, /SERVER_FENCE_OWNED_ROWS_REMAIN/);
  for (const table of ['principals', 'rates', 'acceptance_bindings', 'runs', 'run_identities', 'run_limits', 'run_previews', 'run_challenges', 'journal', 'approvals', 'commit_slots']) {
    assert.ok(release.includes(`from opera_agent_tx_candidate.${table} where tenant_id=p_namespace::text`), table);
  }
  assert.ok(release.includes('from opera_agent_private.goal_heads where tenant_id=p_namespace'));
});

test('8D server fence migration is singleton, epoch-fenced, service-only and cleanup-safe', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create table opera_agent_tx_candidate\.operator_control/);
  assert.match(sql, /set epoch=epoch\+1/);
  assert.match(sql, /for update/);
  assert.match(sql, /for share/);
  assert.match(sql, /lease_until>clock_timestamp\(\)/);
  assert.match(sql, /opera_tx_operator_assert_8d/);
  assert.match(sql, /opera_tx_operator_cleanup_fixture_8d/);
  assert.match(sql, /if v_host or v_mode<>'OFF' or v_legacy or v_agent then raise exception 'SERVER_FENCE_NOT_CLEAN'/);
  assert.match(sql, /revoke execute on function public\.opera_tx_operator_acquire_8d[\s\S]*from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.opera_tx_operator_acquire_8d[\s\S]*to service_role/);
  assert.equal(/grant execute[\s\S]*to (anon|authenticated)/.test(sql), false);
});

test('8D Edge candidate keeps env as master kill switch and checks DB fence before transaction host', async () => {
  const source = await readFile(edgeUrl, 'utf8');
  assert.match(source, /OPERA_AGENT_TRANSACTION_DARK_8D/);
  assert.match(source, /client\.rpc\("opera_tx_operator_host_gate_8d"\)/);
  assert.ok(source.indexOf('opera_tx_operator_host_gate_8d') < source.indexOf('return transactionHost(input,credential)'));
  assert.match(source, /data!==true/);
  assert.match(source, /TRANSACTION_DISABLED/);
  assert.equal(source.includes('browserDispatchAllowed:true'), false);
});
