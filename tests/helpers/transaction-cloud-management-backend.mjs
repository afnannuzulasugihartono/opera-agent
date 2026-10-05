// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-cloud-management-backend-8d — cloud-management-backend-8d — Test-only fixed production operator backend for.
// @state: refactor(quality): centralize code-unit comparator in lib/canonical-order.js - removes token-identical inline comparator blocks that tripped.
// @dependencies: transaction-oauth-8d, transaction-cloud-operator, ledger-token, node:crypto, canonical-order.

// Test-only fixed production operator backend for acceptance.
// This module intentionally exposes no arbitrary SQL, URL, secret name or project
// selector. The fenced Edge bundle is pinned to the independently reviewed deploy;
// any other deployed bundle fails closed before OAuth/live work.

import { CLIENT_ID } from './transaction-oauth.mjs';
import { CALLBACK, PROJECT_REF } from './transaction-cloud-operator.mjs';
import { decodeLedgerKey, sealLedgerToken } from '../../lib/ledger-token.js';
import { createHash } from 'node:crypto';
import { codeUnitCompare } from '../../lib/canonical-order.js';

export const TRANSACTION_FUNCTION='opera-agent-transactions-8d';
export const EXPECTED_TRANSACTION_BUNDLE_SHA='96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1';
const MANAGEMENT_ORIGIN='https://api.supabase.com';
const MASTER_FLAG='OPERA_AGENT_TRANSACTION_DARK_8D';
const TRANSACTION_KEY='OPERA_AGENT_TRANSACTION_KEY_8D';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE=/^[A-Za-z0-9_-]{1,128}$/;
const OWNER=/^[A-Za-z0-9_-]{8,128}$/;
const TOKEN=/^[A-Za-z0-9._~-]{16,8192}$/;
const SECRET_DIGEST=/^[0-9a-f]{64}$/;
const PUBLIC_JWT=/^[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,1024}$/;
const ENABLED_MASTER_DIGEST=createHash('sha256').update('true').digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const fail=code=>{throw new Error(code);};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const safeCleanup=value=>plain(value)&&exact(value,'actorId,goalId,tenantId,transactionId')&&UUID.test(value.tenantId??'')&&[value.actorId,value.goalId,value.transactionId].every(v=>typeof v==='string'&&SAFE.test(v));
const safeFence=value=>plain(value)&&exact(value,'epoch,namespace,ownerId')&&OWNER.test(value.ownerId??'')&&UUID.test(value.namespace??'')&&Number.isSafeInteger(value.epoch)&&value.epoch>0;
const asRows=value=>Array.isArray(value)?value:fail('MANAGEMENT_RESPONSE_INVALID');

const PREFLIGHT_SQL=`with control as (select public.opera_tx_operator_state_8d() as state)
select
  (select mode from opera_agent_tx_candidate.policy where singleton=true) as mode,
  (select legacy_gated from opera_agent_tx_candidate.policy where singleton=true) as legacy_gated,
  (select agent_commit_enabled from opera_agent_tx_candidate.policy where singleton=true) as agent_commit_enabled,
  coalesce((public.opera_goal_crypto_key()->>'enabled')::boolean,false) as ledger_enabled,
  (control.state->>'ownerId') as server_owner_id,
  coalesce((control.state->>'hostEnabled')::boolean,false) as server_host_enabled,
  ((select count(*) from opera_agent_tx_candidate.principals)+(select count(*) from opera_agent_tx_candidate.rates)+
   (select count(*) from opera_agent_tx_candidate.acceptance_bindings)+(select count(*) from opera_agent_tx_candidate.runs)+
   (select count(*) from opera_agent_tx_candidate.run_identities)+(select count(*) from opera_agent_tx_candidate.run_limits)+
   (select count(*) from opera_agent_tx_candidate.run_previews)+(select count(*) from opera_agent_tx_candidate.run_challenges)+
   (select count(*) from opera_agent_tx_candidate.journal)+(select count(*) from opera_agent_tx_candidate.approvals)+
   (select count(*) from opera_agent_tx_candidate.commit_slots))::int as synthetic_rows,
  (select count(*)::int from opera_agent_private.goal_heads where tenant_id=$1::uuid) as goal_rows
from control`;
const SESSION_SQL=`select count(*)::int as matches from auth.sessions
  where id=$3::uuid and user_id=$1::uuid and oauth_client_id=$2::uuid
    and (not_after is null or not_after>clock_timestamp())`;
