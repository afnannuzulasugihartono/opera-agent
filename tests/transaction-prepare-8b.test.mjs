// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-prepare-8b.test — prepare-8b.test — Test.
// @state: feat(ut): event-triggered workflows + universal one-hop gateway (1.6.6).
// @dependencies: strict, node:fs, node:perf_hooks, node:test, transaction-prepare.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
  TransactionPrepareError,
  classifyTransactionEffect,
  compileDecisionPredicates,
  createTransactionPreview,
  decideTransactionCommitAvailability,
  decideTransactionEnforcement,
  planPredicateRevalidation,
  prepareTransaction,
  validatePreparedTransaction,
} from '../lib/transaction-prepare.js';

const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const examples = readJson('transaction-examples-v1.json');
const contract = readJson('transaction-contract-v1.json');
const mcp = readJson('mcp-contract-v1.json');

const clone = (value) => structuredClone(value);
const HASH = (character) => `sha256:${character.repeat(64)}`;

function candidate(overrides = {}) {
  const value = clone(examples.validTransactions[0]);
  delete value.prepareDigest;
  return Object.assign(value, overrides);
}

test('8B prepares an immutable byte-identical single-action envelope without ambient state', async () => {
  const input = candidate();
  const snapshot = clone(input);
  const first = await prepareTransaction(input);
  const second = await prepareTransaction(clone(input));
  assert.deepEqual(first, examples.validTransactions[0]);
  assert.deepEqual(second, first);
  assert.deepEqual(input, snapshot);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.action), true);
  assert.deepEqual(await validatePreparedTransaction(first), first);
  const tampered = clone(first);
  tampered.action.actionDigest = HASH('9');
  await assert.rejects(validatePreparedTransaction(tampered), (error) => error.code === 'PREPARE_DIGEST_MISMATCH');
});

test('8B authority, action, target, provenance, postcondition, and policy changes alter prepare digest', async () => {
  const mutations = [
    (value) => { value.goalRevision += 1; value.provenance.forEach((item) => { item.goalRevision += 1; }); },
    (value) => { value.action.actionDigest = HASH('4'); },
    (value) => { value.target.targetDigest = HASH('5'); },
    (value) => { value.provenance[1].valueDigest = HASH('6'); },
    (value) => { value.expectedPostconditions = [HASH('7')]; },
    (value) => { value.enforcementMode = 'DARK'; },
  ];
  const baseline = await prepareTransaction(candidate());
  for (const mutate of mutations) {
    const changed = candidate();
    mutate(changed);
    const prepared = await prepareTransaction(changed);
    assert.notEqual(prepared.prepareDigest, baseline.prepareDigest);
  }
});

test('8B rejects second actions, unknown fields, effect downgrades, secrets, and over-limit candidates', async () => {
  const attempts = [
    [Object.assign(candidate(), { actions: [candidate().action, candidate().action] }), 'MULTI_ACTION_FORBIDDEN'],
    [Object.assign(candidate(), { unexpected: true }), 'INVALID_SCHEMA'],
    [candidate({ effectClass: 'LOCAL_REVERSIBLE' }), 'EFFECT_CLASS_MISMATCH'],
    [Object.assign(candidate(), { password: 'do-not-store' }), 'SENSITIVE_VALUE'],
    [candidate({ decisionPredicates: Array.from({ length: 65 }, (_, index) => ({ predicateId: `p_${index}`, kind: 'OPERAND', dependencyDigests: [HASH('8')] })) }), 'OVER_LIMIT'],
  ];
  for (const [value, code] of attempts) {
    await assert.rejects(prepareTransaction(value), (error) => error instanceof TransactionPrepareError && error.code === code);
  }
});

