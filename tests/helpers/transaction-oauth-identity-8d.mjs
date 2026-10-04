// Last edited: 2026-10-04 17:52. Title: transaction-oauth-identity-8d — Test-only in-process adapter. No enrollment, private RPC, prepare/cancel/approval. Now: refactor(quality): centralize code-unit comparator in lib/canonical-order.js - removes token-identical inline comparator blocks that tripped.

// Test-only in-process adapter. No enrollment, private RPC, prepare/cancel/approval.
import { ISSUER,CLIENT_ID } from './transaction-oauth-8d.mjs';
import { Buffer } from 'node:buffer';
import { codeUnitCompare } from '../../lib/canonical-order.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function verifyOAuthHostStatus(client,credential,{publicKey,signal,now=Date.now,fetchImpl=fetch}) {
  try {
    if(typeof credential!=='string'||credential.length>8192||!credential||signal?.aborted||
      typeof publicKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) throw new Error();
    const verified=await client.auth.getClaims(credential); const raw=verified.data?.claims;
    const c=raw?Object.freeze(Object.fromEntries(['iss','aud','role','sub','client_id','session_id','iat','exp'].map(key=>[key,raw[key]]))):null;
    let time=now()/1000;
    if(verified.error||!c||c.iss!==ISSUER+'/auth/v1'||c.aud!=='authenticated'||c.role!=='authenticated'||
      c.client_id!==CLIENT_ID||!UUID.test(c.sub??'')||!UUID.test(c.session_id??'')||
      !Number.isFinite(time)||!Number.isInteger(c.iat)||!Number.isInteger(c.exp)||c.iat>time||c.exp<=time||c.exp<=c.iat) throw new Error();
    const result=await client.auth.getUser(credential); const user=result.data?.user;
    time=now()/1000;
    if(result.error||!user||user.id!==c.sub||user.is_anonymous===true||signal?.aborted||c.exp<=time) throw new Error();
    const response=await fetchImpl(ISSUER+'/functions/v1/opera-agent-transactions-8d',{
      method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)].filter(Boolean)),
      headers:{'Content-Type':'application/json',apikey:publicKey,Authorization:'Bearer '+credential},
      body:JSON.stringify({operation:'status',transactionId:'m8d_oauth_identity_probe'})});
    if(!response.body) throw new Error();
    const reader=response.body.getReader();const chunks=[];let bytes=0;let body;
    try {
      for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>32768)throw new Error();chunks.push(Buffer.from(value));}
      body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }finally{await reader.cancel().catch(()=>{});}
    if(signal?.aborted||c.exp<=now()/1000||body?.browserDispatchAllowed!==false)throw new Error();
    const keys=Object.keys(body).sort(codeUnitCompare).join(',');
    if(response.status===200){if(keys!=='browserDispatchAllowed,result'||body.result!==null)throw new Error();}
    else if(response.status===503){if(keys!=='browserDispatchAllowed,error'||body.error!=='TRANSACTION_DISABLED')throw new Error();}
    else if(response.status===401){if(keys!=='browserDispatchAllowed,error'||body.error!=='AUTHENTICATION_REQUIRED')throw new Error();}
    else throw new Error();
    return Object.freeze({signedClaimsVerified:true,hostStatusHttpStatus:response.status,
      hostIdentityAccepted:response.status===200,hostDisabled:response.status===503,browserDispatchAllowed:false});
  } catch {throw new Error('OAUTH_HOST_PROBE_FAILED');}
}
