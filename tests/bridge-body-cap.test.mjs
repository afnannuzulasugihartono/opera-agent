// @last-edited: 2026-10-08 UTC+7.
// @title: bridge-body-cap.test — Test.
// @state: pins the bridge bounded body read: chunked bodies without
//   content-length are measured, not just the header.
// @dependencies: node:test, strict, node:fs, node:module, node:vm.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, ''));

function harness({ claim = { ok: false, error: 'Unauthorized device.' } } = {}) {
  const calls = [];
  let handler;
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'opera_claim_next_wait') return { data: claim };
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  vm.runInNewContext(source, {
    createClient: () => client,
    createEdgeLog: () => ({ error() {} }),
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    Request, Response, URL, TextEncoder, crypto
  });
  const pull = (body, init = {}) => handler(new Request('https://example.test/functions/v1/opera-agent-bridge', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...init.headers }, body, ...init
  }));
  return { calls, pull };
}

function streamBody(payload) {
  const bytes = new TextEncoder().encode(payload);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  return { body: stream, duplex: 'half' };
}

test('the bridge measures body bytes, not just the content-length header', () => {
  assert.match(source, /const MAX_BODY = 1024 \* 1024;/);
  assert.match(source, /await req\.text\(\)/);
  assert.match(source, /new TextEncoder\(\)\.encode\(raw\)\.length > MAX_BODY/);
  assert.doesNotMatch(source, /await req\.json\(\)/);
});

test('a chunked body without content-length is still capped at 1 MiB', async () => {
  const h = harness({});
  const { body, duplex } = streamBody('x'.repeat(2 * 1024 * 1024));
  const response = await h.pull(body, {
    headers: { 'Content-Type': 'application/json' }, duplex,
    // undici would set content-length for a string; the stream arrives chunked.
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'Request too large.');
  assert.equal(h.calls.length, 0, 'an oversized body never reaches authentication or claim');
});

test('a small chunked body still parses and reaches the pull path', async () => {
  const h = harness({});
  const { body, duplex } = streamBody(JSON.stringify({ action: 'pull', token: 'a'.repeat(64), deviceName: 'opera' }));
  const response = await h.pull(body, { headers: { 'Content-Type': 'application/json' }, duplex });
  assert.equal(response.status, 401, 'a well-formed small body parses and is decided by claim, not by size');
  assert.ok(h.calls.some((c) => c.name === 'opera_claim_next_wait'), 'legit chunked traffic is unaffected');
});
