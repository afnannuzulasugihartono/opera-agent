import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../supabase/functions/opera-agent-vm/index.ts', import.meta.url),
  'utf8',
);
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260912061541_opera_agent_reactive_vm_host.sql', import.meta.url),
  'utf8',
);

test('7E Edge host fails closed on tenant, target, tab, goal, and document generations', () => {
  assert.match(source, /candidate\.tenantId\s*!==\s*tenantId/);
  assert.match(source, /HostError\("CROSS_TENANT"/);
  assert.match(source, /HostError\("GOAL_REVISED"/);
  assert.match(source, /HostError\("STALE_TARGET"/);
  assert.match(source, /HostError\("CROSS_TAB"/);
  assert.match(source, /extractDocumentGeneration\(awaited\.result\)/);
  assert.match(source, /observedGeneration\s*!==\s*program\.target\.documentGeneration/);
  assert.match(source, /errorCode:\s*"STALE_DOCUMENT"/);
  assert.match(source, /\["GOAL_REVISED",\s*"STALE_TARGET",\s*"STALE_DOCUMENT",\s*"MISSING_AUTHORITY",\s*"CROSS_TAB"\]/);
});

test('7E authority remains OAuth-allowlisted and storage RPCs remain service-role only', () => {
  assert.match(source, /auth\.getUser\(token\)/);
  assert.match(source, /ALLOWED_USER_IDS\.size\s*===\s*0\s*&&\s*ALLOWED_USER_EMAILS\.size\s*===\s*0/);
  assert.match(source, /if \(!user\) return response\(\{ ok: false, error: \{ code: "UNAUTHORIZED" \} \}, 401\)/);
  assert.match(source, /p_tenant_id:\s*user\.id/);
  assert.match(migration, /revoke all on function public\.opera_vm_get\(uuid,uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.opera_vm_get\(uuid,uuid\) to service_role/i);
  assert.match(migration, /revoke all on schema opera_agent_private from public, anon, authenticated/i);
  assert.match(migration, /grant usage on schema opera_agent_private to service_role/i);
});
