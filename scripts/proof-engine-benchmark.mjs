// Last edited: 2026-10-04 17:52. Title: proof-engine-benchmark — Script. Now: implement milestone 6C scoped proof engine.

import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createLedger } from '../lib/goal-ledger.js';
import { createEvidence, evaluateProof } from '../lib/proof-engine.js';

const replay = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const runsArg = process.argv.find((value) => value.startsWith('--runs='));
const runs = Math.max(10, Math.min(100, Number(runsArg?.split('=')[1]) || 30));
const now = '2026-09-11T00:04:00Z';
const ledger = await createLedger(replay.ledger, { authoritySource: 'USER', now: replay.ledger.createdAt });
const evidence = await Promise.all(Array.from({ length: 500 }, (_, index) => createEvidence({
  schemaVersion: 1,
  evidenceId: `benchmark_evidence_${String(index).padStart(3, '0')}`,
  category: 'DIRECT_OBSERVATION',
  tenantId: ledger.tenantId,
  goalId: ledger.goalId,
  goalRevision: ledger.revision,
  ledgerDigest: ledger.ledgerDigest,
  claimId: 'claim_candidates_match',
  scopeId: ledger.scope.resourceId,
  observedAt: '2026-09-11T00:03:00Z',
  trust: 'BROWSER_SENSOR',
  predicate: 'OBSERVED_CANDIDATES_SATISFY_CONSTRAINTS',
  supports: true,
  exhaustive: false,
  dependencies: [],
})));

for (let index = 0; index < 5; index += 1) await evaluateProof(ledger, 'claim_candidates_match', evidence, { now });
const samples = [];
for (let index = 0; index < runs; index += 1) {
  const started = performance.now();
  await evaluateProof(ledger, 'claim_candidates_match', evidence, { now });
  samples.push(performance.now() - started);
}
samples.sort((left, right) => left - right);
const percentile = (ratio) => samples[Math.min(samples.length - 1, Math.floor(samples.length * ratio))];
console.log(JSON.stringify({
  schemaVersion: 1,
  checkpoint: '6C',
  environment: `${process.platform} ${process.arch}; ${process.version}`,
  runs,
  evidenceItems: evidence.length,
  medianMs: Number(percentile(0.5).toFixed(4)),
  p95Ms: Number(percentile(0.95).toFixed(4)),
  maximumMs: Number(samples.at(-1).toFixed(4)),
  targetP95Ms: 10,
  persistedOutput: false,
}, null, 2));
