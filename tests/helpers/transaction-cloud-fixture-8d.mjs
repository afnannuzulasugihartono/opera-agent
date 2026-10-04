// @last-edited: 2026-10-04 11:10 UTC.
// @title: transaction-cloud-fixture-8d — cloud-fixture-8d — Test-only DATA builder, not authentication, enrollment, SQL or a cloud .
// @context: Test helper.
// @state: refactor(quality): centralize code-unit comparator in lib/canonical-order.js - removes token-identical inline comparator blocks that tripped.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: transaction-dark-fixture, goal-ledger, transaction-oauth-8d, canonical-order.

// Test-only DATA builder, not authentication, enrollment, SQL or a cloud runner.
// userId must come from independently verified OAuth in the future operator
// harness. This module does not establish that trust or grant browser authority.
import { transactionFixture } from './transaction-dark-fixture.mjs';
import { digestCanonical } from '../../lib/goal-ledger.js';
import { CLIENT_ID } from './transaction-oauth-8d.mjs';
import { codeUnitCompare } from '../../lib/canonical-order.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
export async function createCloudFixtureData8D(options) {
  if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Object.keys(options).sort(codeUnitCompare).join(',') !== 'namespace,preparedAt,userId' ||
      !UUID.test(options.namespace??'') || !UUID.test(options.userId??'') ||
      typeof options.preparedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(options.preparedAt) ||
      !Number.isFinite(Date.parse(options.preparedAt)) || new Date(options.preparedAt).toISOString() !== options.preparedAt) {
    throw new Error('INVALID_CLOUD_FIXTURE_CONFIGURATION');
  }
  // Snapshot primitive input before any await. No ambient clock/randomness/key.
  const { namespace, userId, preparedAt } = options;
  const tag = namespace.replaceAll('-', '');
  const actorId = 'm8d_fixture_actor_' + tag, goalId = 'm8d_fixture_goal_' + tag, transactionId = 'm8d_fixture_tx_' + tag;
  const targetFields = { deviceId: 'm8d_fixture_device_' + tag, tabId: 0, documentGeneration: 'm8d_fixture_document_' + tag };
  const target = { ...targetFields, targetDigest: await digestCanonical(targetFields) };
  const f = await transactionFixture(preparedAt, { tenantId: namespace, userId, actorId, goalId, transactionId, target, observedAt: preparedAt });
  const ledger = f.state.ledger;
  return freeze({
    principal: { tenant_id: namespace, actor_id: actorId, user_id: userId, oauth_client_id: CLIENT_ID },
    goalHead: { tenant_id: namespace, goal_id: goalId, head_revision: ledger.revision, head_digest: ledger.ledgerDigest, status: ledger.status, created_at: ledger.createdAt, updated_at: ledger.createdAt, expires_at: ledger.expiresAt },
    binding: { tenant_id: namespace, actor_id: actorId, transaction_id: transactionId, goal_id: goalId, goal_revision: ledger.revision, ledger_digest: ledger.ledgerDigest,
      metadata: { mode: 'DARK', preparedDigest: f.request.prepared.prepareDigest, ledgerDigest: ledger.ledgerDigest, target: f.state.target, grant: f.state.grant, operands: [f.state.resolved] } },
    ledger, request: f.request,
    cleanup: { tenantId: namespace, actorId, goalId, transactionId },
    browserDispatchAllowed: false,
  });
}
