import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseTransactionIdentity } from '../lib/transaction-identity-8d.js';

// Protocol unit doubles, NOT evidence of real Supabase OAuth acceptance.
const NOW='2026-09-13T00:00:00.000Z';
function fixture() {
  const state={claims:{iss:'https://example.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',sub:'user_a',client_id:'client_a',session_id:'session_a',iat:Date.parse(NOW)/1000-1,exp:Date.parse(NOW)/1000+60},user:{id:'user_a'},principal:{tenant_id:'tenant_a',actor_id:'synthetic_a',user_id:'user_a',oauth_client_id:'client_a'}};
  const calls=[];
  const sdk={auth:{getClaims:async token=>{calls.push(['claims',token]);return {data:{claims:state.claims},error:state.error};},getUser:async token=>{calls.push(['user',token]);return {data:{user:state.user},error:state.error};}},rpc:async (name,args)=>{calls.push([name,args]);return {data:state.principal,error:state.error};}};
  return {state,calls,authenticate:createSupabaseTransactionIdentity(sdk,{issuer:'https://example.supabase.co/auth/v1',audience:'authenticated'})};
}
test('8D identity uses verified claims and getUser plus private principal resolution',async()=>{
  const f=fixture(); const identity=await f.authenticate('synthetic-bearer',NOW);
  assert.deepEqual(identity,{userId:'user_a',tenantId:'tenant_a',oauthClientId:'client_a',sessionId:'session_a',accessExpiresAt:f.state.claims.exp,acceptanceIdentity:'synthetic_a'});
  assert.ok(Object.isFrozen(identity)); assert.equal(f.calls.length,3);
});
test('8D identity rejects missing or altered OAuth/issuer/audience/expiry/role/session',async()=>{
  for(const [field,value] of [['client_id',undefined],['iss','https://evil.invalid'],['aud','other'],['role','service_role'],['exp',Date.parse(NOW)/1000],['iat',Date.parse(NOW)/1000+1],['session_id',undefined]]) {
    const f=fixture(); f.state.claims[field]=value;
    assert.equal(await f.authenticate('synthetic-bearer',NOW),null); assert.equal(f.calls.length,1);
  }
});
test('8D identity rejects SDK errors, crossed users, absent and crossed private grants',async()=>{
  for(const change of ['error','user','missing','grantUser','grantClient']) {
    const f=fixture();
    if(change==='error')f.state.error={message:'untrusted'};
    if(change==='user')f.state.user={id:'other'};
    if(change==='missing')f.state.principal=null;
    if(change==='grantUser')f.state.principal.user_id='other';
    if(change==='grantClient')f.state.principal.oauth_client_id='other';
    assert.equal(await f.authenticate('synthetic-bearer',NOW),null);
  }
});
test('8D identity does not substitute user_metadata or client supplied identity',async()=>{
  const f=fixture(); f.state.user.user_metadata={client_id:'client_a',tenant_id:'tenant_a'}; delete f.state.claims.client_id;
  assert.equal(await f.authenticate('synthetic-bearer',NOW),null);
  assert.equal(await f.authenticate({token:'synthetic-bearer',client_id:'client_a'},NOW),null);
});
test('8D identity snapshots verified claim bindings before async user resolution',async()=>{
  const claims={iss:'https://example.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',sub:'user_a',client_id:'client_a',session_id:'session_a',iat:1,exp:9999999999};
  let lookedUp;
  const sdk={auth:{getClaims:async()=>({data:{claims}}),getUser:async()=>{claims.client_id='other';return {data:{user:{id:'user_a'}}};}},rpc:async(_name,args)=>{lookedUp=args;return {data:{user_id:'user_a',oauth_client_id:'client_a',actor_id:'synthetic_a',tenant_id:'tenant_a'}};}};
  const authenticate=createSupabaseTransactionIdentity(sdk,{issuer:claims.iss,audience:'authenticated'});
  assert.equal((await authenticate('synthetic-bearer',NOW)).oauthClientId,'client_a');
  assert.equal(lookedUp.p_client_id,'client_a');
});
