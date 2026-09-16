import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runnerUrl=new URL('./cloud/transaction-edge-concurrency-8d.mjs',import.meta.url);
const launcherUrl=new URL('../scripts/run-8d-edge-concurrency.ps1',import.meta.url);
const cmdUrl=new URL('../RUN_8D_EDGE_CONCURRENCY.cmd',import.meta.url);

test('8D real Edge concurrency runner is fixed, authenticated, bounded, and browser-dispatch free',async()=>{
  const source=await readFile(runnerUrl,'utf8');
  assert.match(source,/createCloudAcceptanceController8D/);
  assert.match(source,/createOAuthProbe/);
  assert.match(source,/CONCURRENCY_8D\s*=\s*8/);
  assert.match(source,/Promise\.all/);
  assert.match(source,/operation\s*===\s*['"]prepare['"]/);
  assert.match(source,/operation\s*===\s*['"]cancel['"]/);
  assert.match(source,/prepareWinners/);
  assert.match(source,/cancelWinners/);
  assert.match(source,/browserDispatchAllowed:false/);
  assert.match(source,/secretsPrinted:false/);
  assert.match(source,/nenmkmtvjremqphfqnfw/);
  assert.doesNotMatch(source,/click_element|fill_element|open_url|navigate_tab|run_browser_burst/);
  assert.doesNotMatch(source,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test('8D real Edge concurrency launcher reuses local DPAPI credential and fails closed on dirty worktree',async()=>{
  const launcher=await readFile(launcherUrl,'utf8');
  const cmd=await readFile(cmdUrl,'utf8');
  assert.match(launcher,/management-token\.dpapi/);
  assert.match(launcher,/git status --porcelain/);
  assert.match(launcher,/git merge --ff-only/);
  assert.match(launcher,/transaction-edge-concurrency-8d\.mjs/);
  assert.match(launcher,/OPERA_8D_MANAGEMENT_TOKEN = \$null/);
  assert.match(launcher,/OPERA_8D_PUBLISHABLE_KEY = \$null/);
  assert.match(cmd,/pwsh\.exe/i);
  assert.doesNotMatch(cmd,/powershell\.exe/i);
});
