// @last-edited: 2026-10-04 11:10 UTC.
// @title: ledger-server.test — server.test — Test.
// @context: Test.
// @state: chore(sync): align migration file IDs with production ledger, record applied skip_ads/ETW migrations, update test paths and sync docs.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: strict, node:crypto, node:fs, node:test, goal-ledger, ledger-token, canonical-source-hash.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import { createLedger } from '../lib/goal-ledger.js';
import {
  LEDGER_SERVER_LIMITS,
  openLedgerToken,
  sealLedgerToken,
} from '../lib/ledger-token.js';
import { sha256CanonicalLf } from './helpers/canonical-source-hash.mjs';

const replay = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-contract-v1.json', import.meta.url), 'utf8'));
const migration = fs.readFileSync(new URL('../supabase/migrations/20260911162525_opera_agent_goal_head.sql', import.meta.url), 'utf8');
const retryFixMigration = fs.readFileSync(new URL('../supabase/migrations/20260911162819_opera_agent_goal_head_first_apply.sql', import.meta.url), 'utf8');
const timestampFixMigration = fs.readFileSync(new URL('../supabase/migrations/20260911231331_opera_agent_goal_head_timestamp_order.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../supabase/functions/opera-agent-ledger/index.ts', import.meta.url), 'utf8');
const mcpSource = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url));
const NOW = '2026-09-11T00:01:00Z';

function fixtureInput() {
  return structuredClone(replay.ledger);
}

test('6E encrypts ledger contents and rejects tampering, wrong keys, and expiry', async () => {
  const ledger = await createLedger(fixtureInput(), { now: NOW, authoritySource: 'USER' });
  const key = crypto.randomBytes(32);
  const token = await sealLedgerToken(ledger, key, { requestId: 'request-open-001', issuedAt: NOW });
  assert.ok(Buffer.byteLength(token, 'utf8') <= LEDGER_SERVER_LIMITS.tokenBytes);
  assert.doesNotMatch(token, /Collect candidates|tenant_fixture_alpha|goal_fixture_places_001/);
  const opened = await openLedgerToken(token, key, { now: NOW });
  assert.deepEqual(opened.ledger, ledger);
  assert.equal(opened.requestId, 'request-open-001');

  const replacement = token.endsWith('A') ? 'B' : 'A';
  await assert.rejects(openLedgerToken(token.slice(0, -1) + replacement, key, { now: NOW }), (error) => error.code === 'INVALID_TOKEN');
  await assert.rejects(openLedgerToken(token, crypto.randomBytes(32), { now: NOW }), (error) => error.code === 'INVALID_TOKEN');
  await assert.rejects(openLedgerToken(token, key, { now: '2026-09-12T00:00:01Z' }), (error) => error.code === 'LEDGER_EXPIRED');
  const expired = await openLedgerToken(token, key, { now: '2026-09-12T00:00:01Z', allowExpired: true });
  assert.equal(expired.ledger.goalId, ledger.goalId);
});

test('6E keeps the persistent head at exactly eight metadata-only columns', () => {
  const definition = migration.match(/create table opera_agent_private\.goal_heads \(([\s\S]*?)\n\);/)?.[1] || '';
  const beforeConstraints = definition.split(/\n\s*primary key/)[0];
  const columns = [...beforeConstraints.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|integer|timestamptz)\b/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ['tenant_id', 'goal_id', 'head_revision', 'head_digest', 'status', 'created_at', 'updated_at', 'expires_at']);
  assert.doesNotMatch(columns.join(','), /objective|constraints|authorizations|claims|evidence|page_text|screenshot|private_url|form_value|credential/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on schema opera_agent_private from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.opera_goal_head_apply[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.opera_goal_head_apply[\s\S]*to service_role/i);
  assert.match(migration, /milestone6_ledger_enabled', 'false'/);
  assert.match(migration, /vault\.create_secret/);
  assert.match(retryFixMigration, /get diagnostics v_inserted = row_count/i);
  assert.match(retryFixMigration, /if v_inserted = 1 then[\s\S]*'replayed', false/i);
  assert.match(retryFixMigration, /revoke all on function public\.opera_goal_head_apply[\s\S]*from public, anon, authenticated/i);
  assert.match(timestampFixMigration, /greatest\(clock_timestamp\(\), p_created_at\)/i);
  assert.match(timestampFixMigration, /updated_at = greatest\(clock_timestamp\(\), v_head\.created_at\)/i);
  assert.doesNotMatch(timestampFixMigration, /updated_at = now\(\)/i);
  assert.match(timestampFixMigration, /revoke all on function public\.opera_goal_head_apply[\s\S]*from public, anon, authenticated/i);
});

test('6E endpoint binds every operation to OAuth user identity and exposes no proof-forging surface', () => {
  assert.match(endpoint, /supabase\.auth\.getUser\(token\)/);
  assert.match(endpoint, /opened\.ledger\.tenantId !== user\.id/);
  assert.match(endpoint, /ledger\.tenantId !== undefined && ledger\.tenantId !== userId/);
  assert.match(endpoint, /ALLOWED_USER_IDS/);
  assert.match(endpoint, /ALLOWED_USER_EMAILS/);
  assert.doesNotMatch(endpoint, /STATIC_TOKEN|evaluateProof|createEvidence/);
  assert.match(endpoint, /requestBytes: 131072|LEDGER_SERVER_LIMITS\.requestBytes/);
  assert.match(endpoint, /RATE_LIMITED/);
  assert.match(endpoint, /operation === "cancel"/);
  assert.match(endpoint, /operation === "expire"/);
  const openSeal = endpoint.indexOf('const token = await sealLedgerToken(ledger, key, { requestId: body.requestId, issuedAt: now });');
  const openApply = endpoint.indexOf('const head = await applyHead(null, ledger);');
  assert.ok(openSeal >= 0 && openSeal < openApply, 'open must validate and seal before persistence');
  assert.match(endpoint, /if \(operation === "inspect"\) \{[\s\S]*await assertCurrentHead\(opened\.ledger\)/);
});

test('6E leaves the existing MCP inventory byte-for-byte unchanged', () => {
  const hash = sha256CanonicalLf(mcpSource);
  assert.equal(contract.toolCount, 22);
  assert.equal(hash, contract.sourceSha256);
  assert.doesNotMatch(mcpSource.toString('utf8'), /opera-agent-ledger|open_goal|revise_goal|evaluate_goal/);
});
