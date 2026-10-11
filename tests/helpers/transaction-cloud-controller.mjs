// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-cloud-controller-8d — Test helper..
// @state: Test helper..
// @dependencies: node:buffer, transaction-cloud-fixture-8d, transaction-oauth-8d, goal-ledger, canonical-order.

// LOCAL acceptance orchestration only. Operator adapters must be installed by
// trusted test code, NEVER HTTP/MCP/page/model input. No real operator adapter,
// durable supervisor or production probe is shipped by this module.

import { Buffer } from 'node:buffer';
import { createCloudFixtureData } from './transaction-cloud-fixture.mjs';
import { ISSUER, CLIENT_ID } from './transaction-oauth.mjs';
import { digestCanonical } from '../../lib/goal-ledger.js';
import { codeUnitCompare } from '../../lib/canonical-order.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATIONS=['preflight','recordOwnership','installFixture','sealLedger','enableHost','setDark','verifyCancelled','disableHost','setOff','cleanupFixture','verifyClean'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const fail=code=>{throw new Error(code);};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

export function createCloudAcceptanceController(configuration) {
  if(!configuration||Object.keys(configuration).sort(codeUnitCompare).join(',')!=='fetchImpl,namespace,now,operator,publicKey,sdk'||
    typeof configuration.namespace!=='string'||!UUID.test(configuration.namespace)||
    typeof configuration.publicKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(configuration.publicKey)||
    typeof configuration.now!=='function'||typeof configuration.fetchImpl!=='function'||
    !configuration.sdk?.auth||typeof configuration.sdk.auth.getClaims!=='function'||typeof configuration.sdk.auth.getUser!=='function'||
    !configuration.operator||Object.keys(configuration.operator).sort(codeUnitCompare).join(',')!==[...OPERATIONS].sort(codeUnitCompare).join(',')||
    OPERATIONS.some(name=>typeof configuration.operator[name]!=='function'))fail('INVALID_CLOUD_CONTROLLER_CONFIGURATION');
  const {namespace,publicKey,now,fetchImpl}=configuration;
  const operator=Object.freeze(Object.fromEntries(OPERATIONS.map(name=>[name,configuration.operator[name].bind(configuration.operator)])));
  const getClaims=configuration.sdk.auth.getClaims.bind(configuration.sdk.auth),getUser=configuration.sdk.auth.getUser.bind(configuration.sdk.auth);
  let used=false;

  const ready=(async()=>{
    try {
      const result=await operator.preflight(namespace,AbortSignal.timeout(10000));
      if(!exact(result,'agentCommitEnabled,hostFlag,ledgerEnabled,legacyGated,locksVerified,mode,namespaceEmpty')||
        result.hostFlag!==false||result.mode!=='OFF'||result.ledgerEnabled!==true||result.agentCommitEnabled!==false||
        result.legacyGated!==false||result.namespaceEmpty!==true||result.locksVerified!==true)throw new Error();
    }catch{fail('CLOUD_PREFLIGHT_FAILED');}
  })();
  return Object.freeze({ready,async run(credential,parentSignal) {
    if(used)fail('CLOUD_ACCEPTANCE_CLOSED');used=true;
    await ready;
    let fixture,dirty=false,failure=false,cleanupFailed=false;
    const signal=AbortSignal.any([parentSignal,AbortSignal.timeout(60000)].filter(Boolean));
    let claims;
    const check=()=>{const time=now()/1000;if(signal.aborted||!Number.isFinite(time)||claims&&claims.exp<=time)throw new Error();};
    try {
      check();
      if(typeof credential!=='string'||credential.length>8192||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(credential))throw new Error();
      const verified=await getClaims(credential),raw=verified.data?.claims;
      claims=raw?Object.freeze(Object.fromEntries(['iss','aud','role','sub','client_id','session_id','iat','exp'].map(key=>[key,raw[key]]))):null;
      check();const time=now()/1000;
      if(verified.error||!claims||claims.iss!==ISSUER+'/auth/v1'||claims.aud!=='authenticated'||claims.role!=='authenticated'||
        claims.client_id!==CLIENT_ID||typeof claims.sub!=='string'||!UUID.test(claims.sub)||typeof claims.session_id!=='string'||!UUID.test(claims.session_id)||
        !Number.isInteger(claims.iat)||!Number.isInteger(claims.exp)||claims.iat>time||claims.exp<=time||claims.exp<=claims.iat)throw new Error();
      const user=await getUser(credential);check();
      if(user.error||user.data?.user?.id!==claims.sub||user.data.user.is_anonymous===true)throw new Error();
      fixture=await createCloudFixtureData({namespace,userId:claims.sub,preparedAt:new Date(now()).toISOString()});check();
      const recorded=await operator.recordOwnership(fixture.cleanup,signal);check();
      if(!exact(recorded,'recorded')||recorded.recorded!==true)throw new Error();

      dirty=true;
      const installed=await operator.installFixture(Object.freeze({fixture,identity:claims}),signal);check();
      if(!exact(installed,'sessionBound')||installed.sessionBound!==true)throw new Error();
      const ledgerToken=await operator.sealLedger(fixture.ledger,signal);check();
      if(typeof ledgerToken!=='string'||ledgerToken.length>131072||!/^oal1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ledgerToken))throw new Error();
      await operator.enableHost(undefined,signal);check();
      await operator.setDark(undefined,signal);check();
      const tx=fixture.request.prepared;
      const digest=await digestCanonical({tenantId:namespace,transactionId:tx.transactionId,prepareDigest:tx.prepareDigest,targetDigest:tx.target.targetDigest});
      const key='tx1:'+digest.slice(7);
      const request=async body=>{
        check();const response=await fetchImpl(ISSUER+'/functions/v1/opera-agent-transactions-8d',{
          method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),
          headers:{'Content-Type':'application/json',apikey:publicKey,Authorization:'Bearer '+credential},body:JSON.stringify(body)});
        if(response.status!==200||!response.body)throw new Error();
        const reader=response.body.getReader(),chunks=[];let bytes=0;
        try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>32768)throw new Error();chunks.push(Buffer.from(value));}}
        finally{await reader.cancel().catch(()=>{});}
        const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));check();
        if(!exact(result,'browserDispatchAllowed,result')||result.browserDispatchAllowed!==false||
          !exact(result.result,'browserDispatchAllowed,commitKey,leaseEpoch,replay,status,transactionId,transition'))throw new Error();
        const m=result.result;
        if(m.transactionId!==tx.transactionId||m.commitKey!==key||m.browserDispatchAllowed!==false||typeof m.replay!=='boolean'||
          !Number.isInteger(m.leaseEpoch)||!Number.isInteger(m.transition)||m.leaseEpoch<0||m.leaseEpoch>2147483646||m.transition<0||m.transition>100)throw new Error();
        return m;
      };
      const prepare=freeze({operation:'prepare',ledgerToken,...fixture.request});
      const first=await request(prepare),second=await request(prepare),status=await request({operation:'status',transactionId:tx.transactionId});
      if(first.status!=='PREPARED'||first.replay!==false||first.leaseEpoch!==0||first.transition!==0||
        second.status!==first.status||second.replay!==true||second.leaseEpoch!==first.leaseEpoch||second.transition!==first.transition||
        status.status!==first.status||status.leaseEpoch!==first.leaseEpoch||status.transition!==first.transition||status.replay!==false)throw new Error();
      const cancelled=await request({operation:'cancel',transactionId:tx.transactionId});
      if(cancelled.status!=='CANCELLED'||cancelled.replay!==false||cancelled.transition!==1||cancelled.leaseEpoch!==1)throw new Error();
      const cancelReplay=await request({operation:'cancel',transactionId:tx.transactionId}),cancelStatus=await request({operation:'status',transactionId:tx.transactionId});
      if(cancelReplay.status!=='CANCELLED'||cancelReplay.replay!==true||cancelReplay.transition!==1||cancelReplay.leaseEpoch!==1||
        cancelStatus.status!=='CANCELLED'||cancelStatus.replay!==false||cancelStatus.transition!==1||cancelStatus.leaseEpoch!==1)throw new Error();
      const removed=await operator.verifyCancelled(fixture.cleanup,signal);check();
      if(!exact(removed,'payloadRows,status')||removed.status!=='CANCELLED'||removed.payloadRows!==0)throw new Error();
    }catch{failure=true;}
    finally {
      credential=null;
      if(dirty){

        let controlFailed=false;
        for(const name of ['disableHost','setOff']) {
          try {
            const cleanupSignal=AbortSignal.timeout(10000);
            await operator[name](undefined,cleanupSignal);
            if(cleanupSignal.aborted){controlFailed=true;cleanupFailed=true;}
          }catch{controlFailed=true;cleanupFailed=true;}
        }
        if(!controlFailed){
          try {
            const cleanupSignal=AbortSignal.timeout(10000);
            await operator.cleanupFixture(fixture.cleanup,cleanupSignal);
            if(cleanupSignal.aborted)cleanupFailed=true;
          }catch{cleanupFailed=true;}
          try {
            const cleanupSignal=AbortSignal.timeout(10000);
            const result=await operator.verifyClean(fixture.cleanup,cleanupSignal);
            const verified=exact(result,'agentCommitEnabled,hostFlag,legacyGated,mode,ownedRows,payloadRows')&&
              result.hostFlag===false&&result.mode==='OFF'&&result.ownedRows===0&&result.payloadRows===0&&
              result.agentCommitEnabled===false&&result.legacyGated===false;
            if(cleanupSignal.aborted||!verified)cleanupFailed=true;
          }catch{cleanupFailed=true;}
        }
      }
    }
    if(cleanupFailed)fail('CLOUD_CLEANUP_FAILED');
    if(failure)fail('CLOUD_ACCEPTANCE_FAILED');
    return Object.freeze({signedClaimsVerified:true,hostStatusHttpStatus:200,hostIdentityAccepted:true,hostDisabled:false,browserDispatchAllowed:false});
  }});
}
