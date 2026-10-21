// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: edge-syntax.test — syntax.test — Frozen contract: every edge-function entrypoint must parse under Deno.
// @state: escape quotes in mcp instructions literal, add parse regression test.
// @dependencies: node:test, strict, promises.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mcpSurfaceSource } from './helpers/mcp-surface-source.mjs';

test('mcp instructions literal has no unescaped quotes', async () => {
  const source = await mcpSurfaceSource();
  const line = source.split('\n').find((l) => l.includes('instructions: "Use Opera Agent'));
  assert.ok(line, 'instructions literal not found');
  const first = line.indexOf('"Use Opera Agent');
  const last = line.lastIndexOf('"');
  assert.ok(last > first, 'literal has no closing quote');
  const body = line.slice(first + 1, last);
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '"' && body[i - 1] !== '\\') {
      assert.fail(`unescaped quote at offset ${i}: ...${body.slice(Math.max(0, i - 30), i + 30)}...`);
    }
  }
});
