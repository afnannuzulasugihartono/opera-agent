// @last-edited: 2026-10-12 UTC+7.
// @title: cf-postgrest — the PostgREST RPC call, checked without a network.
// @state: 4 locks; endpoint shape, failure mapping, credential gate, deadline.
// @dependencies: node:test, strict, ../cloudflare/src/postgrest.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgrest } from '../cloudflare/src/postgrest.js';

const client = (seen, { ok = true, json = { ok: true }, fail = null } = {}) => {
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (fail) throw fail;
    return { ok, json: async () => json };
  };
  return createPostgrest({
    baseUrl: 'https://ref.supabase.co',
    serviceKey: 'service-key',
    fetchImpl,
    timeoutMs: 1000
  });
};

test('an RPC POSTs name and args to the PostgREST endpoint', async () => {
  const seen = [];
  const data = await client(seen).rpc('opera_enqueue', { p_method: 'tabs.list' });

  assert.deepEqual(data, { ok: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://ref.supabase.co/rest/v1/rpc/opera_enqueue');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.apikey, 'service-key');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer service-key');
  assert.equal(seen[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen[0].init.body), { p_method: 'tabs.list' });
  assert.ok(seen[0].init.signal, 'the call carries no deadline');
});

test('a refused call throws instead of resolving garbage', async () => {
  const seen = [];
  await assert.rejects(
    client(seen, { ok: false }).rpc('opera_enqueue', {}),
    /opera_enqueue responded 0|opera_enqueue failed/
  );
});

test('a throwing fetch becomes a rejection the caller can catch', async () => {
  await assert.rejects(
    client([], { fail: new Error('socket reset') }).rpc('opera_enqueue', {}),
    /socket reset/
  );
});

test('missing credentials fail before touching the network', async () => {
  const seen = [];
  const bad = createPostgrest({
    baseUrl: '', serviceKey: '',
    fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok: true, json: async () => ({}) }; }
  });

  await assert.rejects(bad.rpc('opera_enqueue', {}), /credentials/);
  assert.equal(seen.length, 0);
});
