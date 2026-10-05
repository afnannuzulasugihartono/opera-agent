// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-identity — identity-8d — Server-installed Supabase SDK only. Never accept an SDK/config from request .
// @state: integrate audited local dark host and bound journal candidate.
// @dependencies: none.

// Server-installed Supabase SDK only. Never accept an SDK/config from request data.
// This adapter establishes identity, not approval or browser commit authority.

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const id=value=>typeof value==='string'&&ID.test(value);
export function createSupabaseTransactionIdentity(client,configuration) {
  if (!client?.auth || typeof client.auth.getClaims!=='function' || typeof client.auth.getUser!=='function'
    || typeof client.rpc!=='function' || !configuration || Object.keys(configuration).sort().join(',')!=='audience,issuer'
    || typeof configuration.issuer!=='string' || !/^https:\/\/[^/?#]+\/auth\/v1$/.test(configuration.issuer)
    || configuration.audience!=='authenticated') throw new Error('INVALID_IDENTITY_CONFIGURATION');
  const issuer=configuration.issuer,audience=configuration.audience;
  const getClaims=client.auth.getClaims.bind(client.auth),getUser=client.auth.getUser.bind(client.auth);
  const rpc=client.rpc.bind(client);
  return async (credential,evaluatedAt)=>{
    // evaluatedAt must be supplied by trusted host clock, never HTTP body.
    const now=typeof evaluatedAt==='string'?Date.parse(evaluatedAt)/1000:NaN;
    if(typeof credential!=='string'||credential.length<1||credential.length>8192||/\s/.test(credential)||!Number.isFinite(now))return null;
    try {
      const verified=await getClaims(credential);
      const raw=verified.data?.claims;
      const c=raw?Object.freeze(Object.fromEntries(['iss','aud','role','sub','client_id','session_id','exp','iat'].map(k=>[k,raw[k]]))):null;
      if(verified.error||!c||c.iss!==issuer||c.aud!==audience||c.role!=='authenticated'
        || !id(c.sub)||!id(c.client_id)||!id(c.session_id)||!Number.isInteger(c.exp)||!Number.isInteger(c.iat)
        ||c.iat>now||c.exp<=now||c.exp<=c.iat)return null;
      const result=await getUser(credential); const user=result.data?.user;
      if(result.error||!user||user.id!==c.sub||user.is_anonymous===true)return null;
      const grant=await rpc('opera_tx_identity_read',{p_user_id:c.sub,p_client_id:c.client_id,p_session_id:c.session_id});
      const p=grant.data;
      if(grant.error||!p||p.user_id!==c.sub||p.oauth_client_id!==c.client_id||!id(p.tenant_id)||!id(p.actor_id))return null;
      return Object.freeze({userId:c.sub,tenantId:p.tenant_id,oauthClientId:c.client_id,sessionId:c.session_id,accessExpiresAt:c.exp,acceptanceIdentity:p.actor_id});
    }catch{return null;}
  };
}
