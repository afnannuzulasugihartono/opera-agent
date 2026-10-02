// Why source-text and fixture pins, stated per AGENTS.md: this checkpoint is
// contract-only. There is no runtime ledger implementation to execute, so the
// deliverable IS the frozen contract: the schema shape, the canonical digest
// behaviour (recomputed here over 100 runs, not read from a file), the hostile
// corpus, the metadata-only persistence boundary, and the quantitative gates.
// Asserting the fixture JSON alone would only prove the file did not change;
// these tests parse it and evaluate it, so a contract that stops rejecting
// floats or stops failing closed fails here.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-contract-v1.json', import.meta.url), 'utf8'));
const replay = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const thresholds = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-thresholds-v1.json', import.meta.url), 'utf8'));
const mcpContract = JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-contract-v1.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const protocolSource = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    assert.equal(Number.isSafeInteger(value), true, 'OA_CANONICAL_JSON_V1 accepts safe integers only');
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  assert.equal(typeof value, 'object');
  const keys = Object.keys(value);
  for (const key of keys) assert.match(key, /^[\x20-\x7e]+$/, 'canonical object keys must be printable ASCII');
  keys.sort((a, b) => Buffer.compare(Buffer.from(a, 'ascii'), Buffer.from(b, 'ascii')));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function keysDeep(value, output = []) {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, output);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    output.push(key.toLowerCase());
    keysDeep(item, output);
  }
  return output;
}

test('6A freezes a bounded goal ledger and proof contract without runtime changes', () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.milestone, '6A');
  assert.equal(contract.baselineVersion, '1.6.0');
  assert.equal(contract.runtimeStatus, 'CONTRACT_ONLY');
  assert.equal(contract.canonicalization.name, 'OA_CANONICAL_JSON_V1');
  assert.equal(contract.canonicalization.numbers, 'SAFE_INTEGERS_ONLY');
  assert.deepEqual(contract.proofStatuses, ['PROVED', 'BOUNDED_COMPLETE', 'PARTIAL', 'BLOCKED', 'UNKNOWN']);
  assert.equal(contract.limits.ledgerTokenBytes, 64 * 1024);
  assert.equal(contract.limits.proofResponseBytes, 128 * 1024);
  assert.ok(contract.limits.maximumLifetimeSeconds <= 7 * 24 * 60 * 60);
  assert.equal(contract.publicApiDecision.status, 'DEFERRED_TO_6E');
  assert.equal(contract.publicApiDecision.extensionChangeAllowedIn6A, false);
  assert.equal(contract.publicApiDecision.productionSchemaChangeAllowedIn6A, false);

  assert.equal(pkg.version, '1.6.15');
  assert.equal(manifest.version, '1.6.15');
  assert.match(protocolSource, /PROTOCOL_VERSION = 1/);
  assert.equal(mcpContract.toolCount, 22);
  assert.equal(contract.publicApiDecision.existingMcpToolCount, mcpContract.toolCount);
});

test('6A canonical digest is deterministic across 100 runs and rejects floats', () => {
  const outputs = Array.from({ length: 100 }, () => digest(replay.ledger));
  assert.equal(new Set(outputs).size, 1);
  assert.equal(outputs[0], replay.expectedLedgerDigest);
  assert.throws(() => canonicalJson({ unsafe: 1.5 }), /safe integers only/);
  assert.equal(canonicalJson({ z: 'e\u0301', a: true }), '{"a":true,"z":"é"}');
});

