// @last-edited: 2026-10-21 UTC+7.
// @title: bridge-body-cap.test — the bridge reads a body of unknown length without trusting the header.
// @state: the chunked body is measured, not assumed, and the cap refuses the body that is too large.
// @dependencies: node:test, strict, node:fs, node:module, node:vm.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import {
  CORS_DEFAULT_ORIGINS,
  resolveAllowedOrigin
} from '../supabase/functions/_shared/cors.js';
import {
  isUpgradeRequest,
  serveDeviceSocket
} from '../supabase/functions/opera-agent-bridge/bridge-socket.ts';

// WHY THE IMPORT STRIP SPANS LINES.
// A list of specifiers is written one per line, so the statement begins with `import {` and ends with `} from '...';` on a line of its own.
// Matching only a one-line import left the statement in the harness, and the vm refuses it as an import outside a module.

const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8')
  .replace(/^import [\s\S]*?;\r?\n/gm, ''));

// The upgrade path is stripped out of the harness source so a body test cannot be dragged into socket territory, and is supplied here instead.
// The real symbols are used rather than a stand-in: a fake upgrade detector would pass these tests while the production one still hijacked a normal POST.

const bodySource = source.replace(/^\/\/ WHY the socket is checked[\s\S]*?^Deno\.serve\(\(req: Request\) => \{/m, 'Deno.serve((req: Request) => {');

function harness() {
  const calls = [];
  let handler;
  const client = {
    async rpc(
      name,
      args
    ) {
      calls.push({
        name,
        args
      });
      if (name === 'opera_heartbeat') return { data: {
        ok: false,
        error: 'Unauthorized device.'
      } };
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  vm.runInNewContext(bodySource, {
    createClient: () => client,
    createEdgeLog: () => ({ error() {} }),
    CORS_DEFAULT_ORIGINS,
    resolveAllowedOrigin,
    isUpgradeRequest,
    serveDeviceSocket,
    Deno: {
      env: { get: () => 'test' },
      serve: (fn) => {
        handler = fn;
      }
    },
    Request,
    Response,
    Headers,
    URL,
    TextEncoder,
    TextDecoder,
    crypto
  });
  const post = (
    body,
    init = {}
  ) => handler(new Request('https://example.test/functions/v1/opera-agent-bridge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers
    },
    body,
    ...init
  }));
  return {
    calls,
    post
  };
}

function streamBody(payload) {
  const bytes = new TextEncoder().encode(payload);
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(bytes); controller.close();
  } });
  return {
    body: stream,
    duplex: 'half'
  };
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
  const h = harness();
  const {
    body,
    duplex
  } = streamBody('x'.repeat(2 * 1024 * 1024));
  const response = await h.post(body, {
    headers: { 'Content-Type': 'application/json' },
    duplex,
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'Request too large.');
  assert.equal(h.calls.length, 0, 'an oversized body never reaches authentication or claim');
});

test('a small chunked body still parses and reaches the heartbeat path', async () => {
  const h = harness();
  const {
    body,
    duplex
  } = streamBody(JSON.stringify({
    action: 'heartbeat',
    token: 'a'.repeat(64),
    deviceName: 'opera'
  }));
  const response = await h.post(body, {
    headers: { 'Content-Type': 'application/json' },
    duplex
  });
  assert.equal(response.status, 401, 'a well-formed small body parses and is decided by auth, not by size');
  assert.ok(h.calls.some((c) => c.name === 'opera_heartbeat'), 'legit chunked traffic is unaffected');
});

test('an oversize chunked body aborts at the cap instead of buffering whole', async () => {
  const TOTAL = 128;
  const CHUNK = 16 * 1024;
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > TOTAL) {
        controller.close(); return;
      }
      controller.enqueue(new Uint8Array(CHUNK));
    }
  });
  const h = harness();
  const response = await h.post(stream, {
    headers: { 'Content-Type': 'application/json' },
    duplex: 'half'
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'Request too large.');
  assert.equal(h.calls.length, 0, 'an oversized body never reaches authentication or claim');
  assert.ok(pulled < TOTAL, `the reader stopped early after ${pulled} of ${TOTAL} chunks`);
});

test('invalid JSON answers 400, not 500', async () => {
  const h = harness();
  const {
    body,
    duplex
  } = streamBody('{not json');
  const response = await h.post(body, {
    headers: { 'Content-Type': 'application/json' },
    duplex
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Body must be JSON.');
  assert.equal(h.calls.length, 0, 'an unparsable body never reaches authentication or claim');
});
