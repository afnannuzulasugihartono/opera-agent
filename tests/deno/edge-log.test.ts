// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: edge-log.test — log.test — Repository file.
// @state: structured edge log helper, convert 3 ad-hoc sites.
// @dependencies: edge-log.

import {createEdgeLog, MAX_LOG_MESSAGE} from "../../supabase/functions/_shared/edge-log.js";
const assert=(value:unknown,message="ASSERTION_FAILED")=>{if(!value)throw new Error(message);};
function mutedConsole(){
  const methods=["error","warn","debug"] as const;
  const slip=console as unknown as Record<string,(...args:unknown[])=>void>;
  const original=new Map<string,(...args:unknown[])=>void>();
  const calls:{method:string;payload:unknown}[]=[];
  for(const method of methods){
    original.set(method,slip[method].bind(console));
    slip[method]=(...args:unknown[])=>{calls.push({method,payload:args[0]});};
  }
  return{calls,restore(){for(const method of methods)slip[method]=original.get(method)!;}};
}
Deno.test("edge log levels emit structured t/level/code/message/commandId records",()=>{
  const muted=mutedConsole();
  try{
    const log=createEdgeLog({commandId:"cmd_1",requestId:"req_1"});
    log.debug("DBG","debug body");
    log.warn("WRN","warn body");
    log.error("ERR","error body");
    assert(muted.calls.length===3,"expected three emissions");
    const expected=[["debug","DBG","debug body"],["warn","WRN","warn body"],["error","ERR","error body"]] as const;
    muted.calls.forEach((call,index)=>{
      assert(call.method===expected[index][0],"level routes to matching console method");
      const record=JSON.parse(String(call.payload)) as Record<string,unknown>;
      assert(record.level===expected[index][0],"record carries level");
      assert(record.code===expected[index][1],"record carries code");
      assert(record.message===expected[index][2],"record carries message");
      assert(record.commandId==="cmd_1","record carries commandId");
      assert(record.requestId==="req_1","record carries requestId");
      assert(Number.isFinite(Date.parse(String(record.t))),"record carries ISO timestamp");
    });
  }finally{muted.restore();}
});
Deno.test("edge log truncates overlong messages at the helper bound",()=>{
  const muted=mutedConsole();
  try{
    const log=createEdgeLog({});
    const record=log.error("OVERLONG","x".repeat(MAX_LOG_MESSAGE+500));
    assert(record.message.length===MAX_LOG_MESSAGE,"message truncated at MAX_LOG_MESSAGE");
    const logged=JSON.parse(String(muted.calls[0].payload)) as Record<string,unknown>;
    assert((logged.message as string).length===MAX_LOG_MESSAGE,"emitted message truncated at MAX_LOG_MESSAGE");
  }finally{muted.restore();}
});
Deno.test("edge log carries ids and nulls them when absent",()=>{
  const muted=mutedConsole();
  try{
    const withIds=createEdgeLog({commandId:"cmd_9",requestId:"req_9"});
    assert(withIds.warn("C","m").commandId==="cmd_9","commandId carried");
    assert(withIds.warn("C","m").requestId==="req_9","requestId carried");
    const withoutIds=createEdgeLog({});
    const record=withoutIds.error("C","m");
    assert(record.commandId===null,"commandId null when absent");
    assert(record.requestId===null,"requestId null when absent");
  }finally{muted.restore();}
});
Deno.test("edge log never throws on circular or undefined payloads",()=>{
  const muted=mutedConsole();
  try{
    const log=createEdgeLog({commandId:"cmd_c"});
    const circular:Record<string,unknown>={};
    circular.self=circular;
    const fromCircular=log.error("CIRC",circular);
    assert(typeof fromCircular.message==="string","circular payload stringified");
    const fromUndefined=log.warn("UNDEF",undefined);
    assert(fromUndefined.message==="","undefined payload becomes empty message");
  }finally{muted.restore();}
});
