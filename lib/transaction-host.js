// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-host — host-8d — Isolated dark host. No approval/finalize/browser operation in user routing.
// @state: integrate audited local dark host and bound journal candidate.
// @dependencies: goal-ledger, transaction-identity, transaction-admission, ledger-token, transaction-token.

// Isolated dark host. No approval/finalize/browser operation in user routing.

import { canonicalJson, digestCanonical } from './goal-ledger.js';
import { createSupabaseTransactionIdentity } from './transaction-identity.js';
import { createTransactionAdmission } from './transaction-admission.js';
import { decodeLedgerKey, openLedgerToken } from './ledger-token.js';
import { sealTransactionToken } from './transaction-token.js';
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export function createTransactionDarkHost(client,configuration) {
  if(!configuration||!['audience,clock,issuer','audience,clock,issuer,transactionKey'].includes(Object.keys(configuration).sort().join(','))
    ||typeof configuration.clock!=='function')throw new Error('INVALID_HOST_CONFIGURATION');
  const key=configuration.transactionKey;
  if(key!==undefined&&(!(key instanceof Uint8Array)||key.byteLength!==32))throw new Error('INVALID_HOST_CONFIGURATION');
  const transactionKey=key?.slice();
  const authenticate=createSupabaseTransactionIdentity(client,{issuer:configuration.issuer,audience:configuration.audience});
  const clock=configuration.clock,rpc=client.rpc.bind(client);
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  return async(input,credential)=>{
    if(!input||typeof input!=='object'||Array.isArray(input)
      ||![Object.prototype,null].includes(Object.getPrototypeOf(input))
      ||(!['status','cancel','prepare'].includes(input.operation)))fail('INVALID_REQUEST');
    if(input.operation==='prepare'){
      if(Object.keys(input).sort().join(',')!=='arguments,ledgerToken,operandBindings,operation,prepared'
        ||typeof input.ledgerToken!=='string'||!transactionKey)fail('INVALID_REQUEST');
    }else if(Object.keys(input).sort().join(',')!=='operation,transactionId'
      ||typeof input.transactionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.transactionId))fail('INVALID_REQUEST');
    if(new TextEncoder().encode(canonicalJson(input)).length>524288)fail('LIMIT_REACHED');
    const request=freeze(JSON.parse(canonicalJson(input)));
    const evaluatedAt=clock().toISOString();
    const identity=await authenticate(credential,evaluatedAt);
    if(!identity)fail('AUTHENTICATION_REQUIRED');
    let result;
    if(request.operation==='prepare'){
      const storage=async(name,args)=>{const r=await rpc(name,args);if(r.error)fail('STORAGE_ERROR');return r.data;};
      const rawBinding=await storage('opera_tx_binding_read',{p_tenant:identity.tenantId,p_actor:identity.acceptanceIdentity,p_tx:request.prepared?.transactionId});
      const binding=rawBinding?freeze(JSON.parse(canonicalJson(rawBinding))):null;
      if(!binding||binding.mode!=='DARK'||binding.preparedDigest!==request.prepared?.prepareDigest
        ||!Array.isArray(binding.operands)||new TextEncoder().encode(canonicalJson(binding)).length>131072)fail('AUTHORITY_NOT_RESOLVED');
      const cryptoState=await storage('opera_goal_crypto_key',{});
      if(!cryptoState?.enabled||typeof cryptoState.key!=='string')fail('TRANSACTION_DISABLED');
      const opened=await openLedgerToken(request.ledgerToken,decodeLedgerKey(cryptoState.key),{now:evaluatedAt});
      if(opened.ledger.tenantId!==identity.tenantId||opened.ledger.ledgerDigest!==binding.ledgerDigest)fail('AUTHORITY_NOT_RESOLVED');
      const admission=createTransactionAdmission({
        authenticate:async()=>identity,loadPolicy:async()=>binding.mode,
        loadCurrentLedger:async()=>{
          const head=await storage('opera_goal_head_get',{p_tenant_id:identity.tenantId,p_goal_id:opened.ledger.goalId});
          if(!head?.ok||head.headRevision!==opened.ledger.revision||head.headDigest!==opened.ledger.ledgerDigest||head.status!==opened.ledger.status)fail('AUTHORITY_NOT_RESOLVED');
          return opened.ledger;
        },loadCurrentTarget:async()=>binding.target,authorizeExactAction:async(_identity,ledger)=>{
          // This journal-only synthetic adapter cannot attest real-world rules.
          // Unknown/freeform non-goals or predicates require a later evaluator.
          if(ledger.constraints.length||ledger.nonGoals.length)return null;
          return binding.grant;
        },
        resolveOperand:async(_identity,_tx,record)=>binding.operands.find(p=>canonicalJson(p)===canonicalJson(record))||null,
      });
      const admitted=await admission({prepared:request.prepared,arguments:request.arguments,operandBindings:request.operandBindings},credential,evaluatedAt);
      const payload=await sealTransactionToken(request.prepared,transactionKey,{kind:'PREPARED',tenantId:identity.tenantId,transactionId:admitted.transactionId,prepareDigest:admitted.prepareDigest});
      result=await rpc('opera_tx_prepare_bound',{p_tenant:identity.tenantId,p_actor:identity.acceptanceIdentity,p_identity:identity,p_prepared:request.prepared,p_ledger_digest:admitted.ledgerDigest,p_fence:await digestCanonical(admitted),p_payload:payload});
    }else result=await rpc('opera_tx_metadata',{p_operation:request.operation,p_tenant:identity.tenantId,p_actor:identity.acceptanceIdentity,p_identity:identity,p_tx:request.transactionId});
    if(result.error)fail('STORAGE_ERROR');

    // No raw SQL error, OAuth token, key, request arguments or proof in response.
    if(result.data===null)return null;
    const value=result.data;
    if(!value||value.browserDispatchAllowed!==false)fail('INVALID_HOST_RESPONSE');
    const keys=['transactionId','status','leaseEpoch','transition','commitKey','replay','browserDispatchAllowed'];
    const statuses=['PREPARING','PREPARED','VALIDATING','AWAITING_APPROVAL','APPROVED','COMMITTING','COMMITTED_UNVERIFIED','OBSERVING','VERIFIED','REJECTED','CANCELLED','EXPIRED','FAILED','AMBIGUOUS'];
    if(Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key))
      ||typeof value.transactionId!=='string'||value.transactionId!==(request.transactionId??request.prepared.transactionId)
      ||!statuses.includes(value.status)||!Number.isInteger(value.leaseEpoch)||value.leaseEpoch<0||value.leaseEpoch>2147483646
      ||!Number.isInteger(value.transition)||value.transition<0||value.transition>100
      ||typeof value.commitKey!=='string'||!/^tx1:[0-9a-f]{64}$/.test(value.commitKey)||typeof value.replay!=='boolean')fail('INVALID_HOST_RESPONSE');
    return Object.freeze(JSON.parse(canonicalJson(value)));
  };
}
