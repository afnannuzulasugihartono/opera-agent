import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createLedger } from '../lib/goal-ledger.js';
import { evaluateProof } from '../lib/proof-engine.js';
import {
  bindCollectionEvidence7D,
  collectSemanticRecords7D,
  dedupSemanticRecords7D,
} from '../lib/reactive-vm-7d.js';
import {
  ReactiveVmHostError,
  deriveVmEffectIdempotencyKey7E,
  validateVmPersistedMetadata7E,
} from '../lib/reactive-vm-host-7e.js';
import { sha256CanonicalLf } from './helpers/canonical-source-hash.mjs';

const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/reactive-vm-contract-v1.json', import.meta.url), 'utf8'));
const replay = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const mcpSource = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url));

const EXPECTED_MCP_SHA256 = '1caf54b52ca03f5232e83d6226d0f1c2a77f36225797856e932b439e0db95511';
const EXPECTED_ALLOWED_EFFECTS = [
  'browser.burst',
  'browser.ping',
  'media.state',
  'page.capture',
  'page.collect_links',
  'page.find',
  'page.query',
  'page.read',
  'page.wait_for',
  'tabs.find',
  'tabs.get',
  'tabs.list',
];

const clone = (value) => JSON.parse(JSON.stringify(value));

function item(logicalId, extra = {}) {
  return {
    logicalId,
    semanticRevision: 1,
    stableKey: logicalId.replace('se_', 'item_'),
    stableKeySource: 'id',
    identityAmbiguous: false,
    name: `Item ${logicalId}`,
    inViewport: true,
    ...extra,
  };
}

function observationMeta(extra = {}) {
  return {
    method: 'page.read',
    logicalNowMs: 1000,
    provenance: {
      tenantId: 'tenant-7f',
      deviceId: 'device-7f',
      tabId: 7,
      documentGeneration: 'doc-7f-1',
    },
    observationKind: 'DIRECT_OBSERVATION',
    scopeKind: 'DECLARED_BOUNDED_FEED',
    boundaryStable: false,
    dependencyFingerprint: `sha256:${'7'.repeat(64)}`,
    dependencyKinds: ['ENTITY_SET'],
    ...extra,
  };
}

function collectFeed({ stable = false, maxItems = 10 } = {}) {
  const meta = observationMeta({ boundaryStable: stable });
  const first = collectSemanticRecords7D(
    [item('se_a'), item('se_b')],
    ['logicalId', 'semanticRevision', 'stableKey', 'stableKeySource', 'name', 'inViewport'],
    {
      destination: 'feed',
      maxItems,
      collectionBudget: 1000,
      sourceBinding: 'batch',
      observationMeta: meta,
    },
  );
  const second = collectSemanticRecords7D(
    [item('se_b', { semanticRevision: 2, inViewport: false }), item('se_c')],
    ['logicalId', 'semanticRevision', 'stableKey', 'stableKeySource', 'name', 'inViewport'],
    {
      existing: first,
      destination: 'feed',
      maxItems,
      collectionBudget: 1000,
      sourceBinding: 'batch',
      observationMeta: meta,
    },
  );
  return dedupSemanticRecords7D(second, ['logicalId'], { destination: 'unique', collectionBudget: 1000 });
}

