import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOAuthProbe, parseLocalCallbackRequest, REDIRECT_URI, ISSUER, CLIENT_ID } from './helpers/transaction-oauth-8d.mjs';

function fixture(options={}) {
  let time=1000; const calls=[];
  const probe=createOAuthProbe({publicKey:'sb_publishable_synthetic',now:()=>time,fetchImpl:async(url,init)=>{
    calls.push({url,init});
    return new Response(JSON.stringify(url.endsWith('/oauth/token')?
      {access_token:'synthetic.test.token',token_type:'Bearer',expires_in:60,refresh_token:'not-retained'}:
      {id:'00000000-0000-4000-8000-000000000001'}),{status:200});
  },...options});
  const auth=new URL(probe.authorizationUrl);
  const callback=(extra='')=>REDIRECT_URI+'?state='+auth.searchParams.get('state')+'&code=synthetic-code'+extra;
  return {probe,auth,callback,calls,expire:()=>{time=301001;}};
}

test('8D OAuth PKCE uses existing fixed public client/issuer/callback and S256',async()=>{
  const f=fixture(); assert.equal(f.auth.origin,ISSUER);
  assert.equal(f.auth.pathname,'/auth/v1/oauth/authorize');
  assert.equal(f.auth.searchParams.get('client_id'),CLIENT_ID);
  assert.equal(f.auth.searchParams.get('redirect_uri'),REDIRECT_URI);
  assert.equal(f.auth.searchParams.get('code_challenge_method'),'S256');
  assert.equal(f.auth.searchParams.has('code_verifier'),false);
  const result=await f.probe.consume(f.callback());
  assert.deepEqual(result,{userEndpointVerified:true,browserDispatchAllowed:false});
  const body=new URLSearchParams(f.calls[0].init.body);
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),f.auth.searchParams.get('code_challenge'));
  assert.equal(body.get('redirect_uri'),REDIRECT_URI);
  assert.equal(body.get('grant_type'),'authorization_code');
  assert.equal(body.has('client_secret'),false);
  assert.equal(f.calls[0].init.redirect,'error');
  assert.equal(f.calls[1].url,ISSUER+'/auth/v1/user');
  assert.equal(JSON.stringify(result).includes('token'),false);
  await assert.rejects(f.probe.consume(f.callback()),/OAUTH_PROBE_CLOSED/);
});

test('8D OAuth rejects wrong state/duplicate fields/unknown fields/origin/path before network',async()=>{
  const f=fixture();
  for(const url of [f.callback().replace('state=','state=wrong'),f.callback('&code=duplicate'),
    f.callback('&executor=true'),f.callback().replace('127.0.0.1','localhost'),
    f.callback().replace('/oauth/callback','/different')]) await assert.rejects(f.probe.consume(url),/OAUTH_CALLBACK_INVALID/);
  assert.equal(f.calls.length,0);
});

test('8D OAuth attempt expiry and explicit close prevent token exchange',async()=>{
  const f=fixture(); f.expire(); await assert.rejects(f.probe.consume(f.callback()),/OAUTH_PROBE_CLOSED/);
  const g=fixture(); g.probe.close(); await assert.rejects(g.probe.consume(g.callback()),/OAUTH_PROBE_CLOSED/);
  assert.equal(f.calls.length+g.calls.length,0);
});

test('8D OAuth denial is terminal without reflecting remote error data',async()=>{
  const f=fixture(); const url=f.callback().replace('code=synthetic-code','error=access_denied&error_description=private-data');
  await assert.rejects(f.probe.consume(url),/^Error: OAUTH_DENIED$/);
  await assert.rejects(f.probe.consume(f.callback()),/OAUTH_PROBE_CLOSED/); assert.equal(f.calls.length,0);
});

test('8D OAuth exchange failures are terminal, redacted and never auto-retried',async()=>{
  let calls=0; const f=fixture({fetchImpl:async()=>{calls++; throw new Error('secret-token');}});
  await assert.rejects(f.probe.consume(f.callback()),/^Error: OAUTH_EXCHANGE_FAILED$/);
  await assert.rejects(f.probe.consume(f.callback()),/OAUTH_PROBE_CLOSED/); assert.equal(calls,1);
});

