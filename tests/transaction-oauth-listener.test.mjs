// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-oauth-listener.test — oauth-listener.test — Node fetch does not preserve the test's explicit physical/logical Ho.
// @context: Test.
// @state: drop the milestone suffix from transaction test files and titles.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: node:test, strict, node:events, node:http, transaction-oauth-listener-8d.

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { startOAuthListener } from './helpers/transaction-oauth-listener-8d.mjs';

// Node fetch does not preserve the test's explicit physical/logical Host override.
const localFetch=(url,{headers}={})=>new Promise((resolve,reject)=>{
  const req=request(url,{headers},res=>{
    let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;});
    res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>res.headers[key]},text:async()=>body}));
  });req.on('error',reject);req.end();
});

test('OAuth listener loopback routes, redaction, success and shutdown without OAuth network',async()=>{
  let calls=0,closed=0; const logs=[];
  const listener=startOAuthListener({listenPort:0,write:value=>logs.push(value),probe:{authorizationUrl:'https://synthetic.invalid/',close:()=>{closed++;},consume:async()=>{calls++;return {userEndpointVerified:true,browserDispatchAllowed:false};}}});
  try {
    await listener.ready; assert.equal(listener.server.address().address,'127.0.0.1');
    const base='http://127.0.0.1:'+listener.server.address().port;
    const wrong=await localFetch(base+'/oauth/callback?state=wrong',{headers:{Host:'hostile.example'}});
    assert.equal(wrong.status,400); assert.equal(calls,0); await wrong.text();
    const origin=await localFetch(base+'/oauth/callback?state=wrong',{headers:{Host:'127.0.0.1:6276',Origin:'https://hostile.example'}});
    assert.equal(origin.status,400); assert.equal(calls,0); await origin.text();
    const done=once(listener.server,'close');
    const response=await localFetch(base+'/oauth/callback?state=test&code=test',{headers:{Host:'127.0.0.1:6276'}});
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await response.text()).includes('code=test'),false);
    await done; assert.equal(calls,1); assert.equal(closed,1);
    assert.ok(logs.includes('{"userEndpointVerified":true,"browserDispatchAllowed":false}'));
  } finally {listener.close();}
});

test('OAuth listener watchdog closes only its loopback server',async()=>{
  let closed=0;
  const listener=startOAuthListener({listenPort:0,timeoutMs:50,write:()=>{},probe:{authorizationUrl:'https://synthetic.invalid/',close:()=>{closed++;}}});
  await listener.ready; const done=once(listener.server,'close'); await done; assert.equal(closed,1);
});

test('OAuth listener port conflict fails closed without alternate port',async()=>{
  const probe={authorizationUrl:'https://synthetic.invalid/',close:()=>{},consume:async()=>{throw new Error('not allowed');}};
  const first=startOAuthListener({listenPort:0,write:()=>{},probe}); await first.ready;
  const second=startOAuthListener({listenPort:first.server.address().port,write:()=>{},probe});
  try {await assert.rejects(second.ready,/LOCAL_CALLBACK_UNAVAILABLE/); assert.equal(first.server.listening,true);}
  finally {second.close();first.close();}
});
