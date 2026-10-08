// @last-edited: 2026-10-09 UTC+7.
// @title: skills-rpc.test — Test.
// @state: pins the skill save/recall RPC migration text: names, ILIKE escape, clamps, service_role-only grants.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261009000004_opera_agent_skill_memory_rpcs.sql', import.meta.url), 'utf8'
);

test('both skill RPCs exist and reject empty input', () => {
  assert.ok(migration.includes('opera_skill_save'), 'opera_skill_save missing');
  assert.ok(migration.includes('opera_skill_recall'), 'opera_skill_recall missing');
  assert.ok(migration.includes('INVALID_INPUT'), 'empty task/lesson must be refused with INVALID_INPUT');
});

test('recall matches case-insensitively with an escaped LIKE pattern', () => {
  assert.match(migration, /ILIKE/i);
  assert.match(migration, /ESCAPE/i);
});

test('RPCs are revoked from clients and granted to service_role only', () => {
  assert.match(migration, /revoke all on function public\.opera_skill_save\(text,text,text,text\) from public,anon,authenticated/);
  assert.match(migration, /revoke all on function public\.opera_skill_recall\(text,text,integer\) from public,anon,authenticated/);
  const grantLines = migration.split('\n').filter((l) => /^\s*grant\s/i.test(l));
  assert.equal(grantLines.length, 2, 'exactly two grants');
  for (const l of grantLines) assert.match(l, /to service_role;/);
});

test('save clamps field lengths instead of erroring', () => {
  for (const n of ['500', '4000', '2000', '120']) assert.ok(migration.includes(n), `clamp literal ${n} missing`);
  assert.match(migration, /left\(/);
});

test('recall clamps the limit', () => {
  assert.ok(/least\s*\(\s*greatest/.test(migration) || /1\.\.20/.test(migration), 'limit clamp missing');
  assert.ok(migration.includes('20'), 'limit ceiling 20 missing');
});
