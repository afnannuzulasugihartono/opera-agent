// Undeployed 8D candidate. OFF by default; no approval/finalize/browser routing.
import {createClient} from "@supabase/supabase-js";
import {createTransactionDarkHost} from "../../../lib/transaction-host-8d.js";
import {createTransactionDarkHttpHandler} from "../../../lib/transaction-http-8d.js";
import {decodeLedgerKey} from "../../../lib/ledger-token.js";

const enabled=Deno.env.get("OPERA_AGENT_TRANSACTION_DARK_8D")==="true";
let host: (input: unknown,credential: string)=>Promise<unknown>=async()=>{throw Object.assign(new Error("TRANSACTION_DISABLED"),{code:"TRANSACTION_DISABLED"});};
if(enabled){
  const url=Deno.env.get("SUPABASE_URL")||"";
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const transactionKey=Deno.env.get("OPERA_AGENT_TRANSACTION_KEY_8D")||"";
  if(!/^https:\/\/[^/?#]+$/.test(url)||!serviceKey||!transactionKey)throw new Error("INVALID_HOST_CONFIGURATION");
  const client=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  host=createTransactionDarkHost(client,{issuer:url+"/auth/v1",audience:"authenticated",clock:()=>new Date(),transactionKey:decodeLedgerKey(transactionKey)});
}
Deno.serve(createTransactionDarkHttpHandler({enabled,host}));
