// @last-edited: 2026-10-04 11:10 UTC.
// @title: transaction-worker-loss-8d — worker-loss-8d — Explicit opt-in Checkpoint 8D hosted child-worker death/reclaim acceptanc.
// @context: Test.
// @state: add bounded hosted child-worker-loss 8D probe.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: node:crypto, node:url.

// Explicit opt-in Checkpoint 8D hosted child-worker death/reclaim acceptance probe.
// Test infrastructure only: fixed project, fixed SQL, synthetic rows, no OAuth,
// browser dispatch, extension/MCP mutation, or secret printing.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROJECT_REF='nenmkmtvjremqphfqnfw';
const MANAGEMENT_ORIGIN='https://api.supabase.com';
const MGMT=/^[A-Za-z0-9._~-]{16,8192}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHILD_EXIT=23;
const FENCE_TTL_MS=120000;
const REQUEST_TIMEOUT_MS=10000;
const MAX_RESPONSE_BYTES=32768;

const PRECHECK_SQL=`with c as (select public.opera_tx_operator_state_8d() as state)
select (select mode from opera_agent_tx_candidate.policy where singleton=true) as mode,
  (select legacy_gated from opera_agent_tx_candidate.policy where singleton=true) as legacy_gated,
  (select agent_commit_enabled from opera_agent_tx_candidate.policy where singleton=true) as agent_commit_enabled,
  (c.state->>'ownerId') as owner_id,coalesce((c.state->>'hostEnabled')::boolean,false) as host_enabled,
  ((select count(*) from opera_agent_tx_candidate.principals)+(select count(*) from opera_agent_tx_candidate.rates)+
   (select count(*) from opera_agent_tx_candidate.acceptance_bindings)+(select count(*) from opera_agent_tx_candidate.runs)+
   (select count(*) from opera_agent_tx_candidate.run_identities)+(select count(*) from opera_agent_tx_candidate.run_limits)+
   (select count(*) from opera_agent_tx_candidate.run_previews)+(select count(*) from opera_agent_tx_candidate.run_challenges)+
   (select count(*) from opera_agent_tx_candidate.journal)+(select count(*) from opera_agent_tx_candidate.approvals)+
   (select count(*) from opera_agent_tx_candidate.commit_slots))::int as synthetic_rows
from c`;
const ACQUIRE_SQL='select public.opera_tx_operator_acquire_8d($1,$2::uuid,$3::integer)::bigint as epoch';
const HOST_SQL='select public.opera_tx_operator_set_host_8d($1,$2::uuid,$3::bigint,$4::boolean) as host_enabled';
const DARK_SQL=`with fence as materialized(select public.opera_tx_operator_assert_8d($1,$2::uuid,$3::bigint)),u as (
 update opera_agent_tx_candidate.policy set mode='DARK' from fence where singleton=true and mode='OFF' and legacy_gated=false and agent_commit_enabled=false returning mode)
select mode from u`;
const OFF_SQL=`with fence as materialized(select public.opera_tx_operator_assert_8d($1,$2::uuid,$3::bigint)),u as (
 update opera_agent_tx_candidate.policy set mode='OFF',legacy_gated=false,agent_commit_enabled=false from fence where singleton=true returning mode)
select mode from u`;
const PRINCIPAL_SQL=`with fence as materialized(select public.opera_tx_operator_assert_8d($1,$2::uuid,$3::bigint)),p as (
 insert into opera_agent_tx_candidate.principals(tenant_id,actor_id,user_id,oauth_client_id)
 select $2::text,$4,$5,$6 from fence returning tenant_id)
select count(*)::int as inserted from p`;
const CLEANUP_SQL='select public.opera_tx_operator_cleanup_fixture_8d($1,$2::uuid,$3::bigint,$4,$5,$6) as cleaned';
const RELEASE_SQL='select public.opera_tx_operator_release_8d($1,$2::uuid,$3::bigint) as released';
const STATE_SQL=`select (select mode from opera_agent_tx_candidate.policy where singleton=true) as mode,
 (select legacy_gated from opera_agent_tx_candidate.policy where singleton=true) as legacy_gated,
 (select agent_commit_enabled from opera_agent_tx_candidate.policy where singleton=true) as agent_commit_enabled,
 (select count(*)::int from opera_agent_tx_candidate.principals where tenant_id=$1) as principals,
 (select count(*)::int from opera_agent_tx_candidate.runs where tenant_id=$1) as runs,
 (select count(*)::int from opera_agent_tx_candidate.approvals where tenant_id=$1) as approvals,
 (select count(*)::int from opera_agent_tx_candidate.commit_slots where tenant_id=$1) as commit_slots,
 (select public.opera_tx_operator_state_8d()) as control`;

