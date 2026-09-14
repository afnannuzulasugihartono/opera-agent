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

function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
function harness(options={}){
  const state={host:options.host??'false',mode:options.mode??'OFF',rows:options.rows??0,goalRows:options.goalRows??0,calls:[],db:[],secretWrites:[]};
  const transactionKey=options.transactionSecret??transactionSecret;
  const fetchImpl=async(url,init={})=>{
    const parsed=new URL(url);state.calls.push({url,method:init.method??'GET'});
    assert.equal(parsed.origin,'https://api.supabase.com');assert.ok(parsed.pathname.startsWith(`/v1/projects/${PROJECT_REF_8D}/`));
    assert.equal(init.headers?.Authorization,`Bearer ${accessToken}`);assert.equal(String(init.headers?.Authorization).includes(transactionSecret),false);
    if(options.failFetch) throw new Error(`network ${transactionKey} ${unrelatedSecret} ${accessToken}`);
    if(parsed.pathname.endsWith('/functions')) return json([{slug:TRANSACTION_FUNCTION_8D,status:'ACTIVE',verify_jwt:true,ezbr_sha256:options.bundle??EXPECTED_TRANSACTION_BUNDLE_SHA_8D,version:6}]);
    if(parsed.pathname.endsWith('/secrets')&&(init.method??'GET')==='GET') return json([{name:'UNRELATED_SECRET',value:unrelatedSecret},{name:'OPERA_AGENT_TRANSACTION_DARK_8D',value:state.host},{name:'OPERA_AGENT_TRANSACTION_KEY_8D',value:transactionKey}]);
    if(parsed.pathname.endsWith('/secrets')&&init.method==='POST'){
      const body=JSON.parse(init.body);state.secretWrites.push(body);assert.deepEqual(Object.keys(body[0]).sort(),['name','value']);assert.equal(body[0].name,'OPERA_AGENT_TRANSACTION_DARK_8D');state.host=body[0].value;return json({});
    }
    if(parsed.pathname.endsWith('/database/query')&&init.method==='POST'){
      const body=JSON.parse(init.body);state.db.push(body);const q=body.query;
      if(q.includes('as synthetic_rows')) return json([{mode:state.mode,legacy_gated:false,agent_commit_enabled:false,ledger_enabled:true,synthetic_rows:state.rows,goal_rows:state.goalRows}]);
      if(q.includes('from auth.sessions')) return json([{matches:options.sessionMatches??1}]);
      if(q.startsWith('with p as')) return json([{principals:1,goals:1,bindings:1}]);
      if(q==='select public.opera_goal_crypto_key() as crypto') return json([{crypto:{enabled:true,key:ledgerKey}}]);
      if(q.includes("set mode='DARK'")){state.mode='DARK';return json([{mode:'DARK',legacy_gated:false,agent_commit_enabled:false}]);}
      if(q.includes("set mode='OFF'")){state.mode='OFF';return json([{mode:'OFF',legacy_gated:false,agent_commit_enabled:false}]);}
      if(q.includes("coalesce(max(status),'')")) return json([{status:'CANCELLED',payload_rows:0}]);
      if(q.includes('as owned_rows')) return json([{mode:state.mode,legacy_gated:false,agent_commit_enabled:false,owned_rows:state.rows,payload_rows:0}]);
      if(q.startsWith('delete from ')){state.rows=0;return json([]);}
      throw new Error('unexpected fixed query');
    }
    throw new Error('unexpected route');
  };
  const backend=createManagementOperatorBackend8D({credentialProvider:async()=>accessToken,fetchImpl,now:()=>Date.parse(preparedAt)+1000});
  return {backend,state};
}

async function fixture(){return createCloudFixtureData8D({namespace,userId,preparedAt});}

test('8D management backend exposes only fixed operator methods and a pinned target',async()=>{
  const {backend}=harness();
  assert.deepEqual(Object.keys(backend).sort(),['cleanupFixture','describe','disableHost','enableHost','insertFixture','preflight','sealLedger','setDark','setOff','verifyCancelled','verifyClean','verifySession'].sort());
  assert.deepEqual(await backend.describe(),{projectRef:PROJECT_REF_8D,clientId:CLIENT_ID,callback:CALLBACK_8D});
});

test('8D management preflight pins exact bundle hash, host OFF, policy OFF, valid transaction crypto and zero synthetic rows',async()=>{
  const {backend,state}=harness();
  assert.deepEqual(await backend.preflight(namespace),{hostFlag:false,mode:'OFF',ledgerEnabled:true,agentCommitEnabled:false,legacyGated:false,namespaceEmpty:true,locksVerified:true});
  const query=state.db.find(item=>item.query.includes('as synthetic_rows'));assert.equal(query.read_only,true);assert.deepEqual(query.parameters,[namespace]);
  const badBundle=harness({bundle:'wrong'}).backend;await assert.rejects(badBundle.preflight(namespace),/8D_HOST_BUNDLE_MISMATCH/);
  const hostOn=harness({host:'true'}).backend;await assert.rejects(hostOn.preflight(namespace),/8D_HOST_NOT_OFF/);
  const invalidKey=harness({transactionSecret:'present-but-not-a-32-byte-key'}).backend;await assert.rejects(invalidKey.preflight(namespace),/8D_TRANSACTION_KEY_INVALID/);
  const dirty=harness({rows:1}).backend;assert.equal((await dirty.preflight(namespace)).namespaceEmpty,false);
});

