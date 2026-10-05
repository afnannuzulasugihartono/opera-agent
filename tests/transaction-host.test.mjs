// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-host.test — host.test — Boundary unit doubles only; native/host/live gates must be tracked separately.
// @state: drop the milestone suffix from transaction test files and titles.
// @dependencies: strict, node:test, transaction-host, transaction-dark-fixture, ledger-token, transaction-token.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransactionDarkHost } from '../lib/transaction-host.js';
import { transactionFixture } from './helpers/transaction-dark-fixture.mjs';
import { sealLedgerToken } from '../lib/ledger-token.js';
import { openTransactionToken } from '../lib/transaction-token.js';

// Boundary unit doubles only; native/host/live gates must be tracked separately.

function fixture(){
  const calls=[];
  const client={auth:{getClaims:async()=>({data:{claims:{iss:'https://example.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',sub:'user_a',client_id:'client_a',session_id:'session_a',iat:1,exp:9999999999}}}),getUser:async()=>({data:{user:{id:'user_a'}}})},rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='opera_tx_identity_read'?{tenant_id:'tenant_a',actor_id:'synthetic_a',user_id:'user_a',oauth_client_id:'client_a'}:null};}};
  return {calls,host:createTransactionDarkHost(client,{issuer:'https://example.supabase.co/auth/v1',audience:'authenticated',clock:()=>new Date('2026-09-13T00:00:00Z')})};
}
test('dark host rejects caller authority, approval and executor fields before storage',async()=>{
  for(const extra of ['approved','identity','enforcementMode','executor','client_id']){
    const f=fixture();await assert.rejects(f.host({...{operation:'status',transactionId:'tx_a'},[extra]:true},'synthetic-bearer'),{code:'INVALID_REQUEST'});assert.equal(f.calls.length,0);
  }
});

async function prepareFixture(options={}){
  const f=await transactionFixture(undefined,options),key=new Uint8Array(32).fill(7),calls=[];
  const now='2026-09-12T00:01:00.000Z';
  const ledgerToken=await sealLedgerToken(f.state.ledger,key,{requestId:'ledger_fixture',issuedAt:now});
  const sdk={auth:{getClaims:async()=>({data:{claims:{iss:'https://example.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',sub:f.state.identity.userId,client_id:'client_a',session_id:'session_a',iat:Date.parse(now)/1000-1,exp:Date.parse(now)/1000+600}}}),getUser:async()=>({data:{user:{id:f.state.identity.userId}}})},rpc:async(name,args)=>{
    calls.push([name,args]);
    if(name==='opera_tx_identity_read')return {data:{tenant_id:f.state.identity.tenantId,actor_id:f.state.identity.acceptanceIdentity,user_id:f.state.identity.userId,oauth_client_id:'client_a'}};
    if(name==='opera_tx_binding_read')return {data:{mode:f.state.mode,preparedDigest:f.request.prepared.prepareDigest,ledgerDigest:f.state.ledger.ledgerDigest,target:f.state.target,grant:f.state.grant,operands:[f.state.resolved]}};
    if(name==='opera_goal_crypto_key')return {data:{enabled:true,key:Buffer.from(key).toString('base64url')}};
    if(name==='opera_goal_head_get')return {data:{ok:true,headRevision:f.state.ledger.revision,headDigest:f.state.ledger.ledgerDigest,status:f.state.ledger.status}};
    if(name==='opera_tx_prepare_bound')return {data:{transactionId:f.request.prepared.transactionId,status:'PREPARED',leaseEpoch:0,transition:0,commitKey:'tx1:'+'1'.repeat(64),replay:false,browserDispatchAllowed:false}};
    throw new Error('Unknown RPC');
  }};
  const host=createTransactionDarkHost(sdk,{issuer:'https://example.supabase.co/auth/v1',audience:'authenticated',clock:()=>new Date(now),transactionKey:key});
  return {f,key,calls,ledgerToken,host};
}
test('prepare host decrypts authentic ledger and resolves trusted exact binding before storage',async()=>{
  const {f,key,calls,ledgerToken,host}=await prepareFixture();
  const result=await host({operation:'prepare',ledgerToken,...f.request},'synthetic-bearer');
  assert.equal(result.browserDispatchAllowed,false);
  const stored=calls.find(([name])=>name==='opera_tx_prepare_bound')[1];
  assert.equal(stored.p_identity.sessionId,'session_a');
  assert.equal(stored.p_identity.oauthClientId,'client_a');
  const opened=await openTransactionToken(stored.p_payload,key,{kind:'PREPARED',tenantId:f.request.prepared.tenantId,transactionId:f.request.prepared.transactionId,prepareDigest:f.request.prepared.prepareDigest});
  assert.deepEqual(opened,f.request.prepared); assert.equal(JSON.stringify(stored).includes('oa_test'),false);
  f.state.mode='OFF'; await assert.rejects(host({operation:'prepare',ledgerToken,...f.request},'synthetic-bearer'));
  f.state.mode='DARK';f.state.ledger={...f.state.ledger,revision:f.state.ledger.revision+1};
  await assert.rejects(host({operation:'prepare',ledgerToken,...f.request},'synthetic-bearer'));
});
test('synthetic host refuses unknown or unevaluated ledger constraints/non-goals',async()=>{
  for(const options of [{constraints:[{constraintId:'score_required',kind:'VALUE_PREDICATE',claimField:'score',operator:'GTE',integerValue:4}]},{nonGoals:['Never send or publish.']}]){
    const {f,calls,ledgerToken,host}=await prepareFixture(options);
    await assert.rejects(host({operation:'prepare',ledgerToken,...f.request},'synthetic-bearer'),{code:'AUTHORITY_NOT_RESOLVED'});
    assert.equal(calls.some(([name])=>name==='opera_tx_prepare_bound'),false);
  }
});
test('dark host exposes no finalize, approval or browser operation to requests',async()=>{
  for(const operation of ['finalize','approve','click','burst','open_url']){
    const f=fixture();await assert.rejects(f.host({operation,transactionId:'tx_a'},'synthetic-bearer'),{code:'INVALID_REQUEST'});assert.equal(f.calls.length,0);
  }
});
test('dark host binds status/cancel to verified private principal and never dispatches',async()=>{
  for(const operation of ['status','cancel']){
    const f=fixture(); await f.host({operation,transactionId:'tx_a'},'synthetic-bearer');
    assert.equal(f.calls[1][0],'opera_tx_metadata');
    assert.deepEqual(f.calls[1][1],{p_operation:operation,p_tenant:'tenant_a',p_actor:'synthetic_a',p_identity:{userId:'user_a',tenantId:'tenant_a',oauthClientId:'client_a',sessionId:'session_a',accessExpiresAt:9999999999,acceptanceIdentity:'synthetic_a'},p_tx:'tx_a'});
  }
});
