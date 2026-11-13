// @last-edited: 2026-11-04 UTC+7.
// @title: qris-billing-guard — one provider transaction closes one invoice, and the operator token reaches vault without a human paste.
// @state: the migration text read as the shape a deploy creates: a unique index over provider transaction ids, and one secret-writing function closed to browsers.
// @dependencies: node:test, node:assert/strict, node:fs.

// WHY THIS GATE READS THE MIGRATION.
// CI has no Postgres, so what can still be proved here is the text: a second invoice may never carry the same transaction id, and the function that writes secrets may not be callable from a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const sql = fs.readFileSync(new URL('hosted/migrations/20261104140000_opera_billing_guard.sql', root), 'utf8');
const fn = fs.readFileSync(new URL('hosted/functions/opera-agent-billing/index.ts', root), 'utf8');

test('one provider transaction id can sit on one invoice only', () => {
  assert.match(sql, /create unique index if not exists opera_invoices_provider_transaction_id_idx/, 'the index is created');
  assert.match(sql, /on public\.opera_invoices \(provider_transaction_id\)/, 'the index is on the transaction id');
  assert.match(sql, /where provider_transaction_id is not null/, 'rows without a transaction do not collide');
});

test('the secret writer is closed to browsers and open to the server role', () => {
  assert.match(sql, /revoke all on function public\.opera_vault_put\(text, text, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.opera_vault_put\(text, text, text\) to service_role/);
  assert.match(sql, /security definer/, 'the function writes to vault, which the caller may not do by itself');
});

test('the secret writer updates an existing entry and creates a missing one', () => {
  assert.match(sql, /select id into v_id from vault\.decrypted_secrets where name = p_name/, 'the existing entry is found by name');
  assert.match(sql, /vault\.update_secret\(v_id, p_secret, p_name, p_description\)/);
  assert.match(sql, /vault\.create_secret\(p_secret, p_name, p_description\)/);
  assert.match(sql, /a secret needs a name and a value/, 'an empty secret is refused');
  assert.doesNotMatch(sql, /Bearer [A-Za-z0-9_-]{16,}/, 'no secret literal is in the migration');
});

test('the function publishes the operator token into vault on its first request', () => {
  assert.match(fn, /publishOperatorToken\(\)/, 'the request handler arms the schedule');
  assert.match(fn, /rpc\("opera_vault_put"/, 'the token is written through the guarded function');
  assert.match(fn, /p_name: "opera_billing_token"/, 'the cron reads that name');
});
