import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migrationUrl=new URL('../supabase/migrations/20260914031000_transaction_operator_fence_8d.sql',import.meta.url);
const edgeUrl=new URL('../supabase/functions/opera-agent-transactions-8d/index.ts',import.meta.url);

test('8D release checks all owned tables inside the exclusive barrier before clearing ownership',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  const release=sql.slice(sql.indexOf('create function public.opera_tx_operator_release_8d'),sql.indexOf('create function public.opera_tx_operator_state_8d'));
  const check=release.indexOf('if exists(');
  assert.ok(release.indexOf('for update')<check);
  assert.ok(check<release.indexOf('set owner_id=null'));
  assert.match(release,/SERVER_FENCE_OWNED_ROWS_REMAIN/);
  for(const table of ['principals','rates','acceptance_bindings','runs','run_identities','run_limits','run_previews','run_challenges','journal','approvals','commit_slots']){
    assert.ok(release.includes(`from opera_agent_tx_candidate.${table} where tenant_id=p_namespace::text`),table);
  }
  assert.ok(release.includes('from opera_agent_private.goal_heads where tenant_id=p_namespace'));
});

test('8D server fence migration is singleton, epoch-fenced, service-only and cleanup-safe',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  assert.match(sql,/create table opera_agent_tx_candidate\.operator_control/);
  assert.match(sql,/set epoch=epoch\+1/);
  assert.match(sql,/for update/);
  assert.match(sql,/for share/);
  assert.match(sql,/lease_until>clock_timestamp\(\)/);
  assert.match(sql,/opera_tx_operator_assert_8d/);
  assert.match(sql,/opera_tx_operator_cleanup_fixture_8d/);
  assert.match(sql,/if v_host or v_mode<>'OFF' or v_legacy or v_agent then raise exception 'SERVER_FENCE_NOT_CLEAN'/);
  assert.match(sql,/revoke execute on function public\.opera_tx_operator_acquire_8d[\s\S]*from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.opera_tx_operator_acquire_8d[\s\S]*to service_role/);
  assert.equal(/grant execute[\s\S]*to (anon|authenticated)/.test(sql),false);
});

test('8D Edge candidate keeps env as master kill switch and checks DB fence before transaction host',async()=>{
  const source=await readFile(edgeUrl,'utf8');
  assert.match(source,/OPERA_AGENT_TRANSACTION_DARK_8D/);
  assert.match(source,/client\.rpc\("opera_tx_operator_host_gate_8d"\)/);
  assert.ok(source.indexOf('opera_tx_operator_host_gate_8d')<source.indexOf('return transactionHost(input,credential)'));
  assert.match(source,/data!==true/);
  assert.match(source,/TRANSACTION_DISABLED/);
  assert.equal(source.includes('browserDispatchAllowed:true'),false);
});
