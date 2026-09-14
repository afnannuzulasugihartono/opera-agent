import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createCloudFixtureData8D } from './helpers/transaction-cloud-fixture-8d.mjs';
import { createManagementOperatorBackend8D, EXPECTED_TRANSACTION_BUNDLE_SHA_8D, TRANSACTION_FUNCTION_8D } from './helpers/transaction-cloud-management-backend-8d.mjs';
import { CALLBACK_8D, PROJECT_REF_8D } from './helpers/transaction-cloud-operator-8d.mjs';
import { CLIENT_ID } from './helpers/transaction-oauth-8d.mjs';

const namespace='12345678-1234-4234-8234-123456789abc';
const userId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sessionId='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const preparedAt='2026-09-14T00:00:00.000Z';
const accessToken='sbp_'+('a'.repeat(40));
const transactionSecret=Buffer.alloc(32,9).toString('base64url');
const unrelatedSecret='unrelated-secret-never-retain';
const ledgerKey=Buffer.alloc(32,7).toString('base64url');
const ownerId='writer_owner_01';

function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
function harness(options={}){
  const state={master:options.master??'true',mode:options.mode??'OFF',rows:options.rows??0,goalRows:options.goalRows??0,calls:[],db:[],secretWrites:[],epoch:0,serverOwner:null,serverNamespace:null,serverHost:false};
  const transactionKey=options.transactionSecret??transactionSecret;
  const assertFence=parameters=>{if(parameters[0]!==state.serverOwner||parameters[1]!==state.serverNamespace||Number(parameters[2])!==state.epoch)throw new Error('stale fence');};
  const fetchImpl=async(url,init={})=>{
    const parsed=new URL(url);state.calls.push({url,method:init.method??'GET'});
    assert.equal(parsed.origin,'https://api.supabase.com');assert.ok(parsed.pathname.startsWith(`/v1/projects/${PROJECT_REF_8D}/`));
    assert.equal(init.headers?.Authorization,`Bearer ${accessToken}`);assert.equal(String(init.headers?.Authorization).includes(transactionSecret),false);
    if(options.failFetch) throw new Error(`network ${transactionKey} ${unrelatedSecret} ${accessToken}`);
    if(parsed.pathname.endsWith('/functions')) return json([{slug:TRANSACTION_FUNCTION_8D,status:'ACTIVE',verify_jwt:true,ezbr_sha256:options.bundle??EXPECTED_TRANSACTION_BUNDLE_SHA_8D,version:7}]);
    if(parsed.pathname.endsWith('/secrets')&&(init.method??'GET')==='GET') return json([{name:'UNRELATED_SECRET',value:unrelatedSecret},{name:'OPERA_AGENT_TRANSACTION_DARK_8D',value:state.master},{name:'OPERA_AGENT_TRANSACTION_KEY_8D',value:transactionKey}]);
    if(parsed.pathname.endsWith('/secrets')&&init.method==='POST'){state.secretWrites.push(JSON.parse(init.body));throw new Error('per-run secret writes forbidden');}
    if(parsed.pathname.endsWith('/database/query')&&init.method==='POST'){
      const body=JSON.parse(init.body);state.db.push(body);const q=body.query,p=body.parameters??[];
      if(q.includes('as synthetic_rows')) return json([{mode:state.mode,legacy_gated:false,agent_commit_enabled:false,ledger_enabled:true,server_owner_id:state.serverOwner,server_host_enabled:state.serverHost,synthetic_rows:state.rows,goal_rows:state.goalRows}]);
      if(q.includes('opera_tx_operator_acquire_8d')){state.epoch+=1;state.serverOwner=p[0];state.serverNamespace=p[1];state.serverHost=false;return json([{epoch:state.epoch}]);}
      if(q.includes('opera_tx_operator_heartbeat_8d')){assertFence(p);return json([{epoch:state.epoch}]);}
      if(q.includes('opera_tx_operator_release_8d')){assertFence(p);if(state.serverHost||state.mode!=='OFF')return json([],400);state.serverOwner=null;state.serverNamespace=null;return json([{released:true}]);}
      if(q.includes('from auth.sessions')) return json([{matches:options.sessionMatches??1}]);
      if(q.includes('insert into opera_agent_tx_candidate.principals')){assertFence([p[13],p[0],p[14]]);state.rows=Math.max(state.rows,3);state.goalRows=Math.max(state.goalRows,1);return json([{principals:1,goals:1,bindings:1}]);}
      if(q==='select public.opera_goal_crypto_key() as crypto') return json([{crypto:{enabled:true,key:ledgerKey}}]);
      if(q.includes('opera_tx_operator_set_host_8d')){assertFence(p);state.serverHost=p[3]===true;return json([{host_enabled:state.serverHost}]);}
      if(q.includes("set mode='DARK'")){assertFence(p);if(!state.serverHost)return json([]);state.mode='DARK';return json([{mode:'DARK',legacy_gated:false,agent_commit_enabled:false}]);}
      if(q.includes("set mode='OFF'")){assertFence(p);state.mode='OFF';return json([{mode:'OFF',legacy_gated:false,agent_commit_enabled:false}]);}
      if(q.includes("coalesce(max(status),'')")) return json([{status:'CANCELLED',payload_rows:0}]);
      if(q.includes('opera_tx_operator_cleanup_fixture_8d')){assertFence(p);if(state.serverHost||state.mode!=='OFF')return json([],400);state.rows=0;state.goalRows=0;return json([{cleaned:true}]);}
      if(q.includes('as owned_rows')){assertFence(p);return json([{host_enabled:state.serverHost,mode:state.mode,legacy_gated:false,agent_commit_enabled:false,owned_rows:state.rows+state.goalRows,payload_rows:0}]);}
      throw new Error('unexpected fixed query');
    }
    throw new Error('unexpected route');
  };
  const backend=createManagementOperatorBackend8D({credentialProvider:async()=>accessToken,fetchImpl,now:()=>Date.parse(preparedAt)+1000});
  return {backend,state};
}

