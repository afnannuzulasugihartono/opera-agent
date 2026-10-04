// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-cloud-operator-8d — cloud-operator-8d — Repository file.
// @context: Test helper.
// @state: fix(quality): keep helper exact()/CLI-config lines byte-unchanged (default sort already code-unit on ASCII keys) - resolves new-code duplica.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: promises, node:crypto, node:path, transaction-oauth-8d.

import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CLIENT_ID } from './transaction-oauth-8d.mjs';

export const PROJECT_REF_8D = 'nenmkmtvjremqphfqnfw';
export const CALLBACK_8D = 'http://127.0.0.1:6276/oauth/callback';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MANIFEST_FILE=/^manifest-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;
const SAFE=/^[A-Za-z0-9_-]{1,128}$/;
const PHASES=new Set(['OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING']);
const BACKEND_METHODS=['describe','preflight','acquireFence','heartbeatFence','releaseFence','verifySession','insertFixture','sealLedger','enableHost','setDark','verifyCancelled','disableHost','setOff','cleanupFixture','verifyClean'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const fail=code=>{throw new Error(code);};
const clone=value=>JSON.parse(JSON.stringify(value));
const cleanCleanup=value=>{
  if(!exact(value,'actorId,goalId,tenantId,transactionId')||!UUID.test(value.tenantId??'')||![value.actorId,value.goalId,value.transactionId].every(v=>typeof v==='string'&&SAFE.test(v)))fail('INVALID_8D_OWNERSHIP');
  return Object.freeze(clone(value));
};
const manifestPath=(dir,namespace)=>join(dir,`manifest-${namespace}.json`);
const leaseDir=dir=>join(dir,'global-control.lock');
const leaseFile=dir=>join(leaseDir(dir),'lease.json');
const validOwner=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(value);
const validateManifest=value=>{
  if(!exact(value,'cleanup,dirty,namespace,ownerId,phase,updatedAt,version')||value.version!==1||value.dirty!==true||!UUID.test(value.namespace??'')||!validOwner(value.ownerId)||!PHASES.has(value.phase)||!Number.isSafeInteger(value.updatedAt)||value.updatedAt<0)fail('INVALID_8D_MANIFEST');
  cleanCleanup(value.cleanup);if(value.cleanup.tenantId!==value.namespace)fail('INVALID_8D_MANIFEST');return value;
};
const validateLease=value=>{
  const shape=value?.version===1?exact(value,'expiresAt,namespace,ownerId,pid,version'):
    value?.version===2&&exact(value,'claimId,expiresAt,namespace,ownerId,pid,version')&&UUID.test(value.claimId??'');
  if(!shape||!UUID.test(value.namespace??'')||!validOwner(value.ownerId)||!Number.isSafeInteger(value.pid)||value.pid<1||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<0)fail('INVALID_8D_LEASE');return value;
};
const validateFenceResult=value=>{
  if(!exact(value,'epoch')||!Number.isSafeInteger(value.epoch)||value.epoch<1)fail('8D_SERVER_FENCE_INVALID');
  return value.epoch;
};
const defaultProcessAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error?.code==='EPERM';}};

