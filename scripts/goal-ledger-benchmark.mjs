// @last-edited: 2026-10-04 11:10 UTC.
// @title: goal-ledger-benchmark — ledger-benchmark — Script.
// @context: Script.
// @state: implement milestone 6B goal ledger core.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: node:fs, node:perf_hooks, goal-ledger.

import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createLedger, inspectLedger, validateLedger } from '../lib/goal-ledger.js';

const replay = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const runsArg = process.argv.find((value) => value.startsWith('--runs='));
const iterationsArg = process.argv.find((value) => value.startsWith('--iterations='));
const runs = Math.max(3, Math.min(10, Number(runsArg?.split('=')[1]) || 3));
const iterations = Math.max(100, Math.min(5000, Number(iterationsArg?.split('=')[1]) || 1000));
const now = '2026-09-11T00:00:00Z';

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function measure(operation) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  return {
    medianMs: Number(percentile(samples, 0.5).toFixed(4)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(4)),
  };
}

const accepted = await createLedger(replay.ledger, { authoritySource: 'USER', now });
for (let index = 0; index < 100; index += 1) await validateLedger(accepted, { now });

const results = [];
for (let run = 1; run <= runs; run += 1) {
  const validation = await measure(() => validateLedger(accepted, { now }));
  const creation = await measure(() => createLedger(replay.ledger, { authoritySource: 'USER', now }));
  const inspection = await measure(() => inspectLedger(accepted));
  results.push({ run, validation, creation, inspection });
}

const summary = (key) => ({
  medianMs: Number(percentile(results.map((result) => result[key].medianMs), 0.5).toFixed(4)),
  p95Ms: Number(percentile(results.map((result) => result[key].p95Ms), 0.95).toFixed(4)),
});

console.log(JSON.stringify({
  schemaVersion: 1,
  checkpoint: '6B',
  environment: `${process.platform} ${process.arch}; ${process.version}`,
  runs,
  iterationsPerOperationPerRun: iterations,
  validation: summary('validation'),
  creation: summary('creation'),
  inspection: summary('inspection'),
  persistedOutput: false,
}, null, 2));
