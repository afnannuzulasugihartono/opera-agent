// Last edited: 2026-10-04 17:52. Title: transaction-runtime-8d.test — Actual pinned SDK/runtime, but invalid synthetic credentials only. Now: integrate audited local 8D dark host and bound journal candidate.

import {createClient} from "@supabase/supabase-js";
import {createSupabaseTransactionIdentity} from "../../lib/transaction-identity-8d.js";
import {createTransactionDarkHost} from "../../lib/transaction-host-8d.js";
import {createTransactionDarkHttpHandler} from "../../lib/transaction-http-8d.js";
const assert=(value:unknown)=>{if(!value)throw new Error("ASSERTION_FAILED");};
// Actual pinned SDK/runtime, but invalid synthetic credentials only.
// Tests run without network permission; not a live OAuth acceptance claim.
Deno.test("8D pinned Supabase SDK rejects malformed signed identity before RPC",async()=>{
  const client=createClient("https://example.supabase.co","synthetic-service-key",{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await client.auth.getClaims("synthetic-invalid-token");
  assert(result.error&&result.data===null);
  const identity=createSupabaseTransactionIdentity(client,{issuer:"https://example.supabase.co/auth/v1",audience:"authenticated"});
  assert(await identity("synthetic-invalid-token",new Date().toISOString())===null);
});
Deno.test("8D actual SDK-backed HTTP host remains OFF and rejects invalid bearer when DARK",async()=>{
  const client=createClient("https://example.supabase.co","synthetic-service-key",{auth:{persistSession:false,autoRefreshToken:false}});
  const host=createTransactionDarkHost(client,{issuer:"https://example.supabase.co/auth/v1",audience:"authenticated",clock:()=>new Date()});
  const request=()=>new Request("https://example.invalid/transactions",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer synthetic-invalid-token"},body:JSON.stringify({operation:"status",transactionId:"tx_a"})});
  assert((await createTransactionDarkHttpHandler({host})(request())).status===503);
  assert((await createTransactionDarkHttpHandler({host,enabled:true})(request())).status===401);
});
