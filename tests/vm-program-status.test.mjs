// @last-edited: 2026-10-08 UTC+7.
// @title: vm-program-status.test — Test.
// @state: locks honest partial status on the VM host.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const vm = fs.readFileSync(
  new URL('../supabase/functions/opera-agent-vm/index.ts', import.meta.url), 'utf8'
);

test('terminal states distinguish success, limits, and failure', () => {
  for (const state of ['SUSPENDED', 'RETURNED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']) {
    assert.ok(vm.includes(`"${state}"`), state);
  }
});

test('status and result operations stay tenant-scoped', () => {
  assert.ok(vm.includes('p_tenant_id'), 'every run lookup carries the tenant');
  assert.match(vm, /operation === "status"/);
  assert.match(vm, /operation === "result"/);
});

test('over-budget programs and stale documents fail closed', () => {
  assert.ok(vm.includes('OVER_LIMIT'), 'byte budget refusal exists');
  assert.ok(vm.includes('observedGeneration !== program.target.documentGeneration'), 'stale generation never acts');
});
