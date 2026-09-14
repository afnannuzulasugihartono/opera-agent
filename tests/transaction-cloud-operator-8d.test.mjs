import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createFileOwnershipStore8D, createInternalOperatorTransport8D, PROJECT_REF_8D, CALLBACK_8D } from './helpers/transaction-cloud-operator-8d.mjs';
import { CLIENT_ID } from './helpers/transaction-oauth-8d.mjs';

const namespace='12345678-1234-4234-8234-123456789abc';
const userId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sessionId='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const cleanup={tenantId:namespace,actorId:'m8d_fixture_actor_x',goalId:'m8d_fixture_goal_x',transactionId:'m8d_fixture_tx_x'};
const identity={iss:'https://example.invalid/auth/v1',aud:'authenticated',role:'authenticated',sub:userId,client_id:CLIENT_ID,session_id:sessionId,iat:1,exp:2};
const fixture={cleanup};
function backend(options={}){
  const state={installed:false,host:false,mode:'OFF',calls:[]};
  const b={
    async describe(){state.calls.push('describe');return {projectRef:options.projectRef??PROJECT_REF_8D,clientId:CLIENT_ID,callback:CALLBACK_8D};},
    async preflight(){state.calls.push('preflight');return {hostFlag:false,mode:'OFF',ledgerEnabled:true,agentCommitEnabled:false,legacyGated:false,namespaceEmpty:true,locksVerified:true};},
    async verifySession(input){state.calls.push('verifySession');if(options.verifySession) return options.verifySession(input);return {exists:true,userId:input.userId,clientId:input.clientId,sessionId:input.sessionId};},
    async insertFixture(){state.calls.push('insertFixture');if(state.installed) throw new Error('duplicate');state.installed=true;if(options.lostReply)throw new Error('lost reply');return {inserted:true};},
    async sealLedger(){state.calls.push('sealLedger');return 'oal1.synthetic.cipher';},
    async enableHost(){state.calls.push('enableHost');state.host=true;},
    async setDark(){state.calls.push('setDark');state.mode='DARK';},
    async verifyCancelled(){state.calls.push('verifyCancelled');return {status:'CANCELLED',payloadRows:0};},
    async disableHost(){state.calls.push('disableHost');if(options.failDisable)throw new Error('disable failed');state.host=false;},
    async setOff(){state.calls.push('setOff');if(options.failSetOff)throw new Error('off failed');state.mode='OFF';},
    async cleanupFixture(input){state.calls.push('cleanupFixture');assert.deepEqual(input,cleanup);if(options.failCleanup)throw new Error('cleanup failed');state.installed=false;},
    async verifyClean(){state.calls.push('verifyClean');if(options.failVerify)throw new Error('verify failed');return {hostFlag:state.host,mode:state.mode,ownedRows:state.installed?1:0,payloadRows:0,agentCommitEnabled:false,legacyGated:false};},
  };return {backend:b,state};
}
async function tempStore(){const dir=await mkdtemp(join(tmpdir(),'oa-8d-'));return {dir,store:createFileOwnershipStore8D({directory:dir,isProcessAlive:pid=>pid===process.pid})};}

async function ownAndInstall(transport){
  await transport.operator.preflight(namespace,new AbortController().signal);
  await transport.operator.recordOwnership(cleanup,new AbortController().signal);
  return transport.operator.installFixture({fixture,identity},new AbortController().signal);
}
async function ownInstallSeal(transport){
  await ownAndInstall(transport);
  return transport.operator.sealLedger({tenantId:namespace,goalId:cleanup.goalId},new AbortController().signal);
}

