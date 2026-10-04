// @last-edited: 2026-10-04 11:10 UTC.
// @title: transaction-http-8d — http-8d — Isolated HTTP boundary for the dark host; never a public MCP tool or executor.
// @context: Shared pure module, server and extension.
// @state: integrate audited local 8D dark host and bound journal candidate.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

// Isolated HTTP boundary for the dark host; never a public MCP tool or executor.
const LIMIT=524288;
const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
const response=(body,status)=>new Response(JSON.stringify(body),{status,headers});
export function createTransactionDarkHttpHandler(configuration){
  if(!configuration||typeof configuration.host!=='function'||Object.keys(configuration).some(key=>!['enabled','host'].includes(key))
    ||(configuration.enabled!==undefined&&typeof configuration.enabled!=='boolean'))throw new Error('INVALID_HTTP_CONFIGURATION');
  const host=configuration.host,enabled=configuration.enabled===true;
  const error=(code,status)=>response({error:code,browserDispatchAllowed:false},status);
  return async request=>{
    if(!enabled)return error('TRANSACTION_DISABLED',503);
    if(request.method!=='POST')return error('METHOD_NOT_ALLOWED',405);
    const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]{1,8192})$/)?.[1];
    if(!token)return error('AUTHENTICATION_REQUIRED',401);
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||''))return error('INVALID_CONTENT_TYPE',415);
    const declared=request.headers.get('content-length');
    if(declared!==null&&(!/^\d{1,9}$/.test(declared)||Number(declared)>LIMIT))return error('LIMIT_REACHED',413);
    let input;
    try{
      const reader=request.body?.getReader();if(!reader)return error('INVALID_REQUEST',400);
      let length=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>LIMIT){await reader.cancel();return error('LIMIT_REACHED',413);}chunks.push(value);}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(!input||typeof input!=='object'||Array.isArray(input)||!['prepare','status','cancel'].includes(input.operation))return error('INVALID_REQUEST',400);
    }catch{return error('INVALID_REQUEST',400);}
    try{return response({result:await host(input,token),browserDispatchAllowed:false},200);}
    catch(failure){
      const code=failure?.code;
      if(code==='AUTHENTICATION_REQUIRED')return error(code,401);
      if(['TRANSACTION_DISABLED','STORAGE_ERROR','TRANSACTION_EXPIRED'].includes(code))return error(code,503);
      if(code==='LIMIT_REACHED')return error(code,413);
      return error('INVALID_REQUEST',400);
    }
  };
}
