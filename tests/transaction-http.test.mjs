// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-http.test — http.test — Test.
// @context: Test.
// @state: drop the milestone suffix from transaction test files and titles.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: strict, node:test, transaction-http-8d.

import assert from 'node:assert/strict';
import test from 'node:test';
import {createTransactionDarkHttpHandler} from '../lib/transaction-http-8d.js';
const request=(body,headers={})=>new Request('https://example.invalid/transactions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic-bearer',...headers},body:JSON.stringify(body)});
test('HTTP defaults OFF and performs no host/auth/storage work',async()=>{
  let calls=0;
  const handler=createTransactionDarkHttpHandler({host:async()=>{calls++;}});
  assert.equal((await handler(request({operation:'status',transactionId:'tx_a'}))).status,503);
  assert.equal(calls,0);
});
test('HTTP rejects authority routes, missing bearer and excessive bodies before host',async()=>{
  let calls=0;
  const handler=createTransactionDarkHttpHandler({enabled:true,host:async()=>{calls++;return null;}});
  assert.equal((await handler(request({operation:'finalize',transactionId:'tx_a'}))).status,400);
  assert.equal((await handler(request({operation:'status',transactionId:'tx_a'},{authorization:''}))).status,401);
  assert.equal((await handler(request({operation:'status',transactionId:'tx_a',noise:'x'.repeat(524288)}))).status,413);
  assert.equal((await handler(request({operation:'status',transactionId:'tx_a'},{'content-length':'99999999'}))).status,413);
  assert.equal(calls,0);
});
test('HTTP metadata responses/errors are no-store and never leak SQL/credential messages',async()=>{
  const handler=createTransactionDarkHttpHandler({enabled:true,host:async()=>{throw Object.assign(new Error('private SQL secret credential'),{code:'STORAGE_ERROR'});}});
  const response=await handler(request({operation:'status',transactionId:'tx_a'}));
  assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{error:'STORAGE_ERROR',browserDispatchAllowed:false});
});