test('8D internal operator is pinned to exact project/client/callback before mutation',async()=>{
  const {dir,store}=await tempStore();try{
    const wrong=backend({projectRef:'other'});const t=createInternalOperatorTransport8D({backend:wrong.backend,store,ownerId:'writer_owner_01'});
    assert.deepEqual(Object.keys(t.operator).sort(),['cleanupFixture','disableHost','enableHost','installFixture','preflight','recordOwnership','sealLedger','setDark','setOff','verifyCancelled','verifyClean'].sort());
    await assert.rejects(t.operator.preflight(namespace,new AbortController().signal),/8D_OPERATOR_TARGET_MISMATCH/);
    assert.deepEqual(wrong.state.calls,['describe']);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D ownership is durable, exclusive and manifest contains only nonsecret cleanup state',async()=>{
  const {dir,store}=await tempStore();let now=1000;try{
    const a=backend(),b=backend();const first=createInternalOperatorTransport8D({backend:a.backend,store,ownerId:'writer_owner_01',now:()=>now,leaseTtlMs:10000});
    await first.operator.preflight(namespace,new AbortController().signal);await first.operator.recordOwnership(cleanup,new AbortController().signal);
    const raw=await readFile(join(dir,`manifest-${namespace}.json`),'utf8');
    assert.equal(raw.includes('Bearer'),false);assert.equal(raw.includes(userId),false);assert.equal(raw.includes(sessionId),false);assert.equal(raw.includes(CLIENT_ID),false);
    await assert.rejects(store.acquire(namespace,'writer_owner_02',now,10000),/8D_GLOBAL_CONTROL_BUSY/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D verifies existing session before insert-only fixture provisioning',async()=>{
  const {dir,store}=await tempStore();try{
    const ok=backend();const t=createInternalOperatorTransport8D({backend:ok.backend,store,ownerId:'writer_owner_01'});
    assert.deepEqual(await ownAndInstall(t),{sessionBound:true});assert.deepEqual(ok.state.calls.slice(-2),['verifySession','insertFixture']);
    const bad=backend({verifySession:input=>({exists:false,userId:input.userId,clientId:input.clientId,sessionId:input.sessionId})});
    const otherDir=await mkdtemp(join(tmpdir(),'oa-8d-'));try{const u=createInternalOperatorTransport8D({backend:bad.backend,store:createFileOwnershipStore8D({directory:otherDir}),ownerId:'writer_owner_02'});await u.operator.preflight(namespace);await u.operator.recordOwnership(cleanup);await assert.rejects(u.operator.installFixture({fixture,identity}),/8D_SESSION_BINDING_FAILED/);assert.equal(bad.state.calls.includes('insertFixture'),false);}finally{await rm(otherDir,{recursive:true,force:true});}
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D aborted session check quiesces before provisioning and cannot become a late insert',async()=>{
  const {dir,store}=await tempStore();let release;const gate=new Promise(r=>release=r);try{
    const b=backend({verifySession:async input=>{await gate;return {exists:true,userId:input.userId,clientId:input.clientId,sessionId:input.sessionId};}});
    const t=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'writer_owner_01'});await t.operator.preflight(namespace);await t.operator.recordOwnership(cleanup);
    const abort=new AbortController();const pending=t.operator.installFixture({fixture,identity},abort.signal);abort.abort();release();
    await assert.rejects(pending,/8D_OPERATOR_ABORTED/);assert.equal(b.state.calls.includes('insertFixture'),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D pending crash manifest blocks a new preflight until explicit recovery',async()=>{
  const {dir,store}=await tempStore();let now=1000;try{
    const b=backend();const parent=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'dead_parent_01',now:()=>now,leaseTtlMs:10000,processId:987654});
    await parent.operator.preflight(namespace);await parent.operator.recordOwnership(cleanup);
    const next=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'writer_owner_02',now:()=>now,leaseTtlMs:10000});
    await assert.rejects(next.operator.preflight(namespace),/8D_RECOVERY_REQUIRED/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D stale-parent recovery reclaims expired global control and restores OFF/exact cleanup',async()=>{
  const {dir,store}=await tempStore();let now=1000;try{
    const b=backend();const parent=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'dead_parent_01',now:()=>now,leaseTtlMs:10000,processId:987654});
    await ownInstallSeal(parent);await parent.operator.enableHost();await parent.operator.setDark();assert.equal(b.state.installed,true);assert.equal(b.state.mode,'DARK');
    now=12000;
    const recovery=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'recovery_owner_01',now:()=>now,leaseTtlMs:10000});
    assert.deepEqual(await recovery.recover(namespace,new AbortController().signal),{recovered:true});
    assert.equal(b.state.installed,false);assert.equal(b.state.host,false);assert.equal(b.state.mode,'OFF');assert.equal(await store.readManifest(namespace),null);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D durable manifest survives real child-process death and is recoverable after lease expiry',async()=>{
  const {dir,store}=await tempStore();try{
    const moduleUrl=new URL('./helpers/transaction-cloud-operator-8d.mjs',import.meta.url).href;
    const script=`import {createFileOwnershipStore8D} from ${JSON.stringify(moduleUrl)};\nconst s=createFileOwnershipStore8D({directory:${JSON.stringify(dir)}});\nconst cleanup=${JSON.stringify(cleanup)};\nawait s.acquire(${JSON.stringify(namespace)},'dead_child_01',1000,10000);\nawait s.writeManifest({version:1,ownerId:'dead_child_01',namespace:${JSON.stringify(namespace)},phase:'DARK',dirty:true,cleanup,updatedAt:1000});`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);assert.ok(await store.readManifest(namespace));
    const b=backend();b.state.installed=true;b.state.host=true;b.state.mode='DARK';
    const recovery=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'recovery_owner_01',now:()=>12000,leaseTtlMs:10000});
    assert.deepEqual(await recovery.recover(namespace),{recovered:true});assert.equal(b.state.installed,false);assert.equal(b.state.mode,'OFF');assert.equal(await store.readManifest(namespace),null);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D lost insert reply leaves durable ownership and later recovery removes partial install',async()=>{
  const {dir,store}=await tempStore();let now=1000;try{
    const b=backend({lostReply:true});const parent=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'dead_parent_01',now:()=>now,leaseTtlMs:10000,processId:987654});
    await parent.operator.preflight(namespace);await parent.operator.recordOwnership(cleanup);await assert.rejects(parent.operator.installFixture({fixture,identity}),/lost reply/);assert.equal(b.state.installed,true);assert.ok(await store.readManifest(namespace));
    now=12000;const recovery=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'recovery_owner_01',now:()=>now,leaseTtlMs:10000});await recovery.recover(namespace);assert.equal(b.state.installed,false);assert.equal(await store.readManifest(namespace),null);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D exact cleanup scope cannot be widened by recovery or caller input',async()=>{
  const {dir,store}=await tempStore();try{
    const b=backend();const t=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'writer_owner_01'});await ownAndInstall(t);
    await assert.rejects(t.operator.cleanupFixture({...cleanup,transactionId:'other'}),/8D_CLEANUP_SCOPE_MISMATCH/);
    assert.equal(b.state.installed,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D phase machine forbids host mutation without durable ownership or before sealing',async()=>{
  const {dir,store}=await tempStore();try{
    const b=backend();const t=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'writer_owner_01'});
    await assert.rejects(t.operator.disableHost(),/8D_CONTROL_OWNERSHIP_REQUIRED/);assert.equal(b.state.calls.includes('disableHost'),false);
    await t.operator.preflight(namespace);await t.operator.recordOwnership(cleanup);await t.operator.installFixture({fixture,identity});
    await assert.rejects(t.operator.enableHost(),/8D_OPERATOR_PHASE_MISMATCH/);assert.equal(b.state.calls.includes('enableHost'),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D install and observation scope must match the exact durable ownership manifest',async()=>{
  const {dir,store}=await tempStore();try{
    const b=backend();const t=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'writer_owner_01'});await t.operator.preflight(namespace);await t.operator.recordOwnership(cleanup);
    const other={...cleanup,transactionId:'m8d_fixture_tx_other'};
    await assert.rejects(t.operator.installFixture({fixture:{cleanup:other},identity}),/8D_CLEANUP_SCOPE_MISMATCH/);assert.equal(b.state.calls.includes('insertFixture'),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D failed recovery keeps durable dirty evidence and does not delete rows while host disable fails',async()=>{
  const {dir,store}=await tempStore();let now=1000;try{
    const seedBackend=backend();const parent=createInternalOperatorTransport8D({backend:seedBackend.backend,store,ownerId:'dead_parent_01',now:()=>now,leaseTtlMs:10000,processId:987654});
    await ownInstallSeal(parent);await parent.operator.enableHost();await parent.operator.setDark();
    const manifestBefore=await store.readManifest(namespace);assert.ok(manifestBefore);
    now=12000;const broken=backend({failDisable:true});broken.state.installed=true;broken.state.host=true;broken.state.mode='DARK';
    const recovery=createInternalOperatorTransport8D({backend:broken.backend,store,ownerId:'recovery_owner_01',now:()=>now,leaseTtlMs:10000});
    await assert.rejects(recovery.recover(namespace),/8D_RECOVERY_FAILED/);
    assert.equal(broken.state.calls.includes('setOff'),true);assert.equal(broken.state.calls.includes('cleanupFixture'),false);
    const manifestAfter=await store.readManifest(namespace);assert.equal(manifestAfter?.phase,'CLEANING');assert.equal(manifestAfter?.ownerId,'recovery_owner_01');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D expired lease is not reclaimed while the recorded local owner process is still alive',async()=>{
  const {dir,store}=await tempStore();try{
    await store.acquire(namespace,'writer_owner_01',1000,10000,process.pid);
    await assert.rejects(store.acquire(namespace,'recovery_owner_01',12000,10000,process.pid),/8D_GLOBAL_CONTROL_BUSY/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('8D ownership rechecks durable manifest after lease acquisition and cannot overwrite a crashed peer',async()=>{
  const {dir,store}=await tempStore();let now=1000;try{
    const b=backend();const candidate=createInternalOperatorTransport8D({backend:b.backend,store,ownerId:'writer_owner_01',now:()=>now,leaseTtlMs:10000});
    await candidate.operator.preflight(namespace);
    await store.acquire(namespace,'dead_peer_01',1000,10000,987654);
    await store.writeManifest({version:1,ownerId:'dead_peer_01',namespace,phase:'DARK',dirty:true,cleanup,updatedAt:1000});
    now=12000;
    await assert.rejects(candidate.operator.recordOwnership(cleanup),/8D_RECOVERY_REQUIRED/);
    const manifest=await store.readManifest(namespace);assert.equal(manifest?.ownerId,'dead_peer_01');assert.equal(manifest?.phase,'DARK');
  }finally{await rm(dir,{recursive:true,force:true});}
});