test('8D management session check is exact and parameterized before provisioning',async()=>{
  const {backend,state}=harness();const input={userId,clientId:CLIENT_ID,sessionId};
  assert.deepEqual(await backend.verifySession(input),{exists:true,...input});
  const query=state.db.find(item=>item.query.includes('from auth.sessions'));assert.equal(query.query.includes(userId),false);assert.deepEqual(query.parameters,[userId,CLIENT_ID,sessionId]);assert.equal(query.read_only,true);
  assert.equal((await harness({sessionMatches:0}).backend.verifySession(input)).exists,false);
});

test('8D management provisioning is insert-only, fixed SQL and cannot interpolate fixture identifiers',async()=>{
  const f=await fixture();const {backend,state}=harness();assert.deepEqual(await backend.insertFixture(f),{inserted:true});
  const query=state.db.find(item=>item.query.startsWith('with p as'));assert.ok(query);assert.equal(query.query.includes('on conflict'),false);assert.equal(query.query.includes(namespace),false);assert.equal(query.query.includes(f.cleanup.actorId),false);assert.equal(query.parameters[0],namespace);assert.equal(query.parameters[1],f.cleanup.actorId);assert.equal(query.parameters[11],f.cleanup.transactionId);
  await assert.rejects(backend.insertFixture({...f,cleanup:{...f.cleanup,transactionId:'other'}}),/INVALID_8D_FIXTURE/);
});

test('8D management ledger sealing uses existing crypto only in memory and returns bounded ciphertext',async()=>{
  const f=await fixture();const {backend,state}=harness();const token=await backend.sealLedger(f.ledger);
  assert.match(token,/^oal1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);assert.equal(token.includes(ledgerKey),false);assert.equal(JSON.stringify(state.calls).includes(ledgerKey),false);assert.equal(JSON.stringify(state.db).includes(ledgerKey),false);
  const query=state.db.find(item=>item.query==='select public.opera_goal_crypto_key() as crypto');assert.equal(query.read_only,true);
});

test('8D management host control can mutate only the one pinned host flag and verifies settlement',async()=>{
  const {backend,state}=harness();assert.deepEqual(await backend.enableHost(),{hostFlag:true});assert.equal(state.host,'true');assert.deepEqual(await backend.disableHost(),{hostFlag:false});assert.equal(state.host,'false');
  assert.deepEqual(state.secretWrites,[[{name:'OPERA_AGENT_TRANSACTION_DARK_8D',value:'true'}],[{name:'OPERA_AGENT_TRANSACTION_DARK_8D',value:'false'}]]);
});

test('8D management DARK/OFF and cancellation checks remain fixed and never grant agent commit',async()=>{
  const f=await fixture();const {backend,state}=harness();assert.deepEqual(await backend.setDark(),{mode:'DARK'});assert.equal(state.mode,'DARK');
  assert.deepEqual(await backend.verifyCancelled(f.cleanup),{status:'CANCELLED',payloadRows:0});assert.deepEqual(await backend.setOff(),{mode:'OFF'});assert.equal(state.mode,'OFF');
  for(const call of state.db.filter(item=>item.query.includes('set mode=')))assert.equal(call.query.includes('agent_commit_enabled=true'),false);
});

test('8D management cleanup is exact, idempotent-shaped and final clean verification includes host/policy/payload',async()=>{
  const f=await fixture();const {backend,state}=harness({rows:1});await backend.cleanupFixture(f.cleanup);
  const deletes=state.db.filter(item=>item.query.startsWith('delete from '));assert.equal(deletes.length,5);for(const item of deletes){assert.equal(item.query.includes(namespace),false);assert.equal(item.query.includes(f.cleanup.actorId),false);}
  assert.deepEqual(await backend.verifyClean(f.cleanup),{hostFlag:false,mode:'OFF',ownedRows:0,payloadRows:0,agentCommitEnabled:false,legacyGated:false});
  await assert.rejects(backend.cleanupFixture({...f.cleanup,transactionId:'bad/slash'}),/INVALID_8D_CLEANUP_SCOPE/);
});

test('8D management failures redact operator credentials and remote secret text',async()=>{
  const {backend}=harness({failFetch:true});let error;try{await backend.preflight(namespace);}catch(e){error=e;}
  assert.equal(error?.message,'8D_MANAGEMENT_REQUEST_FAILED');assert.equal(error.message.includes(accessToken),false);assert.equal(error.message.includes(transactionSecret),false);assert.equal(error.message.includes(unrelatedSecret),false);
});
