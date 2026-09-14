import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CALLBACK_8D,
  PROJECT_REF_8D,
  createFileOwnershipStore8D,
  createInternalOperatorTransport8D,
} from './helpers/transaction-cloud-operator-8d.mjs';
import { CLIENT_ID } from './helpers/transaction-oauth-8d.mjs';

const namespaceA='12345678-1234-4234-8234-123456789abc';
const namespaceB='22345678-1234-4234-8234-123456789abc';
const cleanupA={tenantId:namespaceA,actorId:'m8d_fixture_actor_a',goalId:'m8d_fixture_goal_a',transactionId:'m8d_fixture_tx_a'};
const userId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sessionId='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const identity={iss:'https://example.invalid/auth/v1',aud:'authenticated',role:'authenticated',sub:userId,client_id:CLIENT_ID,session_id:sessionId,iat:1,exp:2};
const fixtureA={cleanup:cleanupA};

function createFencedBackend({delayEnable=false}={}) {
  const state={installed:false,host:false,mode:'OFF',calls:[],epoch:0,fence:null};
  let releaseEnable;
  const enableGate=delayEnable?new Promise(resolve=>{releaseEnable=resolve;}):Promise.resolve();
  const isFence=value=>value&&typeof value==='object'&&Number.isSafeInteger(value.epoch)&&typeof value.ownerId==='string'&&typeof value.namespace==='string';
  const assertFence=value=>{
    if(!isFence(value)||!state.fence||value.epoch!==state.fence.epoch||value.ownerId!==state.fence.ownerId||value.namespace!==state.fence.namespace)throw new Error('8D_SERVER_FENCE_LOST');
  };
  const optionalFence=value=>{if(isFence(value))assertFence(value);};
  const backend={
    async describe(){state.calls.push('describe');return {projectRef:PROJECT_REF_8D,clientId:CLIENT_ID,callback:CALLBACK_8D};},
    async preflight(){state.calls.push('preflight');return {hostFlag:false,mode:'OFF',ledgerEnabled:true,agentCommitEnabled:false,legacyGated:false,namespaceEmpty:true,locksVerified:true};},
    async acquireFence(input){state.calls.push('acquireFence');state.epoch+=1;state.fence={ownerId:input.ownerId,namespace:input.namespace,epoch:state.epoch};state.host=false;return {epoch:state.epoch};},
    async heartbeatFence(input){state.calls.push('heartbeatFence');assertFence(input);return {epoch:input.epoch};},
    async releaseFence(input){state.calls.push('releaseFence');assertFence(input);if(state.host||state.mode!=='OFF')throw new Error('8D_SERVER_FENCE_NOT_CLEAN');state.fence=null;return {released:true};},
    async verifySession(input){state.calls.push('verifySession');return {exists:true,userId:input.userId,clientId:input.clientId,sessionId:input.sessionId};},
    async insertFixture(_fixture,maybeFence){state.calls.push('insertFixture');optionalFence(maybeFence);state.installed=true;return {inserted:true};},
    async sealLedger(){state.calls.push('sealLedger');return 'oal1.synthetic.cipher';},
    async enableHost(maybeFence){state.calls.push('enableHost:start');await enableGate;optionalFence(maybeFence);state.host=true;state.calls.push('enableHost:commit');return {hostFlag:true};},
    async setDark(maybeFence){state.calls.push('setDark');optionalFence(maybeFence);state.mode='DARK';return {mode:'DARK'};},
    async verifyCancelled(){state.calls.push('verifyCancelled');return {status:'CANCELLED',payloadRows:0};},
    async disableHost(maybeFence){state.calls.push('disableHost');optionalFence(maybeFence);state.host=false;return {hostFlag:false};},
    async setOff(maybeFence){state.calls.push('setOff');optionalFence(maybeFence);state.mode='OFF';return {mode:'OFF'};},
    async cleanupFixture(_input,maybeFence){state.calls.push('cleanupFixture');optionalFence(maybeFence);state.installed=false;return {cleaned:true};},
    async verifyClean(_input,maybeFence){state.calls.push('verifyClean');optionalFence(maybeFence);return {hostFlag:state.host,mode:state.mode,ownedRows:state.installed?1:0,payloadRows:0,agentCommitEnabled:false,legacyGated:false};},
  };
  return {backend,state,releaseEnable:()=>releaseEnable?.()};
}

async function tempStore(){
  const dir=await mkdtemp(join(tmpdir(),'oa-8d-fence-'));
  return {dir,store:createFileOwnershipStore8D({directory:dir,isProcessAlive:pid=>pid===process.pid})};
}

async function ownInstallSeal(transport){
  await transport.operator.preflight(namespaceA);
  await transport.operator.recordOwnership(cleanupA);
  await transport.operator.installFixture({fixture:fixtureA,identity});
  await transport.operator.sealLedger({tenantId:namespaceA,goalId:cleanupA.goalId});
}

test('8D fresh namespace is blocked by any globally pending dirty manifest',async()=>{
  const {dir,store}=await tempStore();let now=1000;
  try{
    await store.acquire(namespaceA,'dead_owner_01',now,10000,987654);
    await store.writeManifest({version:1,ownerId:'dead_owner_01',namespace:namespaceA,phase:'DARK',dirty:true,cleanup:cleanupA,updatedAt:now});
    now=12000;
    const b=createFencedBackend();
    const next=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'writer_owner_02',now:()=>now,leaseTtlMs:10000});
    await assert.rejects(next.operator.preflight(namespaceB),/8D_RECOVERY_REQUIRED/);
    assert.equal(b.state.calls.includes('preflight'),false);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});

test('8D recovery server fence rejects a delayed pre-recovery host mutation after clean verification',async()=>{
  const {dir,store}=await tempStore();let now=1000;
  try {
    const b=createFencedBackend({delayEnable:true});
    const parent=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'dead_parent_01',now:()=>now,leaseTtlMs:10000,processId:987654});
    await ownInstallSeal(parent);
    const delayed=parent.operator.enableHost();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(b.state.calls.includes('enableHost:start'),true);

    now=12000;
    const recovery=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'recovery_owner_01',now:()=>now,leaseTtlMs:10000});
    assert.deepEqual(await recovery.recover(namespaceA),{recovered:true});
    assert.equal(await store.readManifest(namespaceA),null);
    assert.equal(b.state.host,false);
    assert.equal(b.state.mode,'OFF');

    b.releaseEnable();
    await assert.rejects(delayed,/8D_SERVER_FENCE_LOST|8D_CONTROL_OWNERSHIP_LOST|ENOENT/);
    assert.equal(b.state.host,false);
    assert.equal(b.state.calls.includes('enableHost:commit'),false);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});
