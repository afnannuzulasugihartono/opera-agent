// @last-edited: 2026-11-08 UTC+7.
// @title: edge-syntax.test — every edge-function entrypoint parses, so a broken build cannot boot.
// @state: the instructions literal, and the parse of every function entrypoint in the tree.
// @dependencies: node:test, strict, promises, node:fs, node:module.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
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

// WHY THE ENTRYPOINTS ARE PARSED HERE.
// A duplicate declaration is a SyntaxError, and a SyntaxError in an edge function is a BOOT_ERROR in production: the function answers nobody, and nothing in the suite says so.
// This gate caught exactly that: a constant declared twice in index.ts passed every other test and took the function down.

function parses(source) {
  const withoutImports = source.replace(/^\s*import[^;]*;?$/gm, '');
  const withoutExports = withoutImports.replace(/^\s*export\s+(?=(const|let|var|function|async|class))/gm, '');
  return new Function(withoutExports);
}

test('the parser this gate uses can catch a duplicate declaration', () => {
  assert.throws(() => parses('const A = 1;\nconst A = 2;\n'), SyntaxError);
});

test('every edge function entrypoint parses', async () => {
  const dir = new URL('../supabase/functions/', import.meta.url);
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== '_shared')
    .sort();

  assert.ok(names.length > 0, 'the tree has edge functions');
  for (const name of names) {
    const source = stripTypeScriptTypes(await readFile(new URL(`${name}/index.ts`, dir), 'utf8'));
    assert.doesNotThrow(() => parses(source), `${name}/index.ts does not parse`);
  }
});
