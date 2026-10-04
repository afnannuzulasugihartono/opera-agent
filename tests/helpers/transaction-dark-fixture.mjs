// Last edited: 2026-10-04 17:52. Title: transaction-dark-fixture — Repository file. Now: isolate 8D hosted acceptance fixture data.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { cancelLedger, createLedger, digestCanonical } from '../../lib/goal-ledger.js';
import { prepareTransaction } from '../../lib/transaction-prepare.js';
import { createTransactionAdmission } from '../../lib/transaction-admission-8d.js';

const NOW = '2026-09-12T00:01:00.000Z';
const example = JSON.parse(fs.readFileSync(new URL('../fixtures/transaction-examples-v1.json', import.meta.url))).validTransactions[0];
const ledgerExample = JSON.parse(fs.readFileSync(new URL('../fixtures/goal-ledger-replay-v1.json', import.meta.url))).ledger;

export async function transactionFixture(startAt=example.preparedAt,options={}) {
  const start=Date.parse(startAt),NOW=new Date(start+60000).toISOString();
  const current=structuredClone(example);
  current.preparedAt=new Date(start).toISOString();current.expiresAt=new Date(start+600000).toISOString();
  for(const record of current.provenance)if(record.observedAt)record.observedAt=options.observedAt??new Date(start+30000).toISOString();
  const raw = structuredClone(ledgerExample);
  Object.assign(raw, { tenantId: options.tenantId??'tenant_alpha', goalId: options.goalId??'goal_alpha', createdAt: current.preparedAt, expiresAt: current.expiresAt });
  const target = options.target??current.target;
  const scopeId = String(target.tabId);
  raw.scope = { kind: 'TAB', resourceId: scopeId };
  // Dark journal-only fixture: no real-world predicates are attested by a click.
  // Host rejects nonempty constraints/nonGoals until a trusted evaluator exists.
  raw.constraints = options.constraints??[];
  raw.nonGoals = options.nonGoals??[];
  raw.authorizations = [{ authorizationId: 'auth_8d', operationClass: 'SINGLE_BROWSER_MUTATION', scopeId, expiresAt: current.expiresAt }];
  const ledger = await createLedger(raw, { authoritySource: 'USER', now: NOW });
  const candidate = structuredClone(current);
  delete candidate.prepareDigest;
  candidate.tenantId=raw.tenantId;
  candidate.goalId=raw.goalId;
  candidate.target=structuredClone(target);
  candidate.transactionId=options.transactionId??candidate.transactionId;
  candidate.budgets={...candidate.budgets,...options.budgets};
  candidate.goalRevision = ledger.revision;
  candidate.enforcementMode = 'DARK';
  candidate.action.argumentsDigest = await digestCanonical({ ref: 'oa_test' });
  candidate.action.actionDigest = await digestCanonical({ descriptorId: candidate.action.descriptorId, method: candidate.action.method, argumentsDigest: candidate.action.argumentsDigest });
  candidate.provenance[0].sourceDigest = ledger.ledgerDigest;
  candidate.provenance[0].valueDigest = await digestCanonical(ledger.authorizations[0]);
  for (const record of candidate.provenance) { record.goalRevision = ledger.revision; record.tenantId=raw.tenantId; }
  candidate.provenance[1].transformChain = ['IDENTITY'];
  candidate.provenance[1].valueDigest = await digestCanonical('oa_test');
  Object.assign(candidate.provenance[1], { deviceId: target.deviceId, tabId: target.tabId, documentGeneration: target.documentGeneration });
  const prepared = await prepareTransaction(candidate);
  const identity = { userId: options.userId??'user_alpha', tenantId: raw.tenantId, acceptanceIdentity: options.actorId??'synthetic_8d' };
  const grant = { authorizationId: 'auth_8d', operationClass: 'SINGLE_BROWSER_MUTATION', scopeId, actionDigest: prepared.action.actionDigest, targetDigest: prepared.target.targetDigest };
  const state = { ledger, identity, grant, target: prepared.target, mode: 'DARK', resolved: structuredClone(prepared.provenance[1]) };
  const calls = [];
  const admission = createTransactionAdmission({
    authenticate: async () => { calls.push('authenticate'); return state.identity; },
    loadPolicy: async () => state.mode,
    loadCurrentLedger: async () => state.ledger,
    loadCurrentTarget: async () => state.target,
    authorizeExactAction: async () => state.grant,
    resolveOperand: async () => state.resolved,
  });
  const request = { prepared, arguments: { ref: 'oa_test' }, operandBindings: { ref: 'prov_operand' } };
  return { admission, request, state, calls };
}
