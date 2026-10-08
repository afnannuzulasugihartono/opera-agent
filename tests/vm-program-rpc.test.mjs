// @last-edited: 2026-10-08 UTC+7.
// @title: vm-program-rpc.test — Test.
// @state: locks EXECUTE-only grants plus owner RLS on program-run RPCs.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const body = fs.readdirSync(dir)
  .filter((n) => /vm/i.test(n))
  .map((n) => fs.readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8'))
  .join('\n');

test('program-run RPCs grant EXECUTE only, never table grants', () => {
  for (const fn of ['opera_vm_enqueue', 'opera_vm_get', 'opera_vm_cancel']) {
    assert.ok(body.includes(fn), `${fn} must exist`);
    assert.match(body, new RegExp(`grant execute on function public\\.${fn}`, 'i'), `${fn} must grant EXECUTE`);
  }
  for (const table of ['vm_runs', 'vm_effects', 'vm_rate_windows']) {
    assert.doesNotMatch(
      body,
      new RegExp(`grant\\s[^;]*on\\s+(table\\s+)?opera_agent_private\\.${table}\\s+to\\s+(public|anon|authenticated)`, 'i'),
      `${table} must grant no table rights to client roles`
    );
  }
});

test('program runs are filtered by owning tenant', () => {
  assert.match(body, /p_tenant_id/);
  assert.match(body, /row level security|create policy/i);
});