const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const compact=value=>value.replaceAll('-','');
export function parseWorkerLossArgs8D(args){
  if(!Array.isArray(args))throw new Error('INVALID_8D_WORKER_LOSS_ARGUMENTS');
  if(args.length===0)return {mode:'run'};
  if(args.length===1&&args[0]==='--child-crash')return {mode:'child-crash'};
  if(args.length===2&&args[0]==='--recover'&&UUID.test(args[1]??''))return {mode:'recover',namespace:args[1]};
  throw new Error('INVALID_8D_WORKER_LOSS_ARGUMENTS');
}
function ids(namespace){
  if(!UUID.test(namespace))throw new Error('INVALID_8D_WORKER_LOSS_NAMESPACE');
  const c=compact(namespace);
  return Object.freeze({
    namespace,actor:`m8d_loss_actor_${c.slice(0,12)}`,goal:`m8d_loss_goal_${c.slice(0,12)}`,
    tx:`m8d_loss_tx_${c.slice(0,16)}`,user:`m8d_loss_user_${c.slice(0,12)}`,client:`m8d_loss_client_${c.slice(0,12)}`,
    workerA:`m8d_loss_worker_a_${c.slice(0,8)}`,workerB:`m8d_loss_worker_b_${c.slice(0,8)}`,
    prepare:digest('prepare:'+namespace),fence:digest('fence:'+namespace),target:digest('target:'+namespace),
    material:digest('material:'+namespace),nonce:digest('nonce:'+namespace),approval:digest('approval:'+namespace),
    consumption:digest('consumption:'+namespace),device:`m8d_loss_device_${c.slice(0,8)}`
  });
}
async function boundedJson(response){
  if(!response?.body)throw new Error('8D_MANAGEMENT_RESPONSE_INVALID');
  const reader=response.body.getReader();let bytes=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE_BYTES)throw new Error('8D_MANAGEMENT_RESPONSE_LIMIT');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const out=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(out));}catch{throw new Error('8D_MANAGEMENT_RESPONSE_INVALID');}
}
function managementToken(){const token=Deno.env.get('OPERA_8D_MANAGEMENT_TOKEN')??'';if(!MGMT.test(token)||/\s/.test(token))throw new Error('8D_OPERATOR_CREDENTIAL_UNAVAILABLE');return token;}
async function requestDb(token,query,parameters=[]){
  const signal=AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response;try{response=await fetch(`${MANAGEMENT_ORIGIN}/v1/projects/${PROJECT_REF}/database/query`,{method:'POST',redirect:'error',signal,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,parameters,read_only:false})});}
  catch{throw new Error('8D_MANAGEMENT_REQUEST_FAILED');}
  const body=await boundedJson(response);return {ok:response.ok,body};
}
async function db(token,query,parameters=[]){const result=await requestDb(token,query,parameters);if(!result.ok||!Array.isArray(result.body))throw new Error('8D_MANAGEMENT_SQL_FAILED');return result.body;}
function bodyContains(value,needle){try{return JSON.stringify(value).includes(needle);}catch{return false;}}
async function dbExpectError(token,query,parameters,code){const result=await requestDb(token,query,parameters);if(result.ok||!bodyContains(result.body,code))throw new Error('8D_EXPECTED_SQL_DENIAL_MISSING');return true;}
const fenceWrap=(sql)=>`with fence as materialized(select public.opera_tx_operator_assert_8d($1,$2::uuid,$3::bigint)) ${sql}`;