export function createFileOwnershipStore8D({directory,isProcessAlive=defaultProcessAlive}) {
  if(typeof directory!=='string'||directory.length<1||typeof isProcessAlive!=='function')fail('INVALID_8D_STORE');
  const ensure=()=>mkdir(directory,{recursive:true});
  const writeJsonAtomic=async(path,value)=>{const tmp=`${path}.${randomUUID()}.tmp`;await writeFile(tmp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});await rename(tmp,path);};
  // Permanent NONEMPTY retirement directories are per-claim CAS witnesses.
  // A second stale reader cannot rename a successor onto the same destination.
  // Do not garbage-collect these while any old process/I/O may still resume.
  const retirementPath=current=>join(directory,'global-control.retired-'+(current.claimId??
    createHash('sha256').update(JSON.stringify([current.namespace,current.ownerId,current.pid])).digest('hex')));
  const retire=async current=>{
    try { await rename(leaseDir(directory),retirementPath(current)); }
    catch(error){if(['EEXIST','ENOTEMPTY','EPERM','ENOENT'].includes(error?.code))fail('8D_GLOBAL_CONTROL_BUSY');throw error;}
  };
  const currentLease=async()=>{
    try{return validateLease(JSON.parse(await readFile(leaseFile(directory),'utf8')));}
    catch(error){
      if(error?.code!=='ENOENT')throw error;
      try { await lstat(leaseDir(directory)); } catch(statError){if(statError?.code==='ENOENT')return null;throw statError;}
      fail('8D_GLOBAL_CONTROL_BUSY'); // Legacy/unknown unfinished lock: never steal.
    }
  };
  const readManifest=async namespace=>{try{return validateManifest(JSON.parse(await readFile(manifestPath(directory,namespace),'utf8')));}catch(error){if(error?.code==='ENOENT')return null;throw error;}};
  const readPendingManifest=async()=>{
    await ensure();
    const names=(await readdir(directory,{withFileTypes:true})).filter(entry=>entry.isFile()&&MANIFEST_FILE.test(entry.name)).map(entry=>entry.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if(names.length===0)return null;
    if(names.length>1)fail('8D_MULTIPLE_DIRTY_MANIFESTS');
    const match=names[0].match(MANIFEST_FILE);if(!match)fail('INVALID_8D_MANIFEST');
    return readManifest(match[1]);
  };
  return Object.freeze({
    async acquire(namespace,ownerId,nowMs,ttlMs,pid=process.pid){
      if(!UUID.test(namespace??'')||!validOwner(ownerId)||!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>300000||!Number.isSafeInteger(pid)||pid<1)fail('INVALID_8D_LEASE_REQUEST');
      await ensure();
      for(let attempt=0;attempt<3;attempt++){
        const current=await currentLease();
        if(current){
          if(current.expiresAt>nowMs||isProcessAlive(current.pid))fail('8D_GLOBAL_CONTROL_BUSY');
          await retire(current);continue;
        }
        const claimId=randomUUID(),stage=join(directory,'global-control.pending-'+claimId);
        await mkdir(stage);
        // Same publish-then-cleanup sequence as before without throwing inside a
        // finally block: the original lease error must never be swallowed by a
        // cleanup failure.
        let claimed=false;
        let leaseError=null;
        try {
          await writeFile(join(stage,'lease.json'),JSON.stringify({version:2,claimId,ownerId,namespace,pid,expiresAt:nowMs+ttlMs})+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
          // Publish the complete nonempty directory in one filesystem operation.
          await rename(stage,leaseDir(directory));claimed=true;
        }catch(error){
          if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error?.code))leaseError=error;
        }
        await rm(join(stage,'lease.json'),{force:true});
        let stageError=null;
        try{await rmdir(stage);}catch(error){if(error?.code!=='ENOENT')stageError=error;}
        if(leaseError)throw leaseError;
        if(stageError)throw stageError;
        if(claimed)return Object.freeze({leaseEpoch:attempt});
      }
      fail('8D_GLOBAL_CONTROL_BUSY');
    },
    async heartbeat(namespace,ownerId,nowMs,ttlMs,pid=process.pid){
      const current=validateLease(JSON.parse(await readFile(leaseFile(directory),'utf8')));
      if(current.namespace!==namespace||current.ownerId!==ownerId||current.pid!==pid||current.expiresAt<=nowMs)fail('8D_CONTROL_OWNERSHIP_LOST');
      await writeJsonAtomic(leaseFile(directory),{...current,expiresAt:nowMs+ttlMs});
    },
    async release(namespace,ownerId){
      let current;try{current=validateLease(JSON.parse(await readFile(leaseFile(directory),'utf8')));}catch(error){if(error?.code==='ENOENT')return false;throw error;}
      if(current.namespace!==namespace||current.ownerId!==ownerId)fail('8D_CONTROL_OWNERSHIP_LOST');
      await retire(current);return true;
    },
    async writeManifest(manifest){validateManifest(manifest);await ensure();await writeJsonAtomic(manifestPath(directory,manifest.namespace),manifest);},
    readManifest,
    readPendingManifest,
    async removeManifest(namespace,ownerId){const current=await readManifest(namespace);if(!current)return false;if(current.ownerId!==ownerId)fail('8D_MANIFEST_OWNERSHIP_LOST');await rm(manifestPath(directory,namespace),{force:true});return true;}
  });
}

