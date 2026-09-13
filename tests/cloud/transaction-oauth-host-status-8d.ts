// Opt-in actual pinned SDK; no enrollment/private RPC/prepare/cancel/logout.
import {createClient} from '@supabase/supabase-js';
import {createOAuthProbe,ISSUER} from '../helpers/transaction-oauth-8d.mjs';
import {startOAuthListener} from '../helpers/transaction-oauth-listener-8d.mjs';
import {verifyOAuthHostStatus} from '../helpers/transaction-oauth-identity-8d.mjs';

const publicKey=Deno.env.get('OPERA_8D_PUBLISHABLE_KEY')||'';
const probe=createOAuthProbe({publicKey,verifyAccessToken:async(credential:string,signal:AbortSignal)=>{
  const client=createClient(ISSUER,publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input,init)=>fetch(input,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])})}});
  return await verifyOAuthHostStatus(client,credential,{publicKey,signal});
}});
const listener=startOAuthListener({probe});
const stop=()=>{listener.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
listener.server.once('close',stop);
try{await listener.ready;}
catch{console.log('Local callback unavailable; no alternate port/client created.');Deno.exitCode=1;stop();}