async function childCrash(){
  const token=managementToken();const namespace=Deno.env.get('OPERA_8D_WORKER_LOSS_NAMESPACE')??'';const owner=Deno.env.get('OPERA_8D_WORKER_LOSS_OWNER')??'';const epoch=Number(Deno.env.get('OPERA_8D_WORKER_LOSS_OPERATOR_EPOCH'));
  const x=ids(namespace);if(!/^m8d_loss_owner_[a-f0-9]{16}$/.test(owner)||!Number.isSafeInteger(epoch)||epoch<1)throw new Error('INVALID_8D_WORKER_LOSS_CHILD_ENV');
  const base=[owner,namespace,epoch];
  const prepared=await db(token,fenceWrap(`select opera_agent_tx_candidate.prepare($4,$5,$6,$7,$8,$9,$10,$11,'oatx1.synthetic.cipher',clock_timestamp(),clock_timestamp()+interval '5 minutes') as result from fence`),
    [...base,namespace,x.actor,x.tx,x.prepare,x.fence,x.target,x.device,42]);
  if(prepared.length!==1||prepared[0]?.result?.status!=='PREPARED')throw new Error('8D_WORKER_PREPARE_FAILED');
  const claimed=await db(token,fenceWrap(`select opera_agent_tx_candidate.claim($4,$5,$6,$7) as result from fence`),[...base,namespace,x.actor,x.tx,x.workerA]);
  if(claimed.length!==1||Number(claimed[0]?.result?.leaseEpoch)!==1)throw new Error('8D_WORKER_CLAIM_FAILED');
  const awaited=await db(token,fenceWrap(`select opera_agent_tx_candidate.await_approval($4,$5,$6,1,$7,$8) as result from fence`),[...base,namespace,x.actor,x.tx,x.fence,x.material]);
  if(awaited.length!==1||awaited[0]?.result?.status!=='AWAITING_APPROVAL')throw new Error('8D_WORKER_AWAIT_FAILED');
  await db(token,fenceWrap(`select opera_agent_tx_candidate.issue_approval($4,$5,$6,1,$7,$8,$9,120000) as result from fence`),[...base,namespace,x.actor,x.tx,x.fence,x.nonce,x.approval]);
  const armed=await db(token,`select r.status,r.lease_epoch,r.worker_id,(a.consumed_at is null) as nonce_unconsumed,
    (select count(*)::int from opera_agent_tx_candidate.commit_slots c where c.tenant_id=r.tenant_id and c.transaction_id=r.transaction_id) as slots
    from opera_agent_tx_candidate.runs r join opera_agent_tx_candidate.approvals a using(tenant_id,transaction_id)
    where r.tenant_id=$1 and r.actor_id=$2 and r.transaction_id=$3`,[namespace,x.actor,x.tx]);
  const row=armed[0];if(armed.length!==1||row.status!=='AWAITING_APPROVAL'||Number(row.lease_epoch)!==1||row.worker_id!==x.workerA||row.nonce_unconsumed!==true||Number(row.slots)!==0)throw new Error('8D_WORKER_ARM_STATE_INVALID');
  console.log(JSON.stringify({checkpoint:'8D',probe:'worker-loss',child:'armed',leaseEpoch:1,browserDispatchAllowed:false}));
  Deno.exit(CHILD_EXIT);
}

async function waitForLeaseExpiry(token,x){
  const rows=await db(token,`select greatest(0,ceil(extract(epoch from (lease_until-clock_timestamp()))*1000))::int as wait_ms,
    (lease_until>clock_timestamp()) as active from opera_agent_tx_candidate.runs where tenant_id=$1 and actor_id=$2 and transaction_id=$3`,[x.namespace,x.actor,x.tx]);
  if(rows.length!==1||rows[0]?.active!==true)throw new Error('8D_WORKER_LEASE_NOT_ACTIVE_AT_DEATH');
  const waitMs=Number(rows[0].wait_ms);if(!Number.isSafeInteger(waitMs)||waitMs<1||waitMs>35000)throw new Error('8D_WORKER_LEASE_WINDOW_INVALID');
  await new Promise(resolve=>setTimeout(resolve,waitMs+300));
}
async function setHost(token,owner,namespace,epoch,value){const rows=await db(token,HOST_SQL,[owner,namespace,epoch,value]);if(rows.length!==1||rows[0]?.host_enabled!==value)throw new Error('8D_HOST_FLAG_NOT_SETTLED');}
async function setModeDark(token,owner,namespace,epoch){const rows=await db(token,DARK_SQL,[owner,namespace,epoch]);if(rows.length!==1||rows[0]?.mode!=='DARK')throw new Error('8D_DARK_ENABLE_FAILED');}
async function setModeOff(token,owner,namespace,epoch){const rows=await db(token,OFF_SQL,[owner,namespace,epoch]);if(rows.length!==1||rows[0]?.mode!=='OFF')throw new Error('8D_OFF_RESTORE_FAILED');}
async function cleanupAndRelease(token,owner,epoch,x){
  await setHost(token,owner,x.namespace,epoch,false).catch(()=>{});
  await setModeOff(token,owner,x.namespace,epoch);
  const cleaned=await db(token,CLEANUP_SQL,[owner,x.namespace,epoch,x.actor,x.goal,x.tx]);if(cleaned.length!==1||cleaned[0]?.cleaned!==true)throw new Error('8D_CLEANUP_FAILED');
  const released=await db(token,RELEASE_SQL,[owner,x.namespace,epoch]);if(released.length!==1||released[0]?.released!==true)throw new Error('8D_SERVER_FENCE_RELEASE_FAILED');
}
async function verifyFinal(token,x){
  const rows=await db(token,STATE_SQL,[x.namespace]);const row=rows[0];
  if(rows.length!==1||row.mode!=='OFF'||row.legacy_gated!==false||row.agent_commit_enabled!==false||Number(row.principals)!==0||Number(row.runs)!==0||Number(row.approvals)!==0||Number(row.commit_slots)!==0||row.control?.ownerId!==null||row.control?.hostEnabled!==false)throw new Error('8D_FINAL_STATE_NOT_CLEAN');
}