export function createInternalOperatorTransport8D({backend,store,ownerId,now=Date.now,leaseTtlMs=60000,processId=process.pid}) {
  if(!backend||BACKEND_METHODS.some(name=>typeof backend[name]!=='function')||!store||!['acquire','heartbeat','release','writeManifest','readManifest','readPendingManifest','removeManifest'].every(name=>typeof store[name]==='function')||!validOwner(ownerId)||typeof now!=='function'||!Number.isSafeInteger(leaseTtlMs)||leaseTtlMs<10000||leaseTtlMs>300000||!Number.isSafeInteger(processId)||processId<1)fail('INVALID_8D_OPERATOR_CONFIGURATION');
  let namespace=null,cleanup=null,phase=null,leased=false,serverFence=null;
  const stamp=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)fail('INVALID_8D_CLOCK');return value;};
  const sameCleanup=(a,b)=>a&&b&&a.tenantId===b.tenantId&&a.actorId===b.actorId&&a.goalId===b.goalId&&a.transactionId===b.transactionId;
  const requireLease=()=>{if(!leased||!cleanup||!namespace)fail('8D_CONTROL_OWNERSHIP_REQUIRED');};
  const requireFence=()=>{requireLease();if(!serverFence)fail('8D_SERVER_FENCE_REQUIRED');return serverFence;};
  const requirePhase=(...allowed)=>{requireLease();if(!allowed.includes(phase))fail('8D_OPERATOR_PHASE_MISMATCH');};
  const writePhase=async next=>{requireLease();phase=next;await store.writeManifest({version:1,ownerId,namespace,phase:next,dirty:true,cleanup,updatedAt:stamp()});};
  const localBeat=async()=>{requireLease();await store.heartbeat(namespace,ownerId,stamp(),leaseTtlMs,processId);};
  const serverBeat=async signal=>{const fence=requireFence();const result=await backend.heartbeatFence({...fence,ttlMs:leaseTtlMs},signal);if(validateFenceResult(result)!==fence.epoch)fail('8D_SERVER_FENCE_LOST');};
  const guarded=async(fn,signal,{fenced=false}={})=>{
    if(signal?.aborted)fail('8D_OPERATOR_ABORTED');await localBeat();if(serverFence)await serverBeat(signal);const fence=fenced?requireFence():serverFence;const result=await fn(fence);
    if(signal?.aborted)fail('8D_OPERATOR_ABORTED');await localBeat();if(serverFence)await serverBeat(signal);return result;
  };
  const acquireServerFence=async signal=>{
    requireLease();if(serverFence)fail('8D_SERVER_FENCE_REUSED');if(signal?.aborted)fail('8D_OPERATOR_ABORTED');await localBeat();
    const result=await backend.acquireFence({ownerId,namespace,ttlMs:leaseTtlMs},signal);const epoch=validateFenceResult(result);serverFence=Object.freeze({ownerId,namespace,epoch});await localBeat();return serverFence;
  };
  const releaseServerFence=async signal=>{
    const fence=requireFence();if(signal?.aborted)fail('8D_OPERATOR_ABORTED');await localBeat();await serverBeat(signal);
    const result=await backend.releaseFence(fence,signal);if(!exact(result,'released')||result.released!==true)fail('8D_SERVER_FENCE_RELEASE_FAILED');serverFence=null;await localBeat();return result;
  };
  const verifyDescriptor=async signal=>{
    const d=await guarded(()=>backend.describe(signal),signal);
    if(!exact(d,'callback,clientId,projectRef')||d.projectRef!==PROJECT_REF_8D||d.clientId!==CLIENT_ID||d.callback!==CALLBACK_8D)fail('8D_OPERATOR_TARGET_MISMATCH');return d;
  };
  const operator={
    async preflight(ns,signal){
      if(namespace||leased)fail('8D_OPERATOR_REUSED');if(!UUID.test(ns??''))fail('INVALID_8D_NAMESPACE');namespace=ns;
      if(await store.readPendingManifest())fail('8D_RECOVERY_REQUIRED');
      const d=await backend.describe(signal);if(!exact(d,'callback,clientId,projectRef')||d.projectRef!==PROJECT_REF_8D||d.clientId!==CLIENT_ID||d.callback!==CALLBACK_8D)fail('8D_OPERATOR_TARGET_MISMATCH');return backend.preflight(ns,signal);
    },
    async recordOwnership(input,signal){
      cleanup=cleanCleanup(input);if(cleanup.tenantId!==namespace)fail('INVALID_8D_OWNERSHIP');await store.acquire(namespace,ownerId,stamp(),leaseTtlMs,processId);leased=true;let manifestWritten=false;
      try{
        if(await store.readPendingManifest())fail('8D_RECOVERY_REQUIRED');await writePhase('OWNED');manifestWritten=true;if(signal?.aborted)fail('8D_OPERATOR_ABORTED');await acquireServerFence(signal);return Object.freeze({recorded:true});
      }catch(error){if(!manifestWritten){await store.release(namespace,ownerId).catch(()=>{});leased=false;}throw error;}
    },
    async installFixture(input,signal){
      requirePhase('OWNED');
      if(!exact(input,'fixture,identity'))fail('INVALID_8D_INSTALL');
      const fixtureCleanup=cleanCleanup(input.fixture?.cleanup);if(!sameCleanup(fixtureCleanup,cleanup))fail('8D_CLEANUP_SCOPE_MISMATCH');
      const identity=input.identity;
      if(!exact(identity,'aud,client_id,exp,iat,iss,role,session_id,sub')||!UUID.test(identity.sub??'')||!UUID.test(identity.session_id??'')||identity.client_id!==CLIENT_ID)fail('INVALID_8D_IDENTITY');
      const session=await guarded(()=>backend.verifySession({userId:identity.sub,clientId:identity.client_id,sessionId:identity.session_id},signal),signal);
      if(!exact(session,'clientId,exists,sessionId,userId')||session.exists!==true||session.userId!==identity.sub||session.clientId!==CLIENT_ID||session.sessionId!==identity.session_id)fail('8D_SESSION_BINDING_FAILED');
      const result=await guarded(fence=>backend.insertFixture(input.fixture,fence,signal),signal,{fenced:true});
      if(!exact(result,'inserted')||result.inserted!==true)fail('8D_INSERT_ONLY_PROVISIONING_FAILED');await writePhase('INSTALLED');return Object.freeze({sessionBound:true});
    },
    async sealLedger(ledger,signal){requirePhase('INSTALLED');if(!ledger||typeof ledger!=='object'||ledger.tenantId!==namespace||ledger.goalId!==cleanup.goalId)fail('INVALID_8D_LEDGER_SCOPE');const token=await guarded(()=>backend.sealLedger(ledger,signal),signal);await writePhase('SEALED');return token;},
    async enableHost(_,signal){requirePhase('SEALED');const result=await guarded(fence=>backend.enableHost(fence,signal),signal,{fenced:true});await writePhase('HOST_ENABLED');return result;},
    async setDark(_,signal){requirePhase('HOST_ENABLED');const result=await guarded(fence=>backend.setDark(fence,signal),signal,{fenced:true});await writePhase('DARK');return result;},
    async verifyCancelled(input,signal){requirePhase('DARK','CLEANING');const exactCleanup=cleanCleanup(input);if(!sameCleanup(exactCleanup,cleanup))fail('8D_CLEANUP_SCOPE_MISMATCH');return guarded(()=>backend.verifyCancelled(exactCleanup,signal),signal);},
    async disableHost(_,signal){requirePhase('OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING');return guarded(fence=>backend.disableHost(fence,signal),signal,{fenced:true});},
    async setOff(_,signal){requirePhase('OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING');return guarded(fence=>backend.setOff(fence,signal),signal,{fenced:true});},
    async cleanupFixture(input,signal){requirePhase('OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING');const exactCleanup=cleanCleanup(input);if(!sameCleanup(exactCleanup,cleanup))fail('8D_CLEANUP_SCOPE_MISMATCH');if(phase!=='CLEANING')await writePhase('CLEANING');return guarded(fence=>backend.cleanupFixture(exactCleanup,fence,signal),signal,{fenced:true});},
    async verifyClean(input,signal){
      requirePhase('OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING');const exactCleanup=cleanCleanup(input);if(!sameCleanup(exactCleanup,cleanup))fail('8D_CLEANUP_SCOPE_MISMATCH');const result=await guarded(fence=>backend.verifyClean(exactCleanup,fence,signal),signal,{fenced:true});
      if(leased&&exact(result,'agentCommitEnabled,hostFlag,legacyGated,mode,ownedRows,payloadRows')&&result.hostFlag===false&&result.mode==='OFF'&&result.ownedRows===0&&result.payloadRows===0&&result.agentCommitEnabled===false&&result.legacyGated===false){await releaseServerFence(signal);await store.removeManifest(namespace,ownerId);await store.release(namespace,ownerId);leased=false;}
      return result;
    }
  };
  return Object.freeze({operator:Object.freeze(operator),async recover(ns,signal){
    if(namespace||leased)fail('8D_OPERATOR_REUSED');if(!UUID.test(ns??''))fail('INVALID_8D_NAMESPACE');namespace=ns;
    const manifest=await store.readPendingManifest();if(!manifest)return Object.freeze({recovered:false});if(manifest.namespace!==ns)fail('8D_RECOVERY_NAMESPACE_MISMATCH');
    await store.acquire(ns,ownerId,stamp(),leaseTtlMs,processId);leased=true;
    const current=await store.readPendingManifest();
    if(!current){await store.release(ns,ownerId);leased=false;return Object.freeze({recovered:false});}
    if(current.namespace!==ns){await store.release(ns,ownerId).catch(()=>{});leased=false;fail('8D_RECOVERY_NAMESPACE_MISMATCH');}
    cleanup=cleanCleanup(current.cleanup);phase=current.phase;
    try {
      await verifyDescriptor(signal);await acquireServerFence(signal);await writePhase('CLEANING');
      let controlError=null;
      try{await guarded(fence=>backend.disableHost(fence,signal),signal,{fenced:true});}catch(error){controlError??=error;}
      try{await guarded(fence=>backend.setOff(fence,signal),signal,{fenced:true});}catch(error){controlError??=error;}
      if(controlError)fail('8D_RECOVERY_FAILED');
      await guarded(fence=>backend.cleanupFixture(cleanup,fence,signal),signal,{fenced:true});
      const result=await guarded(fence=>backend.verifyClean(cleanup,fence,signal),signal,{fenced:true});
      const clean=exact(result,'agentCommitEnabled,hostFlag,legacyGated,mode,ownedRows,payloadRows')&&result.hostFlag===false&&result.mode==='OFF'&&result.ownedRows===0&&result.payloadRows===0&&result.agentCommitEnabled===false&&result.legacyGated===false;
      if(!clean)fail('8D_RECOVERY_FAILED');
      await releaseServerFence(signal);await store.removeManifest(ns,ownerId);await store.release(ns,ownerId);leased=false;return Object.freeze({recovered:true});
    } catch(error) {
      if(error?.message==='8D_RECOVERY_FAILED')throw error;
      fail('8D_RECOVERY_FAILED');
    }
  }});
}
