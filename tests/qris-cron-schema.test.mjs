// @last-edited: 2026-11-04 UTC+7.
// @title: qris-cron-schema — the scheduled detector keeps its token out of git and its schedule sane.
// @state: the migration text read as the shape a deploy creates: a vault-read cron function closed to browsers, and one five-minute schedule.
// @dependencies: node:test, node:assert/strict, node:fs.

// WHY THIS GATE READS THE MIGRATION.
// CI has no Postgres, so what can still be proved here is the text: a token written into a migration would be in git forever, and a schedule without a bound would hammer the feed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const sql = fs.readFileSync(new URL('supabase/migrations/20261104130000_opera_qris_detect_cron.sql', root), 'utf8');

test('the cron function reads the operator token from vault, never from the file', () => {
  assert.match(sql, /vault\.decrypted_secrets/, 'the token is read from vault');
  assert.match(sql, /name = 'opera_billing_token'/, 'the vault entry is named');
  assert.doesNotMatch(sql, /Bearer [A-Za-z0-9_-]{16,}/, 'no token literal is in the migration');
  assert.match(sql, /opera_billing_token is not in vault/, 'without the vault entry the job moves nothing');
});

test('the cron function is server-only and posts only the detect action', () => {
  assert.match(sql, /revoke all on function public\.opera_qris_detect_cron\(\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.opera_qris_detect_cron\(\) to service_role/);
  assert.match(sql, /jsonb_build_object\('action', 'qris-detect'\)/, 'the scheduled call is the detect action and nothing else');
});

test('one schedule, every five minutes, named so it can be found in cron.job', () => {
  const schedules = [...sql.matchAll(/cron\.schedule\('([^']+)', '([^']+)'/g)];
  assert.equal(schedules.length, 1, 'exactly one schedule is created');
  assert.equal(schedules[0][1], 'opera-qris-detect');
  assert.equal(schedules[0][2], '*/5 * * * *');
});
