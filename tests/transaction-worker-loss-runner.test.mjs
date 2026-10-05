// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-worker-loss-runner.test — worker-loss-runner.test — Test.
// @state: drop the milestone suffix from transaction test files and titles.
// @dependencies: node:test, strict, promises.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runnerUrl=new URL('./cloud/transaction-worker-loss.mjs',import.meta.url);
const launcherUrl=new URL('../scripts/run-transaction-worker-loss.ps1',import.meta.url);
const cmdUrl=new URL('../scripts/legacy/run-transaction-worker-loss.cmd',import.meta.url);

test('hosted child-worker-loss runner is bounded, recoverable, and has no browser/OAuth surface',async()=>{
  const source=await readFile(runnerUrl,'utf8');
  assert.match(source,/OPERA_MANAGEMENT_TOKEN/);
  assert.match(source,/api\.supabase\.com/);
  assert.match(source,/nenmkmtvjremqphfqnfw/);
  assert.match(source,/Deno\.Command/);
  assert.match(source,/--child-crash/);
  assert.match(source,/--recover/);
  assert.match(source,/STALE_LEASE/);
  assert.match(source,/commit_slots/);
  assert.match(source,/consumed_at/);
  assert.match(source,/browserDispatchAllowed:false/);
  assert.match(source,/finally/);
  assert.doesNotMatch(source,/OPERA_PUBLISHABLE_KEY/);
  assert.doesNotMatch(source,/transaction-oauth/i);
  assert.doesNotMatch(source,/click_element|fill_element|open_url|navigate_tab|run_browser_burst/);
});

test('hosted child-worker-loss runner accepts only bounded CLI modes',async()=>{
  const {parseWorkerLossArgs}=await import('./cloud/transaction-worker-loss.mjs');
  assert.deepEqual(parseWorkerLossArgs([]),{mode:'run'});
  assert.deepEqual(parseWorkerLossArgs(['--child-crash']),{mode:'child-crash'});
  const namespace='123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(parseWorkerLossArgs(['--recover',namespace]),{mode:'recover',namespace});
  assert.throws(()=>parseWorkerLossArgs(['--recover','bad']),/INVALID_8D_WORKER_LOSS_ARGUMENTS/);
  assert.throws(()=>parseWorkerLossArgs(['--child-crash','extra']),/INVALID_8D_WORKER_LOSS_ARGUMENTS/);
});

test('worker-loss launcher reuses DPAPI credential, fast-forwards safely, and uses PowerShell 7 entrypoint',async()=>{
  const launcher=await readFile(launcherUrl,'utf8');
  const cmd=await readFile(cmdUrl,'utf8');
  assert.match(launcher,/management-token\.dpapi/);
  assert.match(launcher,/git merge --ff-only/);
  assert.match(launcher,/transaction-worker-loss\.mjs/);
  assert.match(launcher,/--allow-run/);
  assert.match(launcher,/OPERA_MANAGEMENT_TOKEN = \$null/);
  assert.doesNotMatch(launcher,/OPERA_PUBLISHABLE_KEY/);
  assert.match(cmd,/pwsh\.exe/i);
  assert.doesNotMatch(cmd,/powershell\.exe/i);
});
