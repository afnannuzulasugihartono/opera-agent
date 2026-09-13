// Acceptance helper only. Not imported by extension/MCP/Edge runtime.
// No storage, logging, token export, refresh, browser dispatch or approval authority.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const ISSUER='https://nenmkmtvjremqphfqnfw.supabase.co';
export const CLIENT_ID='8bf1ff0e-7088-4881-ba76-e36c672453c6';
export const REDIRECT_URI='http://127.0.0.1:6276/oauth/callback';

export function parseLocalCallbackRequest(req) {
  if(req.method!=='GET' || req.headers?.host!=='127.0.0.1:6276' || req.headers.origin ||
    typeof req.url!=='string' || !req.url.startsWith('/oauth/callback?') || req.url.length>4096)
    throw new Error('OAUTH_CALLBACK_INVALID');
  return new URL(req.url,REDIRECT_URI).href;
}

async function boundedJson(response) {
  if(!response.ok || !response.body) throw new Error('invalid response');
  const reader=response.body.getReader(); const chunks=[]; let bytes=0;
  try {
    for(;;) {
      const {done,value}=await reader.read(); if(done) break;
      bytes+=value.byteLength; if(bytes>32768) throw new Error('response limit');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(()=>{}); }
}

/** @param {{publicKey?:string, now?:()=>number, fetchImpl?:typeof fetch, verifyAccessToken?:(credential:string,signal:AbortSignal)=>Promise<{signedClaimsVerified:boolean,hostStatusHttpStatus:number,hostIdentityAccepted:boolean,hostDisabled:boolean,browserDispatchAllowed:boolean}>}} options */
export function createOAuthProbe({publicKey,now=Date.now,fetchImpl=fetch,verifyAccessToken}={}) {
  if(verifyAccessToken!==undefined&&typeof verifyAccessToken!=='function')throw new Error('INVALID_TRUSTED_VERIFIER');
  if(typeof publicKey!=='string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) throw new Error('PUBLIC_PUBLISHABLE_KEY_REQUIRED');
  let verifier=randomBytes(32).toString('base64url');
  const state=randomBytes(32).toString('base64url');
  const deadline=now()+300000; let used=false;
  const abort=new AbortController();
  const auth=new URL('/auth/v1/oauth/authorize',ISSUER);
  for(const [key,value] of Object.entries({response_type:'code',client_id:CLIENT_ID,
    redirect_uri:REDIRECT_URI,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'})) auth.searchParams.set(key,value);
  const close=()=>{used=true; verifier=null; abort.abort();};
  return Object.freeze({authorizationUrl:auth.href,close,async consume(callbackUrl) {
    if(now()>=deadline) {close(); throw new Error('OAUTH_PROBE_CLOSED');}
    if(used) throw new Error('OAUTH_PROBE_CLOSED');
    let callback;
    try {
      if(typeof callbackUrl!=='string' || callbackUrl.length>4096) throw new Error();
      callback=new URL(callbackUrl);
      if(callback.origin+callback.pathname!==REDIRECT_URI || callback.hash || callback.username || callback.password) throw new Error();
      const params=callback.searchParams; const keys=[...params.keys()];
      if(new Set(keys).size!==keys.length || keys.some(key=>!['state','code','error','error_description'].includes(key))) throw new Error();
      const supplied=Buffer.from(params.get('state')??''); const expected=Buffer.from(state);
      if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw new Error();
      if(params.has('error')) {
        if(params.has('code') || !params.get('error')) throw new Error();
      } else if(params.has('error_description') || !params.get('code') || params.get('code').length>2048) throw new Error();
    } catch {throw new Error('OAUTH_CALLBACK_INVALID');}
    used=true;
    if(callback.searchParams.has('error')) {close(); throw new Error('OAUTH_DENIED');}
    let accessToken;
    try {
      const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(Math.max(1,deadline-now()))]);
      const requestSignal=()=>AbortSignal.any([signal,AbortSignal.timeout(10000)]);
      const response=await fetchImpl(ISSUER+'/auth/v1/oauth/token',{method:'POST',redirect:'error',signal:requestSignal(),
        headers:{'Content-Type':'application/x-www-form-urlencoded',apikey:publicKey},
        body:new URLSearchParams({grant_type:'authorization_code',client_id:CLIENT_ID,
          redirect_uri:REDIRECT_URI,code:callback.searchParams.get('code'),code_verifier:verifier}).toString()});
      verifier=null;
      const tokens=await boundedJson(response);
      if(tokens.token_type?.toLowerCase()!=='bearer' || typeof tokens.access_token!=='string' ||
        tokens.access_token.length>16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tokens.access_token) ||
        !Number.isFinite(tokens.expires_in) || tokens.expires_in<=0) throw new Error();
      accessToken=tokens.access_token;
      // Do not retain refresh/id tokens or inspect/decode claims as authority.
      tokens.access_token=null; tokens.refresh_token=null; tokens.id_token=null;
      if(abort.signal.aborted || now()>=deadline) throw new Error();
      const user=await boundedJson(await fetchImpl(ISSUER+'/auth/v1/user',{method:'GET',redirect:'error',signal:requestSignal(),
        headers:{apikey:publicKey,Authorization:'Bearer '+accessToken}}));
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(user.id??'') || abort.signal.aborted || now()>=deadline) throw new Error();
      // Only Auth user-endpoint success. No host client/session admission or approval claim.
      let extra={};
      if(verifyAccessToken){
        extra=await verifyAccessToken(accessToken,signal);
        if(!extra||Object.keys(extra).sort().join(',')!=='browserDispatchAllowed,hostDisabled,hostIdentityAccepted,hostStatusHttpStatus,signedClaimsVerified'||
          extra.signedClaimsVerified!==true||extra.browserDispatchAllowed!==false||![200,401,503].includes(extra.hostStatusHttpStatus)||
          extra.hostIdentityAccepted!==(extra.hostStatusHttpStatus===200)||extra.hostDisabled!==(extra.hostStatusHttpStatus===503))throw new Error();
      }
      if(abort.signal.aborted||now()>=deadline)throw new Error();
      return Object.freeze({userEndpointVerified:true,...extra,browserDispatchAllowed:false});
    } catch {throw new Error('OAUTH_EXCHANGE_FAILED');}
    finally {accessToken=null; close();}
  }});
}
