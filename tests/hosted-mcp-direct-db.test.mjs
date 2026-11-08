// @last-edited: 2026-11-08 UTC+7.
// @title: hosted-mcp-direct-db — the hosted MCP opens the direct database connection on the HTTP road too.
// @state: the connection is opened in the background, the wait gives it a moment, and a failure is not retried every call.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');

test('an ordinary call opens the direct connection instead of always hopping through PostgREST', () => {
  const rpc = source.slice(source.indexOf('async function rpc('), source.indexOf('type ProgressEmitter'));
  assert.match(rpc, /ensureDirectDb\(\)/, 'the call path asks for the direct connection');
  assert.match(rpc, /rpcViaDirect/, 'and uses it when it is there');
  assert.match(rpc, /rpcViaPostgrest/, 'keeping the hop as the fallback');
});

test('a cold call does not wait for the connection, and a broken one is not retried every call', () => {
  const rpc = source.slice(source.indexOf('async function rpc('), source.indexOf('type ProgressEmitter'));
  const ensure = source.slice(source.indexOf('function ensureDirectDb('), source.indexOf('type ProgressEmitter'));
  assert.match(rpc, /setTimeout\(resolve, 1500\)/, 'the wait for the connection is capped');
  assert.match(ensure, /directDbRetryAfter = Date\.now\(\) \+ 60000/, 'a failed connection is left alone for a minute');
  assert.match(ensure, /connectDirectDb\(\)/, 'and the pool is created once per attempt');
});
