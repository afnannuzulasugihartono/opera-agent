// Last edited: 2026-10-04 17:52. Title: transaction-cloud-acceptance-8d — Explicit opt-in Checkpoint 8D live acceptance/recovery runner. Now: fix(quality): keep helper exact()/CLI-config lines byte-unchanged (default sort already code-unit on ASCII keys) - resolves new-code duplica.

// Explicit opt-in Checkpoint 8D live acceptance/recovery runner.
// Run only after the exact candidate has an independent PASS. This file is test
// infrastructure, not extension/MCP/Edge runtime. It never stores or prints the
// Management credential, PKCE verifier, OAuth bearer, ledger key, or payload token.
import { join } from 'node:path';
import { createCloudAcceptanceController8D } from '../helpers/transaction-cloud-controller-8d.mjs';
import { createManagementOperatorBackend8D } from '../helpers/transaction-cloud-management-backend-8d.mjs';
import { createFileOwnershipStore8D, createInternalOperatorTransport8D } from '../helpers/transaction-cloud-operator-8d.mjs';
import { createOAuthProbe, ISSUER } from '../helpers/transaction-oauth-8d.mjs';
import { startOAuthListener } from '../helpers/transaction-oauth-listener-8d.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MGMT=/^[A-Za-z0-9._~-]{16,8192}$/;
const PUBLIC=/^sb_publishable_[A-Za-z0-9_-]+$/;
export const SDK_SPECIFIER_8D='npm:@supabase/supabase-js@2.57.4';
export const STATE_DIRECTORY_8D='.opera-agent-8d-state';
export const LEASE_TTL_MS_8D=180000;

export function parseAcceptanceArgs8D(args){
  if(!Array.isArray(args))throw new Error('INVALID_8D_RUNNER_ARGUMENTS');
  if(args.length===0)return Object.freeze({mode:'accept'});
  if(args.length===2&&args[0]==='--recover'&&UUID.test(args[1]??''))return Object.freeze({mode:'recover',namespace:args[1]});
  throw new Error('INVALID_8D_RUNNER_ARGUMENTS');
}

export async function runAcceptanceCli8D(configuration){
  if(!configuration||Object.keys(configuration).sort().join(',')!=='args,createClient,credential,fetchImpl,now,publicKey,randomUUID,stateDirectory,write'||
    !Array.isArray(configuration.args)||typeof configuration.createClient!=='function'||typeof configuration.credential!=='string'||!MGMT.test(configuration.credential)||/\s/.test(configuration.credential)||
    typeof configuration.fetchImpl!=='function'||typeof configuration.now!=='function'||typeof configuration.randomUUID!=='function'||typeof configuration.stateDirectory!=='string'||configuration.stateDirectory.length<1||typeof configuration.write!=='function')
    throw new Error('INVALID_8D_RUNNER_CONFIGURATION');
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
    write(JSON.stringify({checkpoint:'8D',mode:'recover',namespace:parsed.namespace,recovered:result.recovered===true,secretsPrinted:false}));
    return Object.freeze({mode:'recover',namespace:parsed.namespace,recovered:result.recovered===true});
  }

  const namespace=randomUUID();
  if(!UUID.test(namespace))throw new Error('INVALID_8D_RUNNER_RANDOMNESS');
  const sdk=configuration.createClient(ISSUER,configuration.publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input,init={})=>fetchImpl(input,{...init,redirect:'error',signal:AbortSignal.any([init.signal,AbortSignal.timeout(10000)].filter(Boolean))})}});
  const controller=createCloudAcceptanceController8D({namespace,publicKey:configuration.publicKey,now,fetchImpl,sdk,operator:transport.operator});
  // The production-shape preflight must finish before an OAuth URL exists.
  await controller.ready;
  write(JSON.stringify({checkpoint:'8D',mode:'accept',namespace,recoveryCommand:`deno run tests/cloud/transaction-cloud-acceptance-8d.mjs --recover ${namespace}`,secretsPrinted:false}));
  let accepted=false;
  const probe=createOAuthProbe({publicKey:configuration.publicKey,now,fetchImpl,verifyAccessToken:(credential,signal)=>controller.run(credential,signal)});
  const listener=startOAuthListener({probe,write:line=>{
    if(typeof line!=='string')return;
    try{const value=JSON.parse(line);if(value?.userEndpointVerified===true&&value?.signedClaimsVerified===true&&value?.hostIdentityAccepted===true&&value?.hostStatusHttpStatus===200&&value?.browserDispatchAllowed===false)accepted=true;}catch{}
    write(line);
  }});
  try{
    await listener.ready;
    await new Promise(resolve=>listener.server.once('close',resolve));
  }finally{listener.close();}
  if(!accepted)throw new Error('8D_LIVE_ACCEPTANCE_INCOMPLETE');
  write(JSON.stringify({checkpoint:'8D',mode:'accept',namespace,accepted:true,browserDispatchAllowed:false,secretsPrinted:false}));
  return Object.freeze({mode:'accept',namespace,accepted:true,browserDispatchAllowed:false});
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
  const result=await runAcceptanceCli8D({args:Deno.args,createClient,credential,publicKey,fetchImpl:fetch,now:Date.now,randomUUID:crypto.randomUUID.bind(crypto),stateDirectory:join(Deno.cwd(),STATE_DIRECTORY_8D),write:console.log});
  if(result.mode==='recover'&&!result.recovered)console.log('No dirty 8D ownership manifest existed for that namespace.');
}

if(import.meta.main){
  try{await main();}
  catch(error){console.error(error instanceof Error?error.message:'8D_RUNNER_FAILED');Deno.exitCode=1;}
}