async function fixture(){return createCloudFixtureData8D({namespace,userId,preparedAt});}
async function acquire(backend){const {epoch}=await backend.acquireFence({ownerId,namespace,ttlMs:180000});return {ownerId,namespace,epoch};}

test('8D management backend exposes only fixed fenced methods and a pinned target',async()=>{
  const {backend}=harness();
  assert.deepEqual(Object.keys(backend).sort(),['acquireFence','cleanupFixture','describe','disableHost','enableHost','heartbeatFence','insertFixture','preflight','releaseFence','sealLedger','setDark','setOff','verifyCancelled','verifyClean','verifySession'].sort());
  assert.deepEqual(await backend.describe(),{projectRef:PROJECT_REF_8D,clientId:CLIENT_ID,callback:CALLBACK_8D});
});

test('8D management preflight requires fenced Edge pin/master, OFF policy, idle server fence and valid crypto',async()=>{
  const {backend,state}=harness();assert.equal(EXPECTED_TRANSACTION_BUNDLE_SHA_8D,'0'.repeat(64));
  assert.deepEqual(await backend.preflight(namespace),{hostFlag:false,mode:'OFF',ledgerEnabled:true,agentCommitEnabled:false,legacyGated:false,namespaceEmpty:true,locksVerified:true});
  const query=state.db.find(item=>item.query.includes('as synthetic_rows'));assert.equal(query.read_only,true);assert.deepEqual(query.parameters,[namespace]);
  await assert.rejects(harness({bundle:'wrong'}).backend.preflight(namespace),/8D_HOST_BUNDLE_MISMATCH/);
  await assert.rejects(harness({master:'false'}).backend.preflight(namespace),/8D_HOST_MASTER_NOT_ENABLED/);
  await assert.rejects(harness({transactionSecret:'present-but-not-a-32-byte-key'}).backend.preflight(namespace),/8D_TRANSACTION_KEY_INVALID/);
  const occupied=harness();occupied.state.serverOwner='other_owner_01';await assert.rejects(occupied.backend.preflight(namespace),/8D_PREFLIGHT_STATE_INVALID/);
  assert.equal((await harness({rows:1}).backend.preflight(namespace)).namespaceEmpty,false);
});

test('8D management fence acquire/heartbeat/release is fixed, parameterized and epoch-bound',async()=>{
  const {backend,state}=harness();const fence=await acquire(backend);assert.deepEqual(fence,{ownerId,namespace,epoch:1});
  assert.deepEqual(await backend.heartbeatFence({...fence,ttlMs:180000}),{epoch:1});
  assert.deepEqual(await backend.releaseFence(fence),{released:true});assert.equal(state.serverOwner,null);assert.equal(state.serverHost,false);
  const queries=state.db.filter(item=>item.query.includes('opera_tx_operator_'));
  assert.deepEqual(queries[0].parameters,[ownerId,namespace,180000]);assert.deepEqual(queries[1].parameters,[ownerId,namespace,1,180000]);assert.deepEqual(queries[2].parameters,[ownerId,namespace,1]);
});

test('8D management session check is exact and parameterized before provisioning',async()=>{
  const {backend,state}=harness();const input={userId,clientId:CLIENT_ID,sessionId};assert.deepEqual(await backend.verifySession(input),{exists:true,...input});
  const query=state.db.find(item=>item.query.includes('from auth.sessions'));assert.equal(query.query.includes(userId),false);assert.deepEqual(query.parameters,[userId,CLIENT_ID,sessionId]);assert.equal(query.read_only,true);
  assert.equal((await harness({sessionMatches:0}).backend.verifySession(input)).exists,false);
});