test('8B trusted classification is internal and conservative for every generic primitive', () => {
  for (const method of contract.transactionPrimitiveMethods) {
    assert.equal(classifyTransactionEffect({ descriptorId: `untrusted_${method.replace('.', '_')}`, method }), 'IRREVERSIBLE_OR_UNKNOWN');
  }
  assert.equal(classifyTransactionEffect({ descriptorId: 'invented_safe_click', method: 'page.click', effectClass: 'LOCAL_REVERSIBLE' }), 'IRREVERSIBLE_OR_UNKNOWN');
  assert.throws(() => classifyTransactionEffect({ descriptorId: 'bad', method: 'raw.cdp' }), (error) => error.code === 'INVALID_ACTION');
});

test('8B enforcement decision covers all 22 tools and rejects mixed bursts atomically', () => {
  assert.deepEqual(contract.enforcement.toolDecisions.map((item) => item.tool), mcp.tools);
  for (const entry of contract.enforcement.toolDecisions) {
    const expected = entry.classification === 'OBSERVATION' ? 'ALLOW' : 'TRANSACTION_REQUIRED';
    assert.equal(decideTransactionEnforcement({ mode: 'ENFORCED', tool: entry.tool }), expected, entry.tool);
  }
  assert.equal(decideTransactionEnforcement({ mode: 'ENFORCED', tool: 'run_browser_burst', burstActions: ['read', 'click', 'wait'] }), 'TRANSACTION_REQUIRED');
  assert.equal(decideTransactionEnforcement({ mode: 'ENFORCED', tool: 'run_browser_burst', burstActions: ['read', 'find', 'wait'] }), 'ALLOW');
  assert.equal(decideTransactionEnforcement({ mode: 'ENFORCED', tool: 'click_element', internalExecutor: { serverDerived: true, transactionBound: true, clientSupplied: false } }), 'TRANSACTION_REQUIRED');
  assert.equal(decideTransactionEnforcement(
    { mode: 'ENFORCED', tool: 'click_element' },
    { internalExecutorAuthority: { serverDerived: true, transactionBound: true, clientSupplied: false, validated: true } },
  ), 'ALLOW');
  assert.equal(decideTransactionEnforcement({ mode: 'DARK', tool: 'click_element' }), 'ALLOW');
  assert.equal(decideTransactionEnforcement({ mode: 'OFF', tool: 'click_element' }), 'ALLOW');
  assert.equal(decideTransactionEnforcement({ mode: 'INCONSISTENT', tool: 'read_page' }), 'FAIL_CLOSED');
  assert.equal(decideTransactionCommitAvailability('OFF'), 'TRANSACTION_UNAVAILABLE');
  assert.equal(decideTransactionCommitAvailability('DARK'), 'TRANSACTION_UNAVAILABLE');
  assert.equal(decideTransactionCommitAvailability('ENFORCED'), 'ALLOW');
  assert.equal(decideTransactionCommitAvailability('INCONSISTENT'), 'FAIL_CLOSED');
});

test('8B compiles deterministic dependency fingerprints and rejects duplicate predicate identity', async () => {
  const predicates = [
    { predicateId: 'z_operand', kind: 'OPERAND', dependencyDigests: [HASH('b'), HASH('a')] },
    { predicateId: 'a_authority', kind: 'AUTHORITY', dependencyDigests: [HASH('c')] },
  ];
  const compiled = await compileDecisionPredicates(predicates);
  assert.deepEqual(compiled.map((item) => item.predicateId), ['a_authority', 'z_operand']);
  assert.deepEqual(compiled[1].dependencyDigests, [HASH('a'), HASH('b')]);
  assert.match(compiled[1].dependencyFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(compiled), true);
  await assert.rejects(
    compileDecisionPredicates([predicates[0], clone(predicates[0])]),
    (error) => error.code === 'DUPLICATE_ID',
  );
});

