import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLIENT_ID } from './transaction-oauth-8d.mjs';

export const PROJECT_REF_8D = 'nenmkmtvjremqphfqnfw';
export const CALLBACK_8D = 'http://127.0.0.1:6276/oauth/callback';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE=/^[A-Za-z0-9_-]{1,128}$/;
const PHASES=new Set(['OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING']);
const BACKEND_METHODS=['describe','preflight','verifySession','insertFixture','sealLedger','enableHost','setDark','verifyCancelled','disableHost','setOff','cleanupFixture','verifyClean'];
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
  if(!exact(value,'expiresAt,namespace,ownerId,pid,version')||value.version!==1||!UUID.test(value.namespace??'')||!validOwner(value.ownerId)||!Number.isSafeInteger(value.pid)||value.pid<1||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<0)fail('INVALID_8D_LEASE');return value;
};
const defaultProcessAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error?.code==='EPERM';}};

export function createFileOwnershipStore8D({directory,isProcessAlive=defaultProcessAlive}) {
  if(typeof directory!=='string'||directory.length<1||typeof isProcessAlive!=='function')fail('INVALID_8D_STORE');
  const ensure=()=>mkdir(directory,{recursive:true});
  const writeJsonAtomic=async(path,value)=>{const tmp=`${path}.${process.pid}.${Date.now()}.tmp`;await writeFile(tmp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});await rename(tmp,path);};
  const readManifest=async namespace=>{try{return validateManifest(JSON.parse(await readFile(manifestPath(directory,namespace),'utf8')));}catch(error){if(error?.code==='ENOENT')return null;throw error;}};
  return Object.freeze({
    async acquire(namespace,ownerId,nowMs,ttlMs,pid=process.pid){
      if(!UUID.test(namespace??'')||!validOwner(ownerId)||!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>300000||!Number.isSafeInteger(pid)||pid<1)fail('INVALID_8D_LEASE_REQUEST');
      await ensure();
      for(let attempt=0;attempt<3;attempt++){
        try{await mkdir(leaseDir(directory));await writeJsonAtomic(leaseFile(directory),{version:1,ownerId,namespace,pid,expiresAt:nowMs+ttlMs});return Object.freeze({leaseEpoch:attempt});}
        catch(error){
          if(error?.code!=='EEXIST'&&error?.code!=='ENOENT')throw error;
          let current;try{current=validateLease(JSON.parse(await readFile(leaseFile(directory),'utf8')));}catch(readError){if(readError?.code==='ENOENT'){await rm(leaseDir(directory),{recursive:true,force:true});continue;}throw readError;}
          // Time alone never steals control from a still-live local owner. This
          // prevents a long-but-live bounded operation from becoming split-brain.
          if(current.expiresAt>nowMs||isProcessAlive(current.pid))fail('8D_GLOBAL_CONTROL_BUSY');
          const tombstone=join(directory,`global-control.reclaim-${ownerId}-${nowMs}-${process.pid}-${attempt}`);
          try{await rename(leaseDir(directory),tombstone);await rm(tombstone,{recursive:true,force:true});}catch(renameError){if(renameError?.code==='ENOENT')continue;throw renameError;}
        }
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
      await rm(leaseDir(directory),{recursive:true,force:true});return true;
    },
    async writeManifest(manifest){validateManifest(manifest);await ensure();await writeJsonAtomic(manifestPath(directory,manifest.namespace),manifest);},
    readManifest,
    async removeManifest(namespace,ownerId){const current=await readManifest(namespace);if(!current)return false;if(current.ownerId!==ownerId)fail('8D_MANIFEST_OWNERSHIP_LOST');await rm(manifestPath(directory,namespace),{force:true});return true;}
  });
}