test('8D management provisioning is insert-only and carries exact server fence in the same SQL statement',async()=>{
  const f=await fixture();const {backend,state}=harness();const fence=await acquire(backend);assert.deepEqual(await backend.insertFixture(f,fence),{inserted:true});
  const query=state.db.find(item=>item.query.includes('insert into opera_agent_tx_candidate.principals'));assert.ok(query);assert.ok(query.query.includes('opera_tx_operator_assert_8d'));assert.equal(query.query.includes('on conflict'),false);assert.equal(query.query.includes(namespace),false);assert.equal(query.query.includes(f.cleanup.actorId),false);
  assert.equal(query.parameters[0],namespace);assert.equal(query.parameters[11],f.cleanup.transactionId);assert.equal(query.parameters[13],ownerId);assert.equal(query.parameters[14],fence.epoch);
  await assert.rejects(backend.insertFixture({...f,cleanup:{...f.cleanup,transactionId:'other'}},fence),/INVALID_8D_FIXTURE/);
});

test('8D management ledger sealing uses existing crypto only in memory and returns bounded ciphertext',async()=>{
  const f=await fixture();const {backend,state}=harness();const token=await backend.sealLedger(f.ledger);
  assert.match(token,/^oal1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);assert.equal(token.includes(ledgerKey),false);assert.equal(JSON.stringify(state.calls).includes(ledgerKey),false);assert.equal(JSON.stringify(state.db).includes(ledgerKey),false);
  const query=state.db.find(item=>item.query==='select public.opera_goal_crypto_key() as crypto');assert.equal(query.read_only,true);
});

test('8D management host control is DB-fenced and never performs per-run project secret writes',async()=>{
  const {backend,state}=harness();const fence=await acquire(backend);assert.deepEqual(await backend.enableHost(fence),{hostFlag:true});assert.equal(state.serverHost,true);assert.deepEqual(await backend.disableHost(fence),{hostFlag:false});assert.equal(state.serverHost,false);
  assert.deepEqual(state.secretWrites,[]);const hostQueries=state.db.filter(item=>item.query.includes('opera_tx_operator_set_host_8d'));assert.deepEqual(hostQueries.map(item=>item.parameters),[[ownerId,namespace,1,true],[ownerId,namespace,1,false]]);
});

test('8D management DARK/OFF mutations carry the fence and never grant agent commit',async()=>{
  const f=await fixture();const {backend,state}=harness();const fence=await acquire(backend);await backend.enableHost(fence);assert.deepEqual(await backend.setDark(fence),{mode:'DARK'});assert.equal(state.mode,'DARK');
  assert.deepEqual(await backend.verifyCancelled(f.cleanup),{status:'CANCELLED',payloadRows:0});assert.deepEqual(await backend.setOff(fence),{mode:'OFF'});assert.equal(state.mode,'OFF');
  for(const call of state.db.filter(item=>item.query.includes('set mode='))){assert.ok(call.query.includes('opera_tx_operator_assert_8d'));assert.equal(call.query.includes('agent_commit_enabled=true'),false);assert.deepEqual(call.parameters,[ownerId,namespace,1]);}
});

test('8D management cleanup is one fenced server operation and clean verification is epoch-bound',async()=>{
  const f=await fixture();const {backend,state}=harness({rows:1,goalRows:1});const fence=await acquire(backend);await backend.cleanupFixture(f.cleanup,fence);
  const cleanupQuery=state.db.find(item=>item.query.includes('opera_tx_operator_cleanup_fixture_8d'));assert.deepEqual(cleanupQuery.parameters,[ownerId,namespace,1,f.cleanup.actorId,f.cleanup.goalId,f.cleanup.transactionId]);
  assert.deepEqual(await backend.verifyClean(f.cleanup,fence),{hostFlag:false,mode:'OFF',ownedRows:0,payloadRows:0,agentCommitEnabled:false,legacyGated:false});
  const cleanQuery=state.db.find(item=>item.query.includes('as owned_rows'));assert.ok(cleanQuery.query.includes('opera_tx_operator_assert_8d'));assert.deepEqual(cleanQuery.parameters,[ownerId,namespace,1]);
  await assert.rejects(backend.cleanupFixture({...f.cleanup,transactionId:'bad/slash'},fence),/INVALID_8D_CLEANUP_SCOPE/);
});

test('8D management failures redact operator credentials and remote secret text',async()=>{
  const {backend}=harness({failFetch:true});let error;try{await backend.preflight(namespace);}catch(e){error=e;}
  assert.equal(error?.message,'8D_MANAGEMENT_REQUEST_FAILED');assert.equal(error.message.includes(accessToken),false);assert.equal(error.message.includes(transactionSecret),false);assert.equal(error.message.includes(unrelatedSecret),false);
});
