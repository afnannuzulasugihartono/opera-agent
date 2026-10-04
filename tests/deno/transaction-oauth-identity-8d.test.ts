// Last edited: 2026-10-04 17:52. Title: transaction-oauth-identity-8d.test — Repository file. Now: add reviewed in-process SDK identity and status-only 8D probe.

import {createClient} from '@supabase/supabase-js';
import {verifyOAuthHostStatus} from '../helpers/transaction-oauth-identity-8d.mjs';
const assert=(value:unknown)=>{if(!value)throw new Error('ASSERTION_FAILED');};
Deno.test('8D actual pinned SDK rejects malformed token without host network',async()=>{
  const client=createClient('https://nenmkmtvjremqphfqnfw.supabase.co','sb_publishable_synthetic',
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  let calls=0;
  try{await verifyOAuthHostStatus(client,'synthetic-invalid-token',{publicKey:'sb_publishable_synthetic',
    signal:new AbortController().signal,fetchImpl:async()=>{calls++;throw new Error('NO_NETWORK');}});throw new Error('UNEXPECTED_SUCCESS');}
  catch(error){assert(error instanceof Error&&error.message==='OAUTH_HOST_PROBE_FAILED');}
  assert(calls===0);
});
