// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: index — Checkpoint 8D fenced review candidate. NOT DEPLOYED by this commit.
// @state: clear deno require-await and no-unused-vars in edge functions.
// @dependencies: supabase-js, transaction-host-8d, transaction-http-8d, ledger-token.

// Checkpoint 8D fenced review candidate. NOT DEPLOYED by this commit.
// The environment flag is only a static deployment/master kill switch. Per-run
// DARK admission is controlled by the service-only database operator fence.

import {createClient} from "@supabase/supabase-js";
import {createTransactionDarkHost} from "../../../lib/transaction-host-8d.js";
import {createTransactionDarkHttpHandler} from "../../../lib/transaction-http-8d.js";
import {decodeLedgerKey} from "../../../lib/ledger-token.js";

const masterEnabled=Deno.env.get("OPERA_AGENT_TRANSACTION_DARK_8D")==="true";
let host: (input: unknown,credential: string)=>Promise<unknown>=()=>Promise.reject(Object.assign(new Error("TRANSACTION_DISABLED"),{code:"TRANSACTION_DISABLED"}));
if(masterEnabled){
  const url=Deno.env.get("SUPABASE_URL")||"";
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const transactionKey=Deno.env.get("OPERA_AGENT_TRANSACTION_KEY_8D")||"";
  if(!/^https:\/\/[^/?#]+$/.test(url)||!serviceKey||!transactionKey)throw new Error("INVALID_HOST_CONFIGURATION");
  const client=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const transactionHost=createTransactionDarkHost(client,{issuer:url+"/auth/v1",audience:"authenticated",clock:()=>new Date(),transactionKey:decodeLedgerKey(transactionKey)});
  host=async(input,credential)=>{
    const {data,error}=await client.rpc("opera_tx_operator_host_gate_8d");
    if(error||data!==true)throw Object.assign(new Error("TRANSACTION_DISABLED"),{code:"TRANSACTION_DISABLED"});
    return transactionHost(input,credential);
  };
}
Deno.serve(createTransactionDarkHttpHandler({enabled:masterEnabled,host}));
