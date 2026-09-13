import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudAcceptanceController8D } from './helpers/transaction-cloud-controller-8d.mjs';
import { ISSUER, CLIENT_ID } from './helpers/transaction-oauth-8d.mjs';
import { digestCanonical } from '../lib/goal-ledger.js';

const namespace = '12345678-1234-4234-8234-123456789abc', userId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const time = Date.parse('2026-09-14T00:00:00.000Z');
function fixture({ fail, badMetadata, badPreflight, badIdentity, responseBytes, badClean, expiredDuringUser, abortAfterInstall, badBinding } = {}) {
  const calls = []; let data; let committed = false; let requestCount = 0; let cancelled=false;
  let currentTime=time;
  const claims = { iss: ISSUER+'/auth/v1', aud:'authenticated', role:'authenticated', sub:userId, session_id:'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', client_id:CLIENT_ID, iat:time/1000-1, exp:time/1000+300 };
  const sdk = { auth: { getClaims:async()=>({data:{claims:badIdentity?{...claims,client_id:'wrong'}:claims}}), getUser:async()=>{
    if(expiredDuringUser){currentTime=time+400000;claims.exp=currentTime/1000+300;}
    return {data:{user:{id:userId}}};
  } } };
  const operator = Object.fromEntries(['preflight','recordOwnership','installFixture','sealLedger','enableHost','setDark','verifyCancelled','disableHost','setOff','cleanupFixture','verifyClean'].map(name=>[name,async(input,signal)=> {
    calls.push(name); assert.ok(signal instanceof AbortSignal);
    if (name===fail) throw new Error('private.operator.credential');
    if (name==='preflight') return { hostFlag:false, mode:'OFF', ledgerEnabled:true, agentCommitEnabled:false, legacyGated:false, namespaceEmpty:!badPreflight, locksVerified:true };
    if (name==='recordOwnership') return { recorded:true };
    if (name==='installFixture') {data=input.fixture; committed=true;abortAfterInstall?.abort();return {sessionBound:!badBinding};}
    if (name==='sealLedger') return 'oal1.synthetic.cipher';
    if (name==='verifyCancelled') return {status:'CANCELLED',payloadRows:0};
    if (name==='cleanupFixture') {committed=false;assert.equal(input.tenantId,namespace);}
    if (name==='verifyClean') {
      const result={hostFlag:false,mode:'OFF',ownedRows:0,payloadRows:0,agentCommitEnabled:false,legacyGated:false};
      if(badClean) result[badClean]=badClean==='mode'?'DARK':badClean.endsWith('Rows')?1:true;
      return result;
    }
  }]));
  const fetchImpl = async(url,init)=> {
    assert.equal(url,ISSUER+'/functions/v1/opera-agent-transactions-8d');
    assert.equal(init.redirect,'error'); assert.equal(init.headers.Authorization,'Bearer synthetic.test.token');
    const body=JSON.parse(init.body); calls.push(body.operation);requestCount++;
    if (fail==='request') throw new Error('private.oauth.token');
    if(responseBytes) return new Response('x'.repeat(responseBytes),{status:200});
    assert.equal(committed,true);
    const tx=data.request.prepared;
    const digest=await digestCanonical({tenantId:namespace,transactionId:tx.transactionId,prepareDigest:tx.prepareDigest,targetDigest:tx.target.targetDigest});
    const replay=requestCount===2||body.operation==='cancel'&&cancelled;
    if(body.operation==='cancel')cancelled=true;
    const result={transactionId:tx.transactionId,status:cancelled?'CANCELLED':'PREPARED',leaseEpoch:cancelled?1:0,transition:cancelled?1:0,commitKey:'tx1:'+digest.slice(7),replay,browserDispatchAllowed:false};
    if(badMetadata) result[badMetadata]=badMetadata==='browserDispatchAllowed'?true:'private-value';
    return new Response(JSON.stringify({result,browserDispatchAllowed:false}),{status:200});
  };
  const controller=createCloudAcceptanceController8D({namespace,sdk,operator,publicKey:'sb_publishable_synthetic',now:()=>currentTime,fetchImpl});
  return {controller,calls};
}
test('8D controller preflights before OAuth and runs exact prepare/replay/status/cancel then cleanup',async()=>{
  const f=fixture();await f.controller.ready;
  assert.deepEqual(f.calls,['preflight']);
  const result=await f.controller.run('synthetic.test.token',new AbortController().signal);
  assert.deepEqual(result,{signedClaimsVerified:true,hostStatusHttpStatus:200,hostIdentityAccepted:true,hostDisabled:false,browserDispatchAllowed:false});
  assert.deepEqual(f.calls,['preflight','recordOwnership','installFixture','sealLedger','enableHost','setDark','prepare','prepare','status','cancel','cancel','status','verifyCancelled','disableHost','setOff','cleanupFixture','verifyClean']);
  await assert.rejects(f.controller.run('synthetic.test.token'),/^Error: CLOUD_ACCEPTANCE_CLOSED$/);
});
test('8D controller rejects preflight and signed identity failures without installation or enablement',async()=>{
  const f=fixture({badPreflight:true});await assert.rejects(f.controller.ready,/CLOUD_PREFLIGHT_FAILED/);
  await assert.rejects(f.controller.run('synthetic.test.token'),/CLOUD_PREFLIGHT_FAILED/);
  assert.deepEqual(f.calls,['preflight']);
  const g=fixture({badIdentity:true});await g.controller.ready;await assert.rejects(g.controller.run('synthetic.test.token'),/^Error: CLOUD_ACCEPTANCE_FAILED$/);
  assert.deepEqual(g.calls,['preflight']);
});
test('8D controller partial install and every later failure restore OFF and exact-owned cleanup',async()=>{
  for(const fail of ['installFixture','sealLedger','enableHost','setDark','request','verifyCancelled']) {
    const f=fixture({fail});await f.controller.ready;
    await assert.rejects(f.controller.run('synthetic.test.token'),/^Error: CLOUD_ACCEPTANCE_FAILED$/);
    assert.deepEqual(f.calls.slice(-4),['disableHost','setOff','cleanupFixture','verifyClean']);
  }
});
test('8D controller concurrent run attempts cannot install or send a second workflow',async()=>{
  const f=fixture();await f.controller.ready;
  const first=f.controller.run('synthetic.test.token');
  await assert.rejects(f.controller.run('synthetic.test.token'),/^Error: CLOUD_ACCEPTANCE_CLOSED$/);
  await first;assert.equal(f.calls.filter(name=>name==='installFixture').length,1);
  assert.equal(f.calls.filter(name=>name==='prepare').length,2);
});
test('8D controller failed durable ownership recording forbids all mutation',async()=>{
  const f=fixture({fail:'recordOwnership'});await f.controller.ready;
  await assert.rejects(f.controller.run('synthetic.test.token'),/^Error: CLOUD_ACCEPTANCE_FAILED$/);
  assert.deepEqual(f.calls,['preflight','recordOwnership']);
});
test('8D controller rejects forged metadata, never skipping cleanup',async()=>{
  for(const badMetadata of ['transactionId','status','commitKey','browserDispatchAllowed','secret']) {
    const f=fixture({badMetadata});await f.controller.ready;await assert.rejects(f.controller.run('synthetic.test.token'),/^Error: CLOUD_ACCEPTANCE_FAILED$/);
    assert.deepEqual(f.calls.slice(-4),['disableHost','setOff','cleanupFixture','verifyClean']);
  }
});
test('8D controller bounds HTTP bytes and refuses nonzero cleanup verification',async()=>{
  const f=fixture({responseBytes:32769});await f.controller.ready;await assert.rejects(f.controller.run('synthetic.test.token'),/^Error: CLOUD_ACCEPTANCE_FAILED$/);
  assert.deepEqual(f.calls.slice(-4),['disableHost','setOff','cleanupFixture','verifyClean']);
  for(const badClean of ['ownedRows','payloadRows','hostFlag','mode','agentCommitEnabled','legacyGated','extra']) {
    const g=fixture({badClean});await g.controller.ready;await assert.rejects(g.controller.run('synthetic.test.token'),/^Error: CLOUD_CLEANUP_FAILED$/);
  }
});
test('8D controller snapshots claims and rechecks expiry across SDK awaits',async()=>{
  const f=fixture({expiredDuringUser:true});await f.controller.ready;await assert.rejects(f.controller.run('synthetic.test.token'),/^Error: CLOUD_ACCEPTANCE_FAILED$/);
  assert.deepEqual(f.calls,['preflight']);
});
test('8D controller cancellation and failed server session binding preserve independent cleanup',async()=>{
  const abort=new AbortController();
  for(const options of [{abortAfterInstall:abort},{badBinding:true}]){
    const f=fixture(options);await f.controller.ready;await assert.rejects(f.controller.run('synthetic.test.token',options.abortAfterInstall?.signal),/^Error: CLOUD_ACCEPTANCE_FAILED$/);
    assert.equal(f.calls.includes('enableHost'),false);assert.deepEqual(f.calls.slice(-4),['disableHost','setOff','cleanupFixture','verifyClean']);
  }
});
test('8D controller attempts all cleanup steps and refuses PASS if any cleanup fails',async()=>{
  for(const fail of ['disableHost','setOff','cleanupFixture','verifyClean']) {
    const f=fixture({fail});await f.controller.ready;await assert.rejects(f.controller.run('synthetic.test.token'),/^Error: CLOUD_CLEANUP_FAILED$/);
    assert.deepEqual(f.calls.slice(-4),['disableHost','setOff','cleanupFixture','verifyClean']);
  }
});
