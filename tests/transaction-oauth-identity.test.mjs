// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-oauth-identity.test — oauth-identity.test — Test.
// @context: Test.
// @state: drop the milestone suffix from transaction test files and titles.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: node:test, strict, transaction-oauth-identity-8d, transaction-oauth-8d.

import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOAuthHostStatus } from './helpers/transaction-oauth-identity-8d.mjs';
import { ISSUER,CLIENT_ID } from './helpers/transaction-oauth-8d.mjs';

const claims={iss:ISSUER+'/auth/v1',aud:'authenticated',role:'authenticated',sub:'00000000-0000-4000-8000-000000000001',
  client_id:CLIENT_ID,session_id:'00000000-0000-4000-8000-000000000002',iat:1,exp:100};
function fixture(overrides={}) {
  const calls=[];
  const client={auth:{getClaims:async()=>({data:{claims:{...claims,...overrides}},error:null}),
    getUser:async()=>({data:{user:{id:claims.sub,is_anonymous:false}},error:null})}};
  const options={publicKey:'sb_publishable_synthetic',now:()=>2000,signal:new AbortController().signal,
    fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({error:'TRANSACTION_DISABLED',browserDispatchAllowed:false}),{status:503});}};
  return {client,options,calls};
}
test('in-process SDK probe checks actual trusted claims and only fixed status request',async()=>{
  const f=fixture(); const result=await verifyOAuthHostStatus(f.client,'synthetic.test.token',f.options);
  assert.deepEqual(result,{signedClaimsVerified:true,hostStatusHttpStatus:503,hostIdentityAccepted:false,hostDisabled:true,browserDispatchAllowed:false});
  assert.equal(f.calls[0].url,ISSUER+'/functions/v1/opera-agent-transactions-8d');
  assert.deepEqual(JSON.parse(f.calls[0].init.body),{operation:'status',transactionId:'m8d_oauth_identity_probe'});
  assert.equal(f.calls[0].init.redirect,'error');assert.equal(JSON.stringify(result).includes('synthetic.test.token'),false);
});
test('SDK probe wrong issuer/audience/role/client/session/user/time fail before host',async()=>{
  for(const override of [{iss:'https://hostile.invalid/auth/v1'},{aud:'other'},{role:'service_role'},
    {client_id:'other-client'},{session_id:''},{sub:'other-user'},{exp:2},{iat:3}]) {
    const f=fixture(override);await assert.rejects(verifyOAuthHostStatus(f.client,'synthetic.test.token',f.options),/^Error: OAUTH_HOST_PROBE_FAILED$/);assert.equal(f.calls.length,0);
  }
});
test('SDK probe distinguishes host rejection from positive auth and never dispatches',async()=>{
  const f=fixture();f.options.fetchImpl=async()=>new Response(JSON.stringify({error:'AUTHENTICATION_REQUIRED',browserDispatchAllowed:false}),{status:401});
  const result=await verifyOAuthHostStatus(f.client,'synthetic.test.token',f.options);
  assert.equal(result.hostIdentityAccepted,false);assert.equal(result.hostDisabled,false);assert.equal(result.hostStatusHttpStatus,401);
});
test('SDK/host errors, unbound metadata, raw-result/dispatch and oversize bodies fail redacted',async()=>{
  for(const fetchImpl of [async()=>{throw new Error('private-token');},async()=>new Response('x'.repeat(32769)),
    async()=>new Response(JSON.stringify({result:{},browserDispatchAllowed:true})),
    async()=>new Response(JSON.stringify({result:{access_token:'private-token'},browserDispatchAllowed:false})),
    async()=>new Response(JSON.stringify({result:null,browserDispatchAllowed:false,extra:'private'}))]) {
    const f=fixture();f.options.fetchImpl=fetchImpl;await assert.rejects(verifyOAuthHostStatus(f.client,'synthetic.test.token',f.options),/^Error: OAUTH_HOST_PROBE_FAILED$/);
  }
});

test('theoretical host200null classification is not proof of reachable live positive gate',async()=>{
  const f=fixture();f.options.fetchImpl=async()=>new Response(JSON.stringify({result:null,browserDispatchAllowed:false}));
  const result=await verifyOAuthHostStatus(f.client,'synthetic.test.token',f.options);
  assert.equal(result.hostIdentityAccepted,true);assert.equal(result.hostDisabled,false);
  assert.equal(Object.hasOwn(result,'PROVED'),false);
});

test('SDK claims snapshot cannot extend token expiry across asynchronous getUser',async()=>{
  const f=fixture();const mutable={...claims};let time=2000;
  f.client.auth.getClaims=async()=>({data:{claims:mutable},error:null});
  f.client.auth.getUser=async()=>{mutable.exp=1000;time=100000;return {data:{user:{id:claims.sub,is_anonymous:false}},error:null};};
  f.options.now=()=>time;
  await assert.rejects(verifyOAuthHostStatus(f.client,'synthetic.test.token',f.options),/^Error: OAUTH_HOST_PROBE_FAILED$/);
  assert.equal(f.calls.length,0);
});

test('SDK verifier errors and anonymous/mismatched users fail before host',async()=>{
  for(const type of ['claims-error','anonymous','mismatch']) {
    const f=fixture();
    if(type==='claims-error') f.client.auth.getClaims=async()=>({data:{claims},error:new Error('private-data')});
    else f.client.auth.getUser=async()=>({data:{user:{id:type==='mismatch'?'wrong':claims.sub,is_anonymous:type==='anonymous'}},error:null});
    await assert.rejects(verifyOAuthHostStatus(f.client,'synthetic.test.token',f.options),/^Error: OAUTH_HOST_PROBE_FAILED$/);
    assert.equal(f.calls.length,0);
  }
});