test('8D OAuth bounds token responses and requires verified user endpoint',async()=>{
  for(const fetchImpl of [async()=>new Response('x'.repeat(32769)),async()=>new Response(JSON.stringify({access_token:'x'})),
    async url=>url.endsWith('/oauth/token')?new Response(JSON.stringify({access_token:'synthetic.test.token',token_type:'Bearer',expires_in:60})):
      new Response(JSON.stringify({error:'private-data'}),{status:401})]) {
    const f=fixture({fetchImpl}); await assert.rejects(f.probe.consume(f.callback()),/^Error: OAUTH_EXCHANGE_FAILED$/);
  }
});

test('8D OAuth local listener rejects wrong method/Host/Origin/path/absolute URL',()=>{
  const valid={method:'GET',headers:{host:'127.0.0.1:6276'},url:'/oauth/callback?state=test&code=test'};
  assert.equal(parseLocalCallbackRequest(valid),REDIRECT_URI+'?state=test&code=test');
  for(const req of [{...valid,method:'POST'},{...valid,headers:{host:'localhost:6276'}},
    {...valid,headers:{...valid.headers,origin:'https://hostile.example'}},{...valid,url:'https://hostile.example/oauth/callback?code=test'},
    {...valid,url:'/other?code=test'},{...valid,url:'/oauth/callback?'+ 'x'.repeat(4096)}])
    assert.throws(()=>parseLocalCallbackRequest(req),/OAUTH_CALLBACK_INVALID/);
});

test('8D OAuth concurrent callbacks exchange at most once and close aborts in flight',async()=>{
  let finish; let calls=0; let signal;
  const f=fixture({fetchImpl:async(_url,init)=>{calls++;signal=init.signal;return new Promise(resolve=>{finish=resolve;});}});
  const first=f.probe.consume(f.callback());
  await assert.rejects(f.probe.consume(f.callback()),/OAUTH_PROBE_CLOSED/);
  assert.equal(signal.aborted,false,'duplicate must not abort the active owner');
  f.probe.close(); assert.equal(signal.aborted,true);
  finish(new Response(JSON.stringify({access_token:'synthetic.test.token',token_type:'Bearer',expires_in:60})));
  await assert.rejects(first,/OAUTH_EXCHANGE_FAILED/); assert.equal(calls,1);
});

test('8D OAuth expiry during exchange does not reach user endpoint',async()=>{
  let finish; let calls=0;
  const f=fixture({fetchImpl:async()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  const first=f.probe.consume(f.callback()); f.expire();
  finish(new Response(JSON.stringify({access_token:'synthetic.test.token',token_type:'Bearer',expires_in:60})));
  await assert.rejects(first,/OAUTH_EXCHANGE_FAILED/); assert.equal(calls,1);
});

test('8D trusted in-process verifier sees only transient credential and result whitelist rejects token export',async()=>{
  let seen=false;
  const f=fixture({verifyAccessToken:async(token,signal)=>{seen=token==='synthetic.test.token'&&!signal.aborted;
    return {signedClaimsVerified:true,hostStatusHttpStatus:503,hostIdentityAccepted:false,hostDisabled:true,browserDispatchAllowed:false};}});
  const result=await f.probe.consume(f.callback());assert.equal(seen,true);assert.equal(result.hostDisabled,true);
  assert.equal(JSON.stringify(result).includes('synthetic.test.token'),false);
  const g=fixture({verifyAccessToken:async()=>({access_token:'private-token'})});
  await assert.rejects(g.probe.consume(g.callback()),/^Error: OAUTH_EXCHANGE_FAILED$/);
});

test('8D trusted workflow lifetime is separate from each ten-second OAuth HTTP request',async()=>{
  let hookSignal;
  const f=fixture({verifyAccessToken:async(_token,signal)=>{
    hookSignal=signal;assert.notEqual(signal,f.calls[0].init.signal);assert.notEqual(signal,f.calls[1].init.signal);
    return {signedClaimsVerified:true,hostStatusHttpStatus:200,hostIdentityAccepted:true,hostDisabled:false,browserDispatchAllowed:false};
  }});
  await f.probe.consume(f.callback());
  assert.notEqual(f.calls[0].init.signal,f.calls[1].init.signal);
  assert.equal(hookSignal.aborted,true,'closing the owner still aborts its workflow');
});