const ACQUIRE_FENCE_SQL='select public.opera_tx_operator_acquire_8d($1,$2::uuid,$3::integer)::bigint as epoch';
const HEARTBEAT_FENCE_SQL='select public.opera_tx_operator_heartbeat_8d($1,$2::uuid,$3::bigint,$4::integer)::bigint as epoch';
const RELEASE_FENCE_SQL='select public.opera_tx_operator_release_8d($1,$2::uuid,$3::bigint) as released';
const HOST_FENCE_SQL='select public.opera_tx_operator_set_host_8d($1,$2::uuid,$3::bigint,$4::boolean) as host_enabled';
const INSERT_SQL=`with fence as materialized (
  select public.opera_tx_operator_assert_8d($14,$1::uuid,$15::bigint)
), p as (
  insert into opera_agent_tx_candidate.principals(tenant_id,actor_id,user_id,oauth_client_id)
  select $1,$2,$3,$4 from fence returning tenant_id,actor_id
), g as (
  insert into opera_agent_private.goal_heads(tenant_id,goal_id,head_revision,head_digest,status,created_at,updated_at,expires_at)
  select $1::uuid,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,$11::timestamptz from p
  returning tenant_id,goal_id
), b as (
  insert into opera_agent_tx_candidate.acceptance_bindings(tenant_id,actor_id,transaction_id,goal_id,goal_revision,ledger_digest,metadata)
  select $1,$2,$12,$5,$6,$7,$13::jsonb from g
  returning tenant_id,actor_id,transaction_id
)
select (select count(*)::int from p) as principals,(select count(*)::int from g) as goals,(select count(*)::int from b) as bindings`;
const CRYPTO_SQL='select public.opera_goal_crypto_key() as crypto';
const DARK_SQL=`with fence as materialized (select public.opera_tx_operator_assert_8d($1,$2::uuid,$3::bigint)), u as (
  update opera_agent_tx_candidate.policy set mode='DARK' from fence
  where singleton=true and mode='OFF' and legacy_gated=false and agent_commit_enabled=false
    and (select host_enabled from opera_agent_tx_candidate.operator_control where singleton=true)=true
  returning mode,legacy_gated,agent_commit_enabled)
select * from u`;
const OFF_SQL=`with fence as materialized (select public.opera_tx_operator_assert_8d($1,$2::uuid,$3::bigint)), u as (
  update opera_agent_tx_candidate.policy set mode='OFF',legacy_gated=false,agent_commit_enabled=false from fence
  where singleton=true returning mode,legacy_gated,agent_commit_enabled)
select * from u`;
const CANCELLED_SQL=`select coalesce(max(status),'') as status,
  count(*) filter(where payload_token is not null)::int as payload_rows
  from opera_agent_tx_candidate.runs where tenant_id=$1 and actor_id=$2 and transaction_id=$3`;
const CLEANUP_SQL='select public.opera_tx_operator_cleanup_fixture_8d($1,$2::uuid,$3::bigint,$4,$5,$6) as cleaned';
const CLEAN_SQL=`with fence as materialized (select public.opera_tx_operator_assert_8d($1,$2::uuid,$3::bigint)), control as (
  select host_enabled from opera_agent_tx_candidate.operator_control where singleton=true
)
select control.host_enabled,
  (select mode from opera_agent_tx_candidate.policy where singleton=true) as mode,
  (select legacy_gated from opera_agent_tx_candidate.policy where singleton=true) as legacy_gated,
  (select agent_commit_enabled from opera_agent_tx_candidate.policy where singleton=true) as agent_commit_enabled,
  ((select count(*) from opera_agent_tx_candidate.principals where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.rates where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.acceptance_bindings where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.runs where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.run_identities where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.run_limits where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.run_previews where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.run_challenges where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.journal where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.approvals where tenant_id=$2::text)+
   (select count(*) from opera_agent_tx_candidate.commit_slots where tenant_id=$2::text)+
   (select count(*) from opera_agent_private.goal_heads where tenant_id=$2::uuid))::int as owned_rows,
  (select count(*)::int from opera_agent_tx_candidate.runs where tenant_id=$2::text and payload_token is not null) as payload_rows
from fence cross join control`;