test('6A hostile replay corpus covers false completion, authority, tenancy, and revisions', () => {
  assert.equal(replay.schemaVersion, 1);
  assert.equal(replay.syntheticOnly, true);
  const byId = new Map(replay.scenarios.map((scenario) => [scenario.id, scenario]));
  assert.equal(byId.size, replay.scenarios.length);
  for (const id of [
    'action-receipt-only',
    'authorization-only',
    'bounded-feed-stable-boundary',
    'closed-world-exhaustive',
    'contradictory-direct-observations',
    'expired-evidence',
    'cross-tenant-evidence',
    'stale-ledger-revision',
    'forked-ledger-revision',
    'prompt-injected-authorization',
    'implicit-authority-broadening',
    'narrowed-goal-evidence-reuse',
    'expanded-goal-invalidates-completion',
    'invalid-proof-digest',
    'secret-like-ledger-value',
  ]) assert.ok(byId.has(id), id);

  assert.equal(byId.get('action-receipt-only').expectedStatus, 'UNKNOWN');
  assert.equal(byId.get('authorization-only').expectedStatus, 'UNKNOWN');
  assert.equal(byId.get('bounded-feed-stable-boundary').expectedStatus, 'BOUNDED_COMPLETE');
  assert.equal(byId.get('closed-world-exhaustive').expectedStatus, 'PROVED');
  assert.equal(byId.get('contradictory-direct-observations').expectedStatus, 'BLOCKED');
  assert.equal(byId.get('cross-tenant-evidence').expectedRejection, 'CROSS_TENANT');
  assert.equal(byId.get('prompt-injected-authorization').expectedRejection, 'UNTRUSTED_INTENT_SOURCE');
  assert.equal(byId.get('implicit-authority-broadening').freshUserAuthorization, false);
  assert.equal(byId.get('expanded-goal-invalidates-completion').expectedReuse, 'NO_COMPLETENESS_FOR_NEW_SCOPE');
});

test('6A persistence contract is metadata-only and forbids raw sensitive state', () => {
  assert.deepEqual(contract.persistentHeadColumns, [
    'tenant_id', 'goal_id', 'head_revision', 'head_digest', 'status', 'created_at', 'updated_at', 'expires_at',
  ]);
  const allowed = new Set(contract.persistentHeadColumns);
  for (const forbidden of contract.persistentHeadForbiddenColumns) assert.equal(allowed.has(forbidden), false);
  assert.equal(contract.invariants.rawPageContentPersisted, false);
  assert.equal(contract.invariants.secretLikeValuesAccepted, false);
  assert.equal(contract.invariants.crossTenantEvidenceAccepted, false);
  assert.equal(contract.invariants.maximumFocusChanges, 0);

  const keys = keysDeep({ contract, replay });
  for (const forbidden of contract.persistentHeadForbiddenColumns) {
    if (['objective', 'constraints', 'authorizations', 'claims'].includes(forbidden)) continue;
    assert.equal(keys.includes(forbidden), false, `forbidden persisted-data-shaped field: ${forbidden}`);
  }
  const serialized = JSON.stringify({ contract, replay });
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /data:image\//i);
  assert.doesNotMatch(serialized, /BEGIN (?:RSA )?PRIVATE KEY/i);
});

test('6A locks quantitative gates to the accepted 1.6.0 baseline', () => {
  assert.equal(thresholds.schemaVersion, 1);
  assert.equal(thresholds.checkpoint, '6A');
  assert.equal(thresholds.baselineVersion, '1.6.0');
  assert.equal(thresholds.invariants.minimumCanonicalReplayRuns, 100);
  assert.equal(thresholds.invariants.minimumCanonicalReplayAgreement, 1);
  assert.equal(thresholds.invariants.maximumFalseProvedCases, 0);
  assert.equal(thresholds.invariants.maximumCrossTenantAcceptances, 0);
  assert.equal(thresholds.invariants.maximumStaleRevisionAcceptances, 0);
  assert.equal(thresholds.invariants.maximumImplicitAuthorityBroadeningAcceptances, 0);
  assert.equal(thresholds.invariants.maximumFocusChanges, 0);
  assert.equal(thresholds.invariants.maximumSensitiveValuesPersisted, 0);
  assert.equal(thresholds.invariants.targetProofEvaluationP95MsAt500Evidence, 10);
  assert.equal(thresholds.invariants.maximumOrdinaryValidationMedianRegressionPercent, 15);
  assert.equal(thresholds.pairedSemanticBaseline.richReadLatencyMedianMs, 19.83);
  assert.equal(thresholds.pairedSemanticBaseline.singleUpdateDeltaToSnapshotRatio, 0.12);
  assert.equal(thresholds.publicSurfaceBaseline.protocolVersion, 1);
  assert.equal(thresholds.publicSurfaceBaseline.capabilityCount, 26);
  assert.equal(thresholds.publicSurfaceBaseline.mcpToolCount, 22); // U-T rebaseline: watch tools added
  assert.equal(thresholds.publicSurfaceBaseline.mcpSourceSha256, mcpContract.sourceSha256);
  assert.equal(digest(contract), thresholds.contractCorpusDigest);
  assert.equal(digest(replay), thresholds.replayCorpusDigest);
});