test('7F keeps the 1.6.10 public surface and frozen read-only VM effect policy unchanged', () => {
  assert.equal(packageJson.version, '1.6.10');
  assert.equal(manifest.version, '1.6.10');
  assert.equal(contract.baselineVersion, '1.6.0');
  assert.equal(contract.inventory.value.protocolVersion, 1);
  assert.equal(contract.inventory.value.capabilityCount, 26);
  assert.equal(contract.inventory.value.mcpToolCount, 22); // U-T rebaseline
  assert.equal(contract.inventory.digest, 'sha256:39fc4a9871859be88c759fe0c26e1b6c30d711d1631c3ca4110e0b1ea856905e');
  assert.equal(sha256CanonicalLf(mcpSource), EXPECTED_MCP_SHA256);
  const simulatedWindowsCheckout = Buffer.from(mcpSource.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
  assert.equal(sha256CanonicalLf(simulatedWindowsCheckout), EXPECTED_MCP_SHA256);

  const allowed = contract.effectClassification
    .filter((entry) => entry.initialV1Allowed)
    .map((entry) => entry.method)
    .sort();
  assert.deepEqual(allowed, EXPECTED_ALLOWED_EFFECTS);

  for (const method of [
    'tabs.open', 'tabs.activate', 'tabs.close', 'tabs.navigate', 'tabs.reload',
    'page.click', 'page.pointer', 'page.fill', 'page.focus', 'page.scroll', 'page.key',
    'media.play', 'media.pause', 'media.seek',
  ]) {
    assert.equal(contract.effectClassification.find((entry) => entry.method === method)?.initialV1Allowed, false);
  }
});

test('7F controlled lazy-list completion is bounded, deduplicated, and never universal', () => {
  const partial = collectFeed({ stable: false });
  assert.equal(partial.itemCount, 3);
  assert.equal(partial.dedup.duplicatesRemoved, 1);
  assert.equal(partial.completion.status, 'PARTIAL');
  assert.equal(partial.completion.completeWithinScope, false);
  assert.equal(partial.completion.universal, false);
  assert.ok(partial.completion.unresolved.includes('STABLE_BOUNDARY_NOT_OBSERVED'));

  const complete = collectFeed({ stable: true });
  assert.deepEqual(complete.items.map((entry) => entry.logicalId), ['se_a', 'se_b', 'se_c']);
  assert.equal(complete.completion.status, 'BOUNDED_COMPLETE');
  assert.equal(complete.completion.completeWithinScope, true);
  assert.equal(complete.completion.universal, false);
  assert.ok(complete.completion.limits.includes('NOT_UNIVERSAL_PROOF'));

  const capped = collectFeed({ stable: true, maxItems: 2 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.completion.status, 'PARTIAL');
  assert.equal(capped.completion.completeWithinScope, false);
  assert.ok(capped.completion.unresolved.includes('COLLECTION_CAP_REACHED'));
});

test('7F deterministic bounded collection replay agrees byte-for-byte across 100 runs', () => {
  const outputs = [];
  for (let index = 0; index < 100; index += 1) outputs.push(JSON.stringify(collectFeed({ stable: true })));
  assert.equal(new Set(outputs).size, 1);
});

test('7F bounded browser evidence produces zero false PROVED outcomes', async () => {
  const input = clone(replay.ledger);
  input.tenantId = 'tenant-7f';
  input.scope = { kind: 'CLOSED_WORLD', resourceId: 'resource_fixture_map_001' };
  const ledger = await createLedger(input, { authoritySource: 'USER', now: input.createdAt });

  const meta = observationMeta({
    boundaryStable: true,
    provenance: {
      tenantId: ledger.tenantId,
      deviceId: 'device-7f',
      tabId: 7,
      documentGeneration: 'doc-7f-1',
    },
  });
  const collection = collectSemanticRecords7D([item('se_a')], ['logicalId'], {
    destination: 'feed',
    maxItems: 10,
    collectionBudget: 10,
    sourceBinding: 'source',
    observationMeta: meta,
  });
  const evidence = await bindCollectionEvidence7D(collection, {
    evidenceId: 'm7_7f_bounded_observation',
    tenantId: ledger.tenantId,
    goalId: ledger.goalId,
    goalRevision: ledger.revision,
    ledgerDigest: ledger.ledgerDigest,
    claimId: 'claim_candidates_match',
    scopeId: ledger.scope.resourceId,
    predicate: 'OBSERVED_CANDIDATES_SATISFY_CONSTRAINTS',
    observedAt: '2025-01-01T00:00:03Z',
    supports: true,
    forceDirect: true,
  });

  assert.equal(evidence.exhaustive, false);
  const proof = await evaluateProof(ledger, 'claim_candidates_match', [evidence], { now: '2025-01-01T00:00:04Z' });
  assert.notEqual(proof.status, 'PROVED');
  assert.ok(proof.unresolved.includes('EXHAUSTIVE_EVIDENCE_REQUIRED'));
});

test('7F effect idempotency replay is deterministic and request-sensitive', async () => {
  const base = {
    tenantId: 'tenant-7f',
    runId: 'run-7f',
    programDigest: `sha256:${'1'.repeat(64)}`,
    requestDigest: `sha256:${'2'.repeat(64)}`,
    attemptClass: 'READ_ONLY',
  };
  const keys = [];
  for (let index = 0; index < 100; index += 1) keys.push(await deriveVmEffectIdempotencyKey7E(base));
  assert.equal(new Set(keys).size, 1);
  assert.match(keys[0], /^vm1:[0-9a-f]{64}$/);
  const changed = await deriveVmEffectIdempotencyKey7E({ ...base, requestDigest: `sha256:${'3'.repeat(64)}` });
  assert.notEqual(changed, keys[0]);
});

test('7F persisted host state is metadata-only and rejects raw or sensitive browser content', () => {
  const metadata = {
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    runId: '11111111-1111-4111-8111-111111111111',
    requestId: 'm7-7f-metadata',
    programDigest: `sha256:${'1'.repeat(64)}`,
    goalId: 'goal-7f',
    goalRevision: 1,
    targetDigest: `sha256:${'2'.repeat(64)}`,
    status: 'QUEUED',
    checkpointDigest: `sha256:${'3'.repeat(64)}`,
    checkpointBytes: 64,
    resultDigest: null,
    resultBytes: null,
    logicalTransition: 0,
    leaseEpoch: 0,
    expiresAt: '2026-09-12T08:00:00.000Z',
    availableAt: '2026-09-12T07:00:00.000Z',
    errorCode: null,
  };
  assert.deepEqual(validateVmPersistedMetadata7E(metadata), metadata);

  assert.throws(
    () => validateVmPersistedMetadata7E({ ...metadata, page_text: 'raw browser content' }),
    (error) => error instanceof ReactiveVmHostError && error.code === 'PROHIBITED_PERSISTENCE',
  );
  assert.throws(
    () => validateVmPersistedMetadata7E({ ...metadata, accessToken: 'secret-value' }),
    (error) => error instanceof ReactiveVmHostError && error.code === 'PROHIBITED_PERSISTENCE',
  );
});