export function createInternalOperatorTransport8D({backend,store,ownerId,now=Date.now,leaseTtlMs=60000,processId=process.pid}) {
  if(!backend||BACKEND_METHODS.some(name=>typeof backend[name]!=='function')||!store||!['acquire','heartbeat','release','writeManifest','readManifest','removeManifest'].every(name=>typeof store[name]==='function')||!validOwner(ownerId)||typeof now!=='function'||!Number.isSafeInteger(leaseTtlMs)||leaseTtlMs<10000||leaseTtlMs>300000||!Number.isSafeInteger(processId)||processId<1)fail('INVALID_8D_OPERATOR_CONFIGURATION');
  let namespace=null,cleanup=null,phase=null,leased=false;
  const stamp=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)fail('INVALID_8D_CLOCK');return value;};
  const sameCleanup=(a,b)=>a&&b&&a.tenantId===b.tenantId&&a.actorId===b.actorId&&a.goalId===b.goalId&&a.transactionId===b.transactionId;
  const requireLease=()=>{if(!leased||!cleanup||!namespace)fail('8D_CONTROL_OWNERSHIP_REQUIRED');};
  const requirePhase=(...allowed)=>{requireLease();if(!allowed.includes(phase))fail('8D_OPERATOR_PHASE_MISMATCH');};
  const writePhase=async next=>{requireLease();phase=next;await store.writeManifest({version:1,ownerId,namespace,phase:next,dirty:true,cleanup,updatedAt:stamp()});};
  const beat=async()=>{requireLease();await store.heartbeat(namespace,ownerId,stamp(),leaseTtlMs,processId);};
  const guarded=async(fn,signal)=>{if(signal?.aborted)fail('8D_OPERATOR_ABORTED');await beat();const result=await fn();if(signal?.aborted)fail('8D_OPERATOR_ABORTED');await beat();return result;};
  const verifyDescriptor=async signal=>{
    const d=await guarded(()=>backend.describe(signal),signal);
    if(!exact(d,'callback,clientId,projectRef')||d.projectRef!==PROJECT_REF_8D||d.clientId!==CLIENT_ID||d.callback!==CALLBACK_8D)fail('8D_OPERATOR_TARGET_MISMATCH');return d;
  };
  const operator={
    async preflight(ns,signal){if(namespace||leased)fail('8D_OPERATOR_REUSED');if(!UUID.test(ns??''))fail('INVALID_8D_NAMESPACE');namespace=ns;const pending=await store.readManifest(ns);if(pending)fail('8D_RECOVERY_REQUIRED');const d=await backend.describe(signal);if(!exact(d,'callback,clientId,projectRef')||d.projectRef!==PROJECT_REF_8D||d.clientId!==CLIENT_ID||d.callback!==CALLBACK_8D)fail('8D_OPERATOR_TARGET_MISMATCH');const result=await backend.preflight(ns,signal);return result;},
    async recordOwnership(input,signal){cleanup=cleanCleanup(input);if(cleanup.tenantId!==namespace)fail('INVALID_8D_OWNERSHIP');await store.acquire(namespace,ownerId,stamp(),leaseTtlMs,processId);leased=true;try{if(await store.readManifest(namespace))fail('8D_RECOVERY_REQUIRED');await writePhase('OWNED');if(signal?.aborted)fail('8D_OPERATOR_ABORTED');return Object.freeze({recorded:true});}catch(error){await store.release(namespace,ownerId).catch(()=>{});leased=false;throw error;}},
    async installFixture(input,signal){
      requirePhase('OWNED');
      if(!exact(input,'fixture,identity'))fail('INVALID_8D_INSTALL');
      const fixtureCleanup=cleanCleanup(input.fixture?.cleanup);if(!sameCleanup(fixtureCleanup,cleanup))fail('8D_CLEANUP_SCOPE_MISMATCH');
      const identity=input.identity;
      if(!exact(identity,'aud,client_id,exp,iat,iss,role,session_id,sub')||!UUID.test(identity.sub??'')||!UUID.test(identity.session_id??'')||identity.client_id!==CLIENT_ID)fail('INVALID_8D_IDENTITY');
      const session=await guarded(()=>backend.verifySession({userId:identity.sub,clientId:identity.client_id,sessionId:identity.session_id},signal),signal);
      if(!exact(session,'clientId,exists,sessionId,userId')||session.exists!==true||session.userId!==identity.sub||session.clientId!==CLIENT_ID||session.sessionId!==identity.session_id)fail('8D_SESSION_BINDING_FAILED');
      const result=await guarded(()=>backend.insertFixture(input.fixture,signal),signal);
      if(!exact(result,'inserted')||result.inserted!==true)fail('8D_INSERT_ONLY_PROVISIONING_FAILED');await writePhase('INSTALLED');return Object.freeze({sessionBound:true});
    },
    async sealLedger(ledger,signal){requirePhase('INSTALLED');if(!ledger||typeof ledger!=='object'||ledger.tenantId!==namespace||ledger.goalId!==cleanup.goalId)fail('INVALID_8D_LEDGER_SCOPE');const token=await guarded(()=>backend.sealLedger(ledger,signal),signal);await writePhase('SEALED');return token;},
    async enableHost(_,signal){requirePhase('SEALED');const result=await guarded(()=>backend.enableHost(signal),signal);await writePhase('HOST_ENABLED');return result;},
    async setDark(_,signal){requirePhase('HOST_ENABLED');const result=await guarded(()=>backend.setDark(signal),signal);await writePhase('DARK');return result;},
    async verifyCancelled(input,signal){requirePhase('DARK','CLEANING');const exactCleanup=cleanCleanup(input);if(!sameCleanup(exactCleanup,cleanup))fail('8D_CLEANUP_SCOPE_MISMATCH');return guarded(()=>backend.verifyCancelled(exactCleanup,signal),signal);},
    async disableHost(_,signal){requirePhase('OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING');return guarded(()=>backend.disableHost(signal),signal);},
    async setOff(_,signal){requirePhase('OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING');return guarded(()=>backend.setOff(signal),signal);},
    async cleanupFixture(input,signal){requirePhase('OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING');const exactCleanup=cleanCleanup(input);if(!sameCleanup(exactCleanup,cleanup))fail('8D_CLEANUP_SCOPE_MISMATCH');if(phase!=='CLEANING')await writePhase('CLEANING');return guarded(()=>backend.cleanupFixture(exactCleanup,signal),signal);},
    async verifyClean(input,signal){
      requirePhase('OWNED','INSTALLED','SEALED','HOST_ENABLED','DARK','CLEANING');const exactCleanup=cleanCleanup(input);if(!sameCleanup(exactCleanup,cleanup))fail('8D_CLEANUP_SCOPE_MISMATCH');const result=await guarded(()=>backend.verifyClean(exactCleanup,signal),signal);
      if(leased&&exact(result,'agentCommitEnabled,hostFlag,legacyGated,mode,ownedRows,payloadRows')&&result.hostFlag===false&&result.mode==='OFF'&&result.ownedRows===0&&result.payloadRows===0&&result.agentCommitEnabled===false&&result.legacyGated===false){await store.removeManifest(namespace,ownerId);await store.release(namespace,ownerId);leased=false;}
      return result;
    }
  };
  return Object.freeze({operator:Object.freeze(operator),async recover(ns,signal){
    if(namespace||leased)fail('8D_OPERATOR_REUSED');if(!UUID.test(ns??''))fail('INVALID_8D_NAMESPACE');namespace=ns;
    const manifest=await store.readManifest(ns);if(!manifest)return Object.freeze({recovered:false});
    await store.acquire(ns,ownerId,stamp(),leaseTtlMs,processId);leased=true;
    const current=await store.readManifest(ns);
    if(!current){await store.release(ns,ownerId);leased=false;return Object.freeze({recovered:false});}
    cleanup=cleanCleanup(current.cleanup);phase=current.phase;
    try {
      await verifyDescriptor(signal);await writePhase('CLEANING');
      let controlError=null;
      try{await guarded(()=>backend.disableHost(signal),signal);}catch(error){controlError??=error;}
      try{await guarded(()=>backend.setOff(signal),signal);}catch(error){controlError??=error;}
      // Never delete owned fixture rows while new hosted work may still be enabled.
      if(controlError)fail('8D_RECOVERY_FAILED');
      await guarded(()=>backend.cleanupFixture(cleanup,signal),signal);
      const result=await guarded(()=>backend.verifyClean(cleanup,signal),signal);
      const clean=exact(result,'agentCommitEnabled,hostFlag,legacyGated,mode,ownedRows,payloadRows')&&result.hostFlag===false&&result.mode==='OFF'&&result.ownedRows===0&&result.payloadRows===0&&result.agentCommitEnabled===false&&result.legacyGated===false;
      if(!clean)fail('8D_RECOVERY_FAILED');
      await store.removeManifest(ns,ownerId);await store.release(ns,ownerId);leased=false;return Object.freeze({recovered:true});
    } catch(error) {
      // Keep manifest + lease as dirty evidence. A fresh recovery owner may retry
      // only after lease expiry; never silently declare a failed recovery clean.
      if(error?.message==='8D_RECOVERY_FAILED')throw error;
      fail('8D_RECOVERY_FAILED');
    }
  }});
}