async function runProbe(){
  const token=managementToken();const namespace=crypto.randomUUID();const x=ids(namespace);const owner=`m8d_loss_owner_${compact(namespace).slice(0,16)}`;let epoch=null;let cleanupComplete=false;
  try{
    const pre=await db(token,PRECHECK_SQL);const p=pre[0];if(pre.length!==1||p.mode!=='OFF'||p.legacy_gated!==false||p.agent_commit_enabled!==false||p.owner_id!==null||p.host_enabled!==false||Number(p.synthetic_rows)!==0)throw new Error('8D_WORKER_LOSS_PREFLIGHT_FAILED');
    const acquired=await db(token,ACQUIRE_SQL,[owner,namespace,FENCE_TTL_MS]);epoch=Number(acquired[0]?.epoch);if(acquired.length!==1||!Number.isSafeInteger(epoch)||epoch<1)throw new Error('8D_SERVER_FENCE_INVALID');
    const principal=await db(token,PRINCIPAL_SQL,[owner,namespace,epoch,x.actor,x.user,x.client]);if(principal.length!==1||Number(principal[0]?.inserted)!==1)throw new Error('8D_WORKER_FIXTURE_FAILED');
    await setHost(token,owner,namespace,epoch,true);await setModeDark(token,owner,namespace,epoch);
    const command=new Deno.Command(Deno.execPath(),{args:['run','--allow-env=OPERA_8D_MANAGEMENT_TOKEN,OPERA_8D_WORKER_LOSS_NAMESPACE,OPERA_8D_WORKER_LOSS_OWNER,OPERA_8D_WORKER_LOSS_OPERATOR_EPOCH','--allow-net=api.supabase.com',fileURLToPath(import.meta.url),'--child-crash'],
      env:{OPERA_8D_WORKER_LOSS_NAMESPACE:namespace,OPERA_8D_WORKER_LOSS_OWNER:owner,OPERA_8D_WORKER_LOSS_OPERATOR_EPOCH:String(epoch)},stdout:'piped',stderr:'piped'});
    const child=await command.output();const stdout=new TextDecoder().decode(child.stdout).trim();
    if(child.code!==CHILD_EXIT||!stdout.split(/\r?\n/).some(line=>{try{const v=JSON.parse(line);return v?.child==='armed'&&v?.leaseEpoch===1&&v?.browserDispatchAllowed===false;}catch{return false;}}))throw new Error('8D_CHILD_DEATH_NOT_OBSERVED');
    await waitForLeaseExpiry(token,x);
    const base=[owner,namespace,epoch];
    const reclaimed=await db(token,fenceWrap(`select opera_agent_tx_candidate.claim($4,$5,$6,$7) as result from fence`),[...base,namespace,x.actor,x.tx,x.workerB]);
    if(reclaimed.length!==1||Number(reclaimed[0]?.result?.leaseEpoch)!==2)throw new Error('8D_WORKER_RECLAIM_FAILED');
    await dbExpectError(token,fenceWrap(`select opera_agent_tx_candidate.mark_validated($4,$5,$6,1,$7) as result from fence`),[...base,namespace,x.actor,x.tx,x.fence],'STALE_LEASE');
    const first=await db(token,fenceWrap(`select opera_agent_tx_candidate.finalize_dark($4,$5,$6,2,$7,$8,$9,$10) as result from fence`),[...base,namespace,x.actor,x.tx,x.fence,x.nonce,x.approval,x.consumption]);
    if(first.length!==1||first[0]?.result?.status!=='COMMITTING'||Number(first[0]?.result?.leaseEpoch)!==2)throw new Error('8D_WORKER_FINALIZE_FAILED');
    const replay=await db(token,fenceWrap(`select opera_agent_tx_candidate.finalize_dark($4,$5,$6,2,$7,$8,$9,$10) as result from fence`),[...base,namespace,x.actor,x.tx,x.fence,x.nonce,x.approval,x.consumption]);
    if(replay.length!==1||replay[0]?.result?.replay!==true)throw new Error('8D_WORKER_REDELIVERY_FAILED');
    const evidence=await db(token,`select r.status,r.lease_epoch,(a.consumed_at is not null) as nonce_consumed,
      (select count(*)::int from opera_agent_tx_candidate.commit_slots c where c.tenant_id=r.tenant_id and c.transaction_id=r.transaction_id) as slots,
      (select commits from opera_agent_tx_candidate.rates q where q.tenant_id=r.tenant_id) as commits
      from opera_agent_tx_candidate.runs r join opera_agent_tx_candidate.approvals a using(tenant_id,transaction_id)
      where r.tenant_id=$1 and r.actor_id=$2 and r.transaction_id=$3`,[namespace,x.actor,x.tx]);
    const e=evidence[0];if(evidence.length!==1||e.status!=='COMMITTING'||Number(e.lease_epoch)!==2||e.nonce_consumed!==true||Number(e.slots)!==1||Number(e.commits)!==1)throw new Error('8D_WORKER_DURABILITY_EVIDENCE_INVALID');
    await db(token,fenceWrap(`select opera_agent_tx_candidate.cancel($4,$5,$6) as result from fence`),[...base,namespace,x.actor,x.tx]);
    await cleanupAndRelease(token,owner,epoch,x);cleanupComplete=true;await verifyFinal(token,x);
    console.log(JSON.stringify({checkpoint:'8D',probe:'hosted-child-worker-loss',namespace,childDeath:true,reclaimed:true,staleEpochRejected:true,nonceOneShot:true,exactRedelivery:true,commitSlots:1,browserDispatchAllowed:false,clean:true,secretsPrinted:false}));
  }finally{
    if(epoch!==null&&!cleanupComplete){
      try{await cleanupAndRelease(token,owner,epoch,x);cleanupComplete=true;}catch{}
      if(!cleanupComplete)console.error(JSON.stringify({checkpoint:'8D',probe:'hosted-child-worker-loss',namespace,recoveryCommand:`deno run --allow-env=OPERA_8D_MANAGEMENT_TOKEN --allow-net=api.supabase.com ${fileURLToPath(import.meta.url)} --recover ${namespace}`,secretsPrinted:false}));
    }
  }
}
async function recover(namespace){
  const token=managementToken();const x=ids(namespace);const owner=`m8d_loss_owner_recover_${compact(namespace).slice(0,8)}`;
  const state=await db(token,`select public.opera_tx_operator_state_8d() as control`);const control=state[0]?.control;
  if(control?.ownerId!==null){
    const waits=await db(token,`select greatest(0,ceil(extract(epoch from (($1::timestamptz)-clock_timestamp()))*1000))::int as wait_ms`,[control.leaseUntil]);const waitMs=Number(waits[0]?.wait_ms??0);if(waitMs>0&&waitMs<=FENCE_TTL_MS+5000)await new Promise(resolve=>setTimeout(resolve,waitMs+300));
  }
  const acquired=await db(token,ACQUIRE_SQL,[owner,namespace,FENCE_TTL_MS]);const epoch=Number(acquired[0]?.epoch);if(!Number.isSafeInteger(epoch)||epoch<1)throw new Error('8D_SERVER_FENCE_INVALID');
  await cleanupAndRelease(token,owner,epoch,x);await verifyFinal(token,x);
  console.log(JSON.stringify({checkpoint:'8D',probe:'hosted-child-worker-loss',mode:'recover',namespace,recovered:true,clean:true,secretsPrinted:false}));
}
async function main(){const parsed=parseWorkerLossArgs8D(Deno.args);if(parsed.mode==='child-crash')return childCrash();if(parsed.mode==='recover')return recover(parsed.namespace);return runProbe();}
if(import.meta.main){try{await main();}catch(error){console.error(error instanceof Error?error.message:'8D_WORKER_LOSS_FAILED');Deno.exitCode=1;}}
