// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-token.test — token.test — Test.
// @context: Test.
// @state: drop the milestone suffix from transaction test files and titles.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: strict, node:fs, node:test, transaction-prepare, transaction-token-8d.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareTransaction } from '../lib/transaction-prepare.js';
import { openTransactionToken, sealTransactionToken } from '../lib/transaction-token-8d.js';

const candidate = JSON.parse(fs.readFileSync(new URL('./fixtures/transaction-examples-v1.json',import.meta.url))).validTransactions[0];
const key = new Uint8Array(32).fill(7); // Synthetic, never a production key.
async function fixture() {
  const raw = structuredClone(candidate); delete raw.prepareDigest;
  const prepared = await prepareTransaction(raw);
  return { prepared, context: { kind:'PREPARED',tenantId:prepared.tenantId,transactionId:prepared.transactionId,prepareDigest:prepared.prepareDigest } };
}
test('authenticated transaction tokens roundtrip bounded prepared metadata', async () => {
  const {prepared,context} = await fixture();
  const token = await sealTransactionToken(prepared,key,context);
  assert.match(token,/^oatx1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  assert.equal(token.includes(prepared.tenantId),false);
  assert.deepEqual(await openTransactionToken(token,key,context),prepared);
  assert.notEqual(token,await sealTransactionToken(prepared,key,context));
});
test('token tamper, wrong key and swapped tenant/transaction/prepare/kind fail', async () => {
  const {prepared,context} = await fixture();
  const token = await sealTransactionToken(prepared,key,context);
  for (const replacement of [
    {tenantId:'other'}, {transactionId:'other'}, {prepareDigest:`sha256:${'9'.repeat(64)}`}, {kind:'JOURNAL'},
  ]) await assert.rejects(openTransactionToken(token,key,{...context,...replacement}));
  const parts=token.split('.'); parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
  await assert.rejects(openTransactionToken(parts.join('.'),key,context));
  await assert.rejects(openTransactionToken(token,new Uint8Array(32).fill(8),context));
});
test('token context cannot hide credentials, unbound claims or raw browser state', async () => {
  const {prepared,context} = await fixture();
  await assert.rejects(sealTransactionToken(prepared,key,{...context,approved:true}));
  for (const invalid of [null,[],{...context,tenantId:123},{...context,transactionId:456}])
    await assert.rejects(sealTransactionToken(prepared,key,invalid),{code:'INVALID_CONTEXT'});
  await assert.rejects(sealTransactionToken({...prepared,password:'forbidden'},key,context));
  await assert.rejects(sealTransactionToken({...prepared,rawPage:'forbidden'},key,context));
  await assert.rejects(sealTransactionToken(prepared,new Uint8Array(31),context));
  await assert.rejects(sealTransactionToken({...prepared,rawPage:'x'.repeat(131073)},key,context),{code:'OVER_LIMIT'});
});
test('journal payload is a separate closed digest-only token kind', async () => {
  const {context} = await fixture(); context.kind='JOURNAL';
  const payload={schemaVersion:'OA_TX_JOURNAL_PAYLOAD_8D_V1',tenantId:context.tenantId,transactionId:context.transactionId,prepareDigest:context.prepareDigest,transitionDigest:`sha256:${'a'.repeat(64)}`};
  const token=await sealTransactionToken(payload,key,context);
  assert.deepEqual(await openTransactionToken(token,key,context),payload);
  await assert.rejects(sealTransactionToken({...payload,PROVED:true},key,context));
});
