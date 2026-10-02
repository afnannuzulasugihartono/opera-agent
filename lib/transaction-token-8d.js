// Local-only metadata tokens. Does not issue approval or grant commit authority.
import { canonicalJson } from './goal-ledger.js';
import { validatePreparedTransaction } from './transaction-prepare.js';

const KINDS = new Set(['PREPARED','JOURNAL']);
const HASH = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const bytes = (value) => new TextEncoder().encode(value);
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
// Not exported: thrown from this module and narrowed by `instanceof` in the
// same module, so an export would be unreachable surface.
// tests/r9-hygiene.test.mjs fails if it comes back without a caller.
class TransactionTokenError extends Error {
  constructor(code) { super(code); this.name='TransactionTokenError'; this.code=code; }
}
const fail = (code) => { throw new TransactionTokenError(code); };
function context(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)
    || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail('INVALID_CONTEXT');
  const ctx=JSON.parse(canonicalJson(value));
  if (Object.keys(ctx).sort().join(',') !== 'kind,prepareDigest,tenantId,transactionId'
    || !KINDS.has(ctx.kind) || typeof ctx.tenantId!=='string' || typeof ctx.transactionId!=='string'
    || typeof ctx.prepareDigest!=='string' || !ID.test(ctx.tenantId) || !ID.test(ctx.transactionId) || !HASH.test(ctx.prepareDigest)) fail('INVALID_CONTEXT');
  return freeze(ctx);
}
function encode(value) {
  let text='';
  for (let i=0;i<value.length;i+=32768) text+=String.fromCharCode(...value.subarray(i,i+32768));
  return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail('INVALID_TOKEN');
  const text=value.replace(/-/g,'+').replace(/_/g,'/');
  try {
    const result=Uint8Array.from(atob(text+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
    if (encode(result)!==value) fail('INVALID_TOKEN');
    return result;
  } catch { fail('INVALID_TOKEN'); }
}
async function key(value) {
  if (!(value instanceof Uint8Array) || value.byteLength!==32) fail('INVALID_KEY');
  return crypto.subtle.importKey('raw',value,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
const aad = (ctx) => bytes(`opera-agent-transaction:v1:${canonicalJson(ctx)}`);
async function validatePayload(value,ctx) {
  const text=canonicalJson(value);
  if (bytes(text).length>131072) fail('OVER_LIMIT');
  let payload;
  if (ctx.kind==='PREPARED') payload=await validatePreparedTransaction(JSON.parse(text));
  else {
    payload=JSON.parse(text);
    if (Object.keys(payload).sort().join(',')!=='prepareDigest,schemaVersion,tenantId,transactionId,transitionDigest'
      || payload.schemaVersion!=='OA_TX_JOURNAL_PAYLOAD_8D_V1' || !HASH.test(payload.transitionDigest)) fail('INVALID_PAYLOAD');
  }
  if (payload.tenantId!==ctx.tenantId || payload.transactionId!==ctx.transactionId || payload.prepareDigest!==ctx.prepareDigest) fail('BINDING_MISMATCH');
  return freeze(payload);
}
export async function sealTransactionToken(value,keyBytes,expectedContext) {
  const ctx=context(expectedContext);
  const payload=await validatePayload(value,ctx);
  const plaintext=bytes(canonicalJson({version:1,context:ctx,payload}));
  if (plaintext.length>132096) fail('OVER_LIMIT');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(ctx)},await key(keyBytes),plaintext));
  const token=`oatx1.${encode(iv)}.${encode(encrypted)}`;
  if (bytes(token).length>196608) fail('OVER_LIMIT');
  return token;
}
export async function openTransactionToken(token,keyBytes,expectedContext) {
  const ctx=context(expectedContext);
  if (typeof token!=='string' || bytes(token).length>196608) fail('INVALID_TOKEN');
  const parts=token.split('.');
  if (parts.length!==3 || parts[0]!=='oatx1') fail('INVALID_TOKEN');
  const iv=decode(parts[1]); const ciphertext=decode(parts[2]);
  if (iv.length!==12 || ciphertext.length<17) fail('INVALID_TOKEN');
  try {
    const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(ctx)},await key(keyBytes),ciphertext);
    if (decrypted.byteLength>132096) fail('OVER_LIMIT');
    const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decrypted));
    if (Object.keys(envelope).sort().join(',')!=='context,payload,version' || envelope.version!==1
      || canonicalJson(envelope.context)!==canonicalJson(ctx)) fail('INVALID_TOKEN');
    return await validatePayload(envelope.payload,ctx);
  } catch (error) {
    if (error instanceof TransactionTokenError) throw error;
    fail('INVALID_TOKEN');
  }
}