export function createManagementOperatorBackend(configuration){
  if(!plain(configuration)||Object.keys(configuration).sort(codeUnitCompare).join(',')!=='credentialProvider,fetchImpl,now'||
    typeof configuration.credentialProvider!=='function'||typeof configuration.fetchImpl!=='function'||typeof configuration.now!=='function') fail('INVALID_8D_MANAGEMENT_BACKEND');
  const {credentialProvider,fetchImpl,now}=configuration;
  async function credential(){const value=await credentialProvider();if(typeof value!=='string'||!TOKEN.test(value)||/\s/.test(value))fail('OPERATOR_CREDENTIAL_UNAVAILABLE');return value;}
  async function request(path,{method='GET',body,signal}={}){
    if(typeof path!=='string'||!path.startsWith('/v1/projects/'+PROJECT_REF+'/'))fail('OPERATOR_TARGET_MISMATCH');
    if(signal?.aborted)fail('OPERATOR_ABORTED');
    const bearer=await credential();const controller=AbortSignal.timeout(10000);const combined=signal?AbortSignal.any([signal,controller]):controller;let response;
    try{response=await fetchImpl(MANAGEMENT_ORIGIN+path,{method,redirect:'error',signal:combined,headers:{Authorization:'Bearer '+bearer,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
    catch{fail(signal?.aborted?'OPERATOR_ABORTED':'MANAGEMENT_REQUEST_FAILED');}
    if(signal?.aborted)fail('OPERATOR_ABORTED');if(!response||!response.ok)fail('MANAGEMENT_REQUEST_FAILED');
    try{return await response.json();}catch{fail('MANAGEMENT_RESPONSE_INVALID');}
  }
  // All fixed private operations use the existing internal operator realm.
  // Management read_only=true selects a restricted role without these grants;
  // it is not a read-only transaction retaining operator authority. Never grant
  // client/read-only roles access or fall back dynamically after a denial.
  const db=(query,parameters=[],{signal}={})=>request(`/v1/projects/${PROJECT_REF}/database/query`,{method:'POST',signal,body:{query,parameters,read_only:false}});
  async function secretDigest(name,signal){
    const values=asRows(await request(`/v1/projects/${PROJECT_REF}/secrets`,{signal}));let selected=null,matches=0;
    for(const item of values){if(!item||typeof item!=='object')continue;const value=item.value;if(item.name===name&&typeof value==='string'){selected=value;matches++;}if(Object.prototype.hasOwnProperty.call(item,'value'))item.value=null;}
    if(matches!==1||typeof selected!=='string'||!SECRET_DIGEST.test(selected))fail('SECRET_DIGEST_INVALID');return selected;
  }
  // Management lists DIGESTS, not plaintext. Key validity is observed in the
  // exact pinned Edge's initialized handler, without retrieving its private key.
  async function verifyInitializedHost(signal){
    const keys=asRows(await request(`/v1/projects/${PROJECT_REF}/api-keys`,{signal}));
    let publicAnon=null,matches=0;
    for(const item of keys){
      if(!item||typeof item!=='object')continue;
      if(item.name==='anon'){matches++;publicAnon=item.api_key;}
      if(Object.prototype.hasOwnProperty.call(item,'api_key'))item.api_key=null;
    }
    if(matches!==1||typeof publicAnon!=='string'||publicAnon.length>8192||!PUBLIC_JWT.test(publicAnon))fail('PUBLIC_ANON_KEY_UNAVAILABLE');
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
    try{
      const result=await fetchImpl(`https://${PROJECT_REF}.supabase.co/functions/v1/${TRANSACTION_FUNCTION}`,{
        method:'GET',redirect:'error',signal:combined,headers:{Authorization:'Bearer '+publicAnon,apikey:publicAnon}});
      if(combined.aborted||result?.status!==405)throw new Error();
      const reader=result.body?.getReader();if(!reader)throw new Error();
      let length=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>2048){await reader.cancel();throw new Error();}chunks.push(value);}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(combined.aborted||!exact(body,'browserDispatchAllowed,error')||body.error!=='METHOD_NOT_ALLOWED'||body.browserDispatchAllowed!==false)throw new Error();
    }catch{fail('HOST_CONFIGURATION_UNVERIFIED');}finally{publicAnon=null;}
  }
  function cleanupInput(input){if(!safeCleanup(input))fail('INVALID_8D_CLEANUP_SCOPE');return input;}
  function fenceInput(input){if(!safeFence(input))fail('INVALID_8D_SERVER_FENCE');return input;}
  function fenceForCleanup(fence,cleanup){const f=fenceInput(fence);if(f.namespace!==cleanup.tenantId)fail('SERVER_FENCE_SCOPE_MISMATCH');return f;}
  async function verifyBundle(signal){
    const functions=asRows(await request(`/v1/projects/${PROJECT_REF}/functions`,{signal}));
    const fn=functions.filter(item=>item?.slug===TRANSACTION_FUNCTION);
    if(fn.length!==1||fn[0].status!=='ACTIVE'||fn[0].verify_jwt!==true||fn[0].ezbr_sha256!==EXPECTED_TRANSACTION_BUNDLE_SHA)fail('HOST_BUNDLE_MISMATCH');
  }
  return Object.freeze({
    async describe(signal){await verifyBundle(signal);return Object.freeze({projectRef:PROJECT_REF,clientId:CLIENT_ID,callback:CALLBACK});},
    async preflight(namespace,signal){
      if(!UUID.test(namespace??''))fail('INVALID_8D_NAMESPACE');
      await verifyBundle(signal);
      if(await secretDigest(MASTER_FLAG,signal)!==ENABLED_MASTER_DIGEST)fail('HOST_MASTER_NOT_ENABLED');
      await secretDigest(TRANSACTION_KEY,signal);
      const rows=asRows(await db(PREFLIGHT_SQL,[namespace],{signal}));const row=rows[0];
      if(rows.length!==1||!row||row.mode!=='OFF'||row.legacy_gated!==false||row.agent_commit_enabled!==false||row.ledger_enabled!==true||row.server_owner_id!==null||row.server_host_enabled!==false)fail('PREFLIGHT_STATE_INVALID');
      await verifyInitializedHost(signal);
      return Object.freeze({hostFlag:false,mode:'OFF',ledgerEnabled:true,agentCommitEnabled:false,legacyGated:false,namespaceEmpty:Number(row.synthetic_rows)===0&&Number(row.goal_rows)===0,locksVerified:true});
    },
    async acquireFence(input,signal){
      if(!plain(input)||!exact(input,'namespace,ownerId,ttlMs')||!OWNER.test(input.ownerId??'')||!UUID.test(input.namespace??'')||!Number.isSafeInteger(input.ttlMs)||input.ttlMs<10000||input.ttlMs>300000)fail('INVALID_8D_SERVER_FENCE');
      const rows=asRows(await db(ACQUIRE_FENCE_SQL,[input.ownerId,input.namespace,input.ttlMs],{signal}));const epoch=rows.length===1?Number(rows[0]?.epoch):NaN;if(!Number.isSafeInteger(epoch)||epoch<1)fail('SERVER_FENCE_INVALID');return Object.freeze({epoch});
    },
    async heartbeatFence(input,signal){
      if(!plain(input)||!exact(input,'epoch,namespace,ownerId,ttlMs')||!OWNER.test(input.ownerId??'')||!UUID.test(input.namespace??'')||!Number.isSafeInteger(input.epoch)||input.epoch<1||!Number.isSafeInteger(input.ttlMs)||input.ttlMs<10000||input.ttlMs>300000)fail('INVALID_8D_SERVER_FENCE');
      const rows=asRows(await db(HEARTBEAT_FENCE_SQL,[input.ownerId,input.namespace,input.epoch,input.ttlMs],{signal}));const epoch=rows.length===1?Number(rows[0]?.epoch):NaN;if(epoch!==input.epoch)fail('IN_MEMORY_FENCE_LOST');return Object.freeze({epoch});
    },
    async releaseFence(input,signal){const f=fenceInput(input);const rows=asRows(await db(RELEASE_FENCE_SQL,[f.ownerId,f.namespace,f.epoch],{signal}));if(rows.length!==1||rows[0]?.released!==true)fail('SERVER_FENCE_RELEASE_FAILED');return Object.freeze({released:true});},
    async verifySession(input,signal){
      if(!plain(input)||!exact(input,'clientId,sessionId,userId')||![input.userId,input.sessionId].every(v=>UUID.test(v??''))||input.clientId!==CLIENT_ID)fail('INVALID_8D_SESSION_QUERY');
      const rows=asRows(await db(SESSION_SQL,[input.userId,input.clientId,input.sessionId],{signal}));const matches=rows.length===1?Number(rows[0]?.matches):NaN;return Object.freeze({exists:matches===1,userId:input.userId,clientId:input.clientId,sessionId:input.sessionId});
    },
    async insertFixture(fixture,fence,signal){
      if(!plain(fixture)||!safeCleanup(fixture.cleanup)||!plain(fixture.principal)||!plain(fixture.goalHead)||!plain(fixture.binding)||!plain(fixture.binding.metadata))fail('INVALID_8D_FIXTURE');
      const {principal,goalHead,binding,cleanup}=fixture;const f=fenceForCleanup(fence,cleanup);
      if(!exact(principal,'actor_id,oauth_client_id,tenant_id,user_id')||!exact(goalHead,'created_at,expires_at,goal_id,head_digest,head_revision,status,tenant_id,updated_at')||!exact(binding,'actor_id,goal_id,goal_revision,ledger_digest,metadata,tenant_id,transaction_id'))fail('INVALID_8D_FIXTURE');
      if(principal.tenant_id!==cleanup.tenantId||principal.actor_id!==cleanup.actorId||principal.oauth_client_id!==CLIENT_ID||!UUID.test(principal.user_id??'')||goalHead.tenant_id!==cleanup.tenantId||goalHead.goal_id!==cleanup.goalId||binding.tenant_id!==cleanup.tenantId||binding.actor_id!==cleanup.actorId||binding.goal_id!==cleanup.goalId||binding.transaction_id!==cleanup.transactionId||binding.metadata.mode!=='DARK'||binding.goal_revision!==goalHead.head_revision||binding.ledger_digest!==goalHead.head_digest)fail('INVALID_8D_FIXTURE');
      const metadata=JSON.stringify(binding.metadata);if(new TextEncoder().encode(metadata).byteLength>131072)fail('INVALID_8D_FIXTURE');
      const rows=asRows(await db(INSERT_SQL,[cleanup.tenantId,cleanup.actorId,principal.user_id,CLIENT_ID,cleanup.goalId,goalHead.head_revision,goalHead.head_digest,goalHead.status,goalHead.created_at,goalHead.updated_at,goalHead.expires_at,cleanup.transactionId,metadata,f.ownerId,f.epoch],{signal}));
      const row=rows[0];if(rows.length!==1||Number(row?.principals)!==1||Number(row?.goals)!==1||Number(row?.bindings)!==1)fail('INSERT_ONLY_PROVISIONING_FAILED');return Object.freeze({inserted:true});
    },
    async sealLedger(ledger,signal){
      if(!plain(ledger)||!UUID.test(ledger.tenantId??'')||typeof ledger.goalId!=='string'||!SAFE.test(ledger.goalId))fail('INVALID_8D_LEDGER_SCOPE');
      const rows=asRows(await db(CRYPTO_SQL,[],{signal}));const cryptoState=rows.length===1&&plain(rows[0]?.crypto)?rows[0].crypto:null;if(!cryptoState||cryptoState.enabled!==true||typeof cryptoState.key!=='string')fail('LEDGER_CRYPTO_UNAVAILABLE');
      let keyBytes;try{keyBytes=decodeLedgerKey(cryptoState.key);cryptoState.key=null;const issuedAt=new Date(now()).toISOString();return await sealLedgerToken(ledger,keyBytes,{requestId:`m8d8d:${ledger.goalId}`.slice(0,128),issuedAt});}finally{keyBytes?.fill(0);if(cryptoState)cryptoState.key=null;}
    },
    async enableHost(fence,signal){const f=fenceInput(fence);const rows=asRows(await db(HOST_FENCE_SQL,[f.ownerId,f.namespace,f.epoch,true],{signal}));if(rows.length!==1||rows[0]?.host_enabled!==true)fail('HOST_FLAG_NOT_SETTLED');return Object.freeze({hostFlag:true});},
    async setDark(fence,signal){const f=fenceInput(fence);const rows=asRows(await db(DARK_SQL,[f.ownerId,f.namespace,f.epoch],{signal}));if(rows.length!==1||rows[0]?.mode!=='DARK'||rows[0]?.legacy_gated!==false||rows[0]?.agent_commit_enabled!==false)fail('DARK_ENABLE_FAILED');return Object.freeze({mode:'DARK'});},
    async verifyCancelled(input,signal){const c=cleanupInput(input);const rows=asRows(await db(CANCELLED_SQL,[c.tenantId,c.actorId,c.transactionId],{signal}));const row=rows[0];return Object.freeze({status:String(row?.status??''),payloadRows:Number(row?.payload_rows??-1)});},
    async disableHost(fence,signal){const f=fenceInput(fence);const rows=asRows(await db(HOST_FENCE_SQL,[f.ownerId,f.namespace,f.epoch,false],{signal}));if(rows.length!==1||rows[0]?.host_enabled!==false)fail('HOST_FLAG_NOT_SETTLED');return Object.freeze({hostFlag:false});},
    async setOff(fence,signal){const f=fenceInput(fence);const rows=asRows(await db(OFF_SQL,[f.ownerId,f.namespace,f.epoch],{signal}));if(rows.length!==1||rows[0]?.mode!=='OFF'||rows[0]?.legacy_gated!==false||rows[0]?.agent_commit_enabled!==false)fail('OFF_RESTORE_FAILED');return Object.freeze({mode:'OFF'});},
    async cleanupFixture(input,fence,signal){const c=cleanupInput(input);const f=fenceForCleanup(fence,c);const rows=asRows(await db(CLEANUP_SQL,[f.ownerId,f.namespace,f.epoch,c.actorId,c.goalId,c.transactionId],{signal}));if(rows.length!==1||rows[0]?.cleaned!==true)fail('CLEANUP_FAILED');return Object.freeze({cleaned:true});},
    async verifyClean(input,fence,signal){
      const c=cleanupInput(input);const f=fenceForCleanup(fence,c);const rows=asRows(await db(CLEAN_SQL,[f.ownerId,f.namespace,f.epoch],{signal}));const row=rows[0];if(rows.length!==1)fail('CLEAN_VERIFY_FAILED');
      return Object.freeze({hostFlag:row.host_enabled===true,mode:String(row.mode??''),ownedRows:Number(row.owned_rows??-1),payloadRows:Number(row.payload_rows??-1),agentCommitEnabled:row.agent_commit_enabled===true,legacyGated:row.legacy_gated===true});
    },
  });
}
