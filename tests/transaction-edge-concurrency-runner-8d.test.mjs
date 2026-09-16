import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectEdgeRoutingEvidence8D } from './helpers/transaction-edge-routing-evidence-8d.mjs';

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
  assert.match(source,/collectEdgeRoutingEvidence8D/);
  assert.match(source,/distinctRoutingTraces/);
  assert.match(source,/traceHeader/);
  assert.match(source,/prepareWinners/);
  assert.match(source,/cancelWinners/);
  assert.match(source,/browserDispatchAllowed:false/);
  assert.match(source,/secretsPrinted:false/);
  assert.match(source,/nenmkmtvjremqphfqnfw/);
  assert.doesNotMatch(source,/click_element|fill_element|open_url|navigate_tab|run_browser_burst/);
  assert.doesNotMatch(source,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test('8D Edge routing evidence accepts distinct allowlisted traces without exposing raw values',()=>{
  const responses=Array.from({length:8},(_,index)=>({
    headers:new Headers({
      'cf-ray':`trace-${index}`,
      'x-sb-edge-region':'ap-southeast-1',
      'server-timing':`edge;dur=${index+1}`
    })
  }));
  const evidence=collectEdgeRoutingEvidence8D(responses);
  assert.equal(evidence.traceHeader,'cf-ray');
  assert.equal(evidence.distinctRoutingTraces,8);
  assert.equal(evidence.samples,8);
  assert.equal(evidence.regionHeader,'x-sb-edge-region');
  assert.equal(evidence.distinctRegions,1);
  const serialized=JSON.stringify(evidence);
  assert.doesNotMatch(serialized,/trace-0|trace-7|ap-southeast-1/);
});

test('8D Edge routing evidence fails closed when distinct request traces are not evidenced',()=>{
  const responses=Array.from({length:8},()=>({headers:new Headers({'cf-ray':'same-trace','x-sb-edge-region':'ap-southeast-1'})}));
  assert.throws(()=>collectEdgeRoutingEvidence8D(responses),/8D_EDGE_WORKER_TRACE_EVIDENCE_MISSING/);
  assert.throws(()=>collectEdgeRoutingEvidence8D(Array.from({length:8},()=>({headers:new Headers()}))),/8D_EDGE_WORKER_TRACE_EVIDENCE_MISSING/);
});

test('8D real Edge concurrency launcher reuses local DPAPI credential, resolves pinned npm imports, and fails closed on dirty worktree',async()=>{
  const launcher=await readFile(launcherUrl,'utf8');
  const cmd=await readFile(cmdUrl,'utf8');
  assert.match(launcher,/management-token\.dpapi/);
  assert.match(launcher,/git status --porcelain/);
  assert.match(launcher,/git merge --ff-only/);
  assert.match(launcher,/transaction-edge-concurrency-8d\.mjs/);
  assert.match(launcher,/--node-modules-dir=auto/);
  assert.doesNotMatch(launcher,/\b(?:deno|npm|pnpm|yarn)\s+install\b/i);
  assert.match(launcher,/OPERA_8D_MANAGEMENT_TOKEN = \$null/);
  assert.match(launcher,/OPERA_8D_PUBLISHABLE_KEY = \$null/);
  assert.match(cmd,/pwsh\.exe/i);
  assert.doesNotMatch(cmd,/powershell\.exe/i);
});

test('8D launcher brackets exactly one live probe with a fixed static-master secret and fail-closed restore',async()=>{
  const launcher=await readFile(launcherUrl,'utf8');
  assert.match(launcher,/\[switch\]\$RestoreMasterOnly/);
  assert.match(launcher,/\$MasterSecretName\s*=\s*'OPERA_AGENT_TRANSACTION_DARK_8D'/);
  assert.match(launcher,/https:\/\/api\.supabase\.com\/v1\/projects\/\$ProjectRef\/secrets/);
  assert.match(launcher,/function Set-StaticMasterValue/);
  assert.match(launcher,/function Restore-StaticMasterFalse/);
  assert.match(launcher,/Set-StaticMasterValue[^\n]*-Value 'true'/);
  assert.match(launcher,/Set-StaticMasterValue[^\n]*-Value 'false'/);
  assert.match(launcher,/finally\s*\{[\s\S]*Restore-StaticMasterFalse/);
  assert.match(launcher,/for\s*\(\$attempt\s*=\s*1;\s*\$attempt\s*-le\s*3;/);
  assert.match(launcher,/StatusCode[^\n]*201/);
  assert.match(launcher,/ConvertTo-Json/);
  assert.match(launcher,/ConvertTo-Json\s+-InputObject\s+@\(/);
  assert.doesNotMatch(launcher,/@\([^\n]*\)\s*\|\s*ConvertTo-Json/);
  assert.doesNotMatch(launcher,/-Method\s+(?:Get|Delete)/i);
  assert.doesNotMatch(launcher,/reveal\s*=|\breveal\b/i);
  assert.doesNotMatch(launcher,/Write-(?:Host|Output)[^\n]*(?:\$Credential|\$token)/i);
});
