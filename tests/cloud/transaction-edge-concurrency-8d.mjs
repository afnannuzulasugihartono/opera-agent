// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-edge-concurrency-8d — edge-concurrency-8d — Explicit opt-in Checkpoint 8D real Edge concurrency acceptance probe.
// @state: refactor(quality): centralize code-unit comparator in lib/canonical-order.js - removes token-identical inline comparator blocks that tripped.
// @dependencies: node:path, node:buffer, transaction-cloud-controller-8d, transaction-cloud-management-backend-8d, transaction-cloud-operator-8d, transaction-edge-routing-evidence-8d, transaction-oauth-8d, transaction.

// Explicit opt-in Checkpoint 8D real Edge concurrency acceptance probe.
// Acceptance/test infrastructure only: no browser primitive, MCP/runtime change,
// public schema change, arbitrary SQL, or secret output is introduced here.

import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { createCloudAcceptanceController8D } from '../helpers/transaction-cloud-controller-8d.mjs';
import { createManagementOperatorBackend8D } from '../helpers/transaction-cloud-management-backend-8d.mjs';
import { createFileOwnershipStore8D, createInternalOperatorTransport8D } from '../helpers/transaction-cloud-operator-8d.mjs';
import { collectEdgeRoutingEvidence8D } from '../helpers/transaction-edge-routing-evidence-8d.mjs';
import { createOAuthProbe, ISSUER } from '../helpers/transaction-oauth-8d.mjs';
import { startOAuthListener } from '../helpers/transaction-oauth-listener-8d.mjs';
import { parseAcceptanceArgs8D, SDK_SPECIFIER_8D, STATE_DIRECTORY_8D, LEASE_TTL_MS_8D } from './transaction-cloud-acceptance-8d.mjs';
import { codeUnitCompare } from '../../lib/canonical-order.js';

export const CONCURRENCY_8D = 8;
export const PROJECT_REF_8D = 'nenmkmtvjremqphfqnfw';
const EDGE_URL = `${ISSUER}/functions/v1/opera-agent-transactions-8d`;
const MGMT=/^[A-Za-z0-9._~-]{16,8192}$/;
const PUBLIC=/^sb_publishable_[A-Za-z0-9_-]+$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;

async function consumeEdgeResponse(response) {
  if(!response||response.status!==200||!response.body)throw new Error('8D_EDGE_RACE_HTTP_FAILED');
  const headers=new Headers(response.headers);
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try {
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>32768)throw new Error('8D_EDGE_RACE_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(()=>{}); }
  const text=Buffer.concat(chunks).toString('utf8');
  let envelope;
  try { envelope=JSON.parse(text); } catch { throw new Error('8D_EDGE_RACE_INVALID_JSON'); }
  if(!exact(envelope,'browserDispatchAllowed,result')||envelope.browserDispatchAllowed!==false||
    !exact(envelope.result,'browserDispatchAllowed,commitKey,leaseEpoch,replay,status,transactionId,transition')||
    envelope.result.browserDispatchAllowed!==false||typeof envelope.result.replay!=='boolean')throw new Error('8D_EDGE_RACE_INVALID_RESPONSE');
  return Object.freeze({text,status:response.status,headers,result:envelope.result});
}

export function createEdgeConcurrencyFetch8D(configuration) {
  if(!configuration||Object.keys(configuration).sort(codeUnitCompare).join(',')!=='fetchImpl,write'||typeof configuration.fetchImpl!=='function'||typeof configuration.write!=='function')
    throw new Error('INVALID_8D_EDGE_CONCURRENCY_CONFIGURATION');
  const baseFetch=configuration.fetchImpl,write=configuration.write;
  const evidence={prepare:null,cancel:null};
  let prepareRaced=false,cancelRaced=false;
  const race=async(input,init,operation)=>{
    const copies=await Promise.all(Array.from({length:CONCURRENCY_8D},()=>baseFetch(input,{...init})));
    const results=await Promise.all(copies.map(consumeEdgeResponse));
    const routing=collectEdgeRoutingEvidence8D(results);
    const expectedStatus=operation==='prepare'?'PREPARED':'CANCELLED';
    if(results.some(item=>item.result.status!==expectedStatus))throw new Error('8D_EDGE_RACE_STATUS_MISMATCH');
    const first=results[0].result;
    if(results.some(item=>item.result.transactionId!==first.transactionId||item.result.commitKey!==first.commitKey||
      item.result.status!==first.status||item.result.leaseEpoch!==first.leaseEpoch||item.result.transition!==first.transition||
      item.result.browserDispatchAllowed!==false))throw new Error('8D_EDGE_RACE_METADATA_DIVERGED');
    const winners=results.filter(item=>item.result.replay===false);
    const replays=results.filter(item=>item.result.replay===true);
    if(winners.length!==1||replays.length!==CONCURRENCY_8D-1)throw new Error('8D_EDGE_RACE_NOT_EXACTLY_ONCE');
    const phase=Object.freeze({
      concurrency:CONCURRENCY_8D,
      winners:winners.length,
      replays:replays.length,
      status:expectedStatus,
      traceHeader:routing.traceHeader,
      traceSamples:routing.samples,
      distinctRoutingTraces:routing.distinctRoutingTraces,
      regionHeader:routing.regionHeader,
      distinctRegions:routing.distinctRegions
    });
    evidence[operation]=phase;
    write(JSON.stringify({checkpoint:'8D',probe:'real-edge-concurrency',phase:operation,...phase,browserDispatchAllowed:false,secretsPrinted:false}));
    const winner=winners[0];
    return new Response(winner.text,{status:winner.status,headers:winner.headers});
  };
  const wrapped=async(input,init={})=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input?.url;
    const method=(init.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url===EDGE_URL&&method==='POST'&&typeof init.body==='string'){
      let body=null;
      try{body=JSON.parse(init.body);}catch{}
      if(body?.operation==='prepare'&&!prepareRaced){prepareRaced=true;return race(input,init,'prepare');}
      if(body?.operation==='cancel'&&!cancelRaced){cancelRaced=true;return race(input,init,'cancel');}
    }
    return baseFetch(input,init);
  };
  return Object.freeze({fetchImpl:wrapped,evidence:()=>Object.freeze({...evidence})});
}