test('8B selectively revalidates dependent predicates while always revalidating authority fences', async () => {
  const predicates = [
    { predicateId: 'authority', kind: 'AUTHORITY', dependencyDigests: [HASH('a')] },
    { predicateId: 'operand_a', kind: 'OPERAND', dependencyDigests: [HASH('b')] },
    { predicateId: 'operand_b', kind: 'OPERAND', dependencyDigests: [HASH('c')] },
    { predicateId: 'untracked', kind: 'POSTCONDITION', dependencyDigests: [] },
  ];
  const compiled = await compileDecisionPredicates(predicates);
  const selective = planPredicateRevalidation(compiled, {
    schemaVersion: 'OA_SEMANTIC_DEPENDENCY_DELTA_V1',
    coverage: 'COMPLETE',
    changedDependencyDigests: [HASH('b')],
  });
  assert.deepEqual(selective.predicateIds, ['authority', 'operand_a', 'untracked']);
  assert.equal(selective.failClosed, false);

  for (const coverage of ['INCOMPLETE', 'AMBIGUOUS', 'RESET', 'UNAVAILABLE', 'STALE']) {
    const result = planPredicateRevalidation(compiled, {
      schemaVersion: 'OA_SEMANTIC_DEPENDENCY_DELTA_V1', coverage, changedDependencyDigests: [],
    });
    assert.deepEqual(result.predicateIds, ['authority', 'operand_a', 'operand_b', 'untracked']);
    assert.equal(result.failClosed, true);
  }
});

test('8B bounded preview is digest-only, deterministic, and never exceeds its declared byte cap', async () => {
  const prepared = await prepareTransaction(candidate());
  const preview = await createTransactionPreview(prepared);
  assert.deepEqual(preview, await createTransactionPreview(prepared));
  assert.equal(Object.isFrozen(preview), true);
  assert.match(preview.previewDigest, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(preview), /pageText|screenshot|password|https?:/i);
  assert.ok(new TextEncoder().encode(JSON.stringify(preview)).length <= prepared.budgets.approvalPreviewBytes);
});

test('8B 10,000 generated bounded candidates remain deterministic and cannot broaden the frozen shape', async () => {
  for (let index = 0; index < 10000; index += 1) {
    const value = candidate({ transactionId: `tx_generated_${index}` });
    value.action.actionDigest = `sha256:${index.toString(16).padStart(64, '0')}`;
    const prepared = await prepareTransaction(value);
    assert.equal(prepared.transactionId, `tx_generated_${index}`);
    assert.equal(prepared.effectClass, 'IRREVERSIBLE_OR_UNKNOWN');
    assert.equal('actions' in prepared, false);
    assert.ok(new TextEncoder().encode(JSON.stringify(prepared)).length <= contract.limits.preparedTransactionBytes);
  }
});

test('8B 64-predicate selective revalidation p95 stays below 10 ms', async (t) => {
  const compiled = await compileDecisionPredicates(Array.from({ length: 64 }, (_, index) => ({
    predicateId: `predicate_${index}`,
    kind: index < 8 ? 'AUTHORITY' : 'OPERAND',
    dependencyDigests: [`sha256:${index.toString(16).padStart(64, '0')}`],
  })));
  const samples = [];
  for (let index = 0; index < 1000; index += 1) {
    const started = performance.now();
    const result = planPredicateRevalidation(compiled, {
      schemaVersion: 'OA_SEMANTIC_DEPENDENCY_DELTA_V1', coverage: 'COMPLETE',
      changedDependencyDigests: [`sha256:${(index % 64).toString(16).padStart(64, '0')}`],
    });
    samples.push(performance.now() - started);
    assert.ok(result.predicateIds.length >= 8);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  t.diagnostic(`Checkpoint 8B 64-predicate revalidation p95=${p95.toFixed(4)} ms`);
  assert.ok(p95 < 10, `p95 ${p95.toFixed(4)} ms must stay below 10 ms`);
});

test('8B implementation remains pure and environment-neutral', () => {
  const source = fs.readFileSync(new URL('../lib/transaction-prepare.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:globalThis\.(?:fetch|WebSocket|chrome|browser)|Deno\.serve|process\.env|createClient\s*\(|Date\.now|new Date\s*\()/);
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
  assert.doesNotMatch(source, /supabase|@modelcontextprotocol|openid-client|oauth4webapi/i);
});
