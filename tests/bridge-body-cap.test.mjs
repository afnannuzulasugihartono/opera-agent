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
    Request, Response, URL, TextEncoder, TextDecoder, crypto
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

test('the bridge reads through a bounded reader, never a full buffer', () => {
  assert.match(source, /const MAX_BODY = 1024 \* 1024;/);
  assert.match(source, /readBoundedBody\(req, MAX_BODY\)/);
  assert.match(source, /req\.body\.getReader\(\)/);
  assert.match(source, /await reader\.cancel\(\)/);
  assert.doesNotMatch(source, /await req\.text\(\)/);
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

test('an oversize chunked body aborts at the cap instead of buffering whole', async () => {
  // WHY pull-counting chunks: req.text() drains every chunk before measuring,
  // so a reader that aborts early must leave most of the stream unread. 128
  // chunks of 16 KiB (2 MiB) against the 1 MiB cap must die after ~65 pulls.
  const TOTAL = 128;
  const CHUNK = 16 * 1024;
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > TOTAL) { controller.close(); return; }
      controller.enqueue(new Uint8Array(CHUNK));
    }
  });
  const h = harness({});
  const response = await h.pull(stream, { headers: { 'Content-Type': 'application/json' }, duplex: 'half' });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'Request too large.');
  assert.equal(h.calls.length, 0, 'an oversized body never reaches authentication or claim');
  assert.ok(pulled < TOTAL, `the reader stopped early after ${pulled} of ${TOTAL} chunks`);
});

test('invalid JSON answers 400, not 500', async () => {
  const h = harness({});
  const { body, duplex } = streamBody('{not json');
  const response = await h.pull(body, { headers: { 'Content-Type': 'application/json' }, duplex });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Body must be JSON.');
  assert.equal(h.calls.length, 0, 'an unparsable body never reaches authentication or claim');
});
