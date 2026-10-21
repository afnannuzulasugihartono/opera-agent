// @last-edited: 2026-10-21 UTC+7.
// @title: vm-program-rpc.test — the program-run RPCs are EXECUTE-only and stay with their owner.
// @state: the grants, the row-level security, and the tenant the run belongs to.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const body = fs.readdirSync(dir)
  .filter((n) => /vm/i.test(n))
  .map((n) => fs.readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8'))
  .join('\n');

const RPCS = ['opera_vm_enqueue', 'opera_vm_get', 'opera_vm_cancel'];

function definitionsOf(fn) {
  return body
    .split(/(?=create\s+(?:or\s+replace\s+)?function\s+)/i)
    .filter((s) => new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fn}\\b`, 'i').test(s));
}

test('program-run RPCs grant EXECUTE only, never table grants', () => {
  for (const fn of RPCS) {
    assert.ok(body.includes(fn), `${fn} must exist`);
    assert.match(body, new RegExp(`grant execute on function public\\.${fn}`, 'i'), `${fn} must grant EXECUTE`);
    assert.match(
      body,
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}[^;]*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'),
      `${fn} must revoke ALL from client roles`
    );
    assert.doesNotMatch(
      body,
      new RegExp(`grant\\s+execute[^;]*public\\.${fn}[^;]*\\bto\\b[^;]*\\b(public|anon|authenticated)\\b`, 'i'),
      `${fn} must grant EXECUTE to no client role`
    );
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
  for (const fn of RPCS) {
    const defs = definitionsOf(fn);
    assert.ok(defs.length > 0, `${fn} must have a CREATE FUNCTION body`);
    for (const d of defs) {
      assert.match(d, /where[^;]*p_tenant_id/i, `${fn} must scope rows by p_tenant_id`);
    }
  }
});