export async function runEdgeConcurrencyCli8D(configuration){
  if(!configuration||Object.keys(configuration).sort().join(',')!=='args,createClient,credential,fetchImpl,now,publicKey,randomUUID,stateDirectory,write'||
    !Array.isArray(configuration.args)||typeof configuration.createClient!=='function'||typeof configuration.credential!=='string'||!MGMT.test(configuration.credential)||/\s/.test(configuration.credential)||
    typeof configuration.fetchImpl!=='function'||typeof configuration.now!=='function'||typeof configuration.randomUUID!=='function'||typeof configuration.stateDirectory!=='string'||configuration.stateDirectory.length<1||typeof configuration.write!=='function')
    throw new Error('INVALID_8D_EDGE_CONCURRENCY_RUNNER_CONFIGURATION');
  const parsed=parseAcceptanceArgs8D(configuration.args);
  if(parsed.mode==='accept'&&(typeof configuration.publicKey!=='string'||!PUBLIC.test(configuration.publicKey)))throw new Error('PUBLIC_PUBLISHABLE_KEY_REQUIRED');
  if(parsed.mode==='recover'&&configuration.publicKey!==null)throw new Error('8D_RECOVERY_MUST_NOT_REQUIRE_OAUTH');
  const {fetchImpl,now,randomUUID,stateDirectory,write}=configuration;
  const backend=createManagementOperatorBackend8D({credentialProvider:async()=>configuration.credential,fetchImpl,now});
  const store=createFileOwnershipStore8D({directory:stateDirectory});
  const ownerId='m8d_owner_'+randomUUID().replaceAll('-','');
  if(!/^m8d_owner_[a-f0-9]{32}$/.test(ownerId))throw new Error('INVALID_8D_RUNNER_RANDOMNESS');
  const transport=createInternalOperatorTransport8D({backend,store,ownerId,now,leaseTtlMs:LEASE_TTL_MS_8D});
  if(parsed.mode==='recover'){
    const result=await transport.recover(parsed.namespace,AbortSignal.timeout(60000));
    write(JSON.stringify({checkpoint:'8D',probe:'real-edge-concurrency',mode:'recover',namespace:parsed.namespace,recovered:result.recovered===true,secretsPrinted:false}));
    return Object.freeze({mode:'recover',namespace:parsed.namespace,recovered:result.recovered===true});
  }

  const namespace=randomUUID();
  const racing=createEdgeConcurrencyFetch8D({fetchImpl,write});
  const sdk=configuration.createClient(ISSUER,configuration.publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input,init={})=>racing.fetchImpl(input,{...init,redirect:'error',signal:AbortSignal.any([init.signal,AbortSignal.timeout(10000)].filter(Boolean))})}});
  const controller=createCloudAcceptanceController8D({namespace,publicKey:configuration.publicKey,now,fetchImpl:racing.fetchImpl,sdk,operator:transport.operator});
  await controller.ready;
  write(JSON.stringify({checkpoint:'8D',probe:'real-edge-concurrency',mode:'accept',namespace,recoveryCommand:`deno run tests/cloud/transaction-edge-concurrency-8d.mjs --recover ${namespace}`,secretsPrinted:false}));
  let accepted=false;
  const probe=createOAuthProbe({publicKey:configuration.publicKey,now,fetchImpl:racing.fetchImpl,verifyAccessToken:async(credential,signal)=>{
    const result=await controller.run(credential,signal);
    const evidence=racing.evidence();
    if(evidence.prepare?.winners!==1||evidence.prepare?.replays!==CONCURRENCY_8D-1||evidence.prepare?.distinctRoutingTraces<2||
      evidence.cancel?.winners!==1||evidence.cancel?.replays!==CONCURRENCY_8D-1||evidence.cancel?.distinctRoutingTraces<2)
      throw new Error('8D_EDGE_CONCURRENCY_INCOMPLETE');
    return result;
  }});
  const listener=startOAuthListener({probe,write:line=>{
    if(typeof line!=='string')return;
    try{const value=JSON.parse(line);if(value?.userEndpointVerified===true&&value?.signedClaimsVerified===true&&value?.hostIdentityAccepted===true&&value?.hostStatusHttpStatus===200&&value?.browserDispatchAllowed===false)accepted=true;}catch{}
    write(line);
  }});
  try{await listener.ready;await new Promise(resolve=>listener.server.once('close',resolve));}
  finally{listener.close();}
  if(!accepted)throw new Error('8D_EDGE_CONCURRENCY_ACCEPTANCE_INCOMPLETE');
  const evidence=racing.evidence();
  const receipt=Object.freeze({
    checkpoint:'8D',
    probe:'real-edge-concurrency',
    namespace,
    concurrency:CONCURRENCY_8D,
    prepareWinners:evidence.prepare.winners,
    cancelWinners:evidence.cancel.winners,
    prepareTraceHeader:evidence.prepare.traceHeader,
    prepareDistinctRoutingTraces:evidence.prepare.distinctRoutingTraces,
    cancelTraceHeader:evidence.cancel.traceHeader,
    cancelDistinctRoutingTraces:evidence.cancel.distinctRoutingTraces,
    browserDispatchAllowed:false,
    clean:true,
    secretsPrinted:false
  });
  write(JSON.stringify(receipt));
  return receipt;
}

async function main(){
  const parsed=parseAcceptanceArgs8D(Deno.args);
  const credential=Deno.env.get('OPERA_8D_MANAGEMENT_TOKEN')||'';
  let createClient=()=>{throw new Error('8D_RECOVERY_MUST_NOT_LOAD_OAUTH_SDK');};
  let publicKey=null;
  if(parsed.mode==='accept'){
    publicKey=Deno.env.get('OPERA_8D_PUBLISHABLE_KEY')||'';
    ({createClient}=await import(SDK_SPECIFIER_8D));
  }
  const result=await runEdgeConcurrencyCli8D({args:Deno.args,createClient,credential,publicKey,fetchImpl:fetch,now:Date.now,randomUUID:crypto.randomUUID.bind(crypto),stateDirectory:join(Deno.cwd(),STATE_DIRECTORY_8D),write:console.log});
  if(result.mode==='recover'&&!result.recovered)console.log('No dirty 8D ownership manifest existed for that namespace.');
}

if(import.meta.main){
  try{await main();}
  catch(error){console.error(error instanceof Error?error.message:'8D_EDGE_CONCURRENCY_RUNNER_FAILED');Deno.exitCode=1;}
}
