// @last-edited: 2026-11-08 UTC+7.
// @title: mcp-package.test — the published package carries every module it imports, or it is a broken install.
// @state: the package name and binary, the file list against the imports, and the packed tarball's contents.
// @dependencies: node:test, strict, promises, node:fs, node:path, node:child_process.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const local = new URL('local/', root);
const manifest = JSON.parse(await readFile(new URL('local/package.json', root), 'utf8'));

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...await sourceFiles(child));
    else if (entry.name.endsWith('.js')) out.push(child);
  }
  return out;
}

function importsOf(source) {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]).filter((specifier) => specifier.startsWith('.'));
}

test('the package is named and run the way the guide says', () => {
  assert.equal(manifest.name, 'opera-agent-mcp');
  assert.ok(manifest.bin['opera-agent-mcp'], 'the package installs one command');
  assert.equal(manifest.type, 'module');
  assert.ok(manifest.engines.node, 'the package says which node it needs');
});

test('every module the package imports is inside the package', async () => {
  const files = await sourceFiles(local);
  const packageRoot = new URL('local/', root).pathname;
  const missing = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      const resolved = new URL(specifier, file).pathname;
      if (!resolved.startsWith(packageRoot)) {
        missing.push(`${path.relative(root.pathname, file.pathname)} imports ${specifier}, outside the package`);
        continue;
      }
      if (!existsSync(new URL(`file://${resolved}`))) {
        missing.push(`${path.relative(root.pathname, file.pathname)} imports ${specifier}, which does not exist`);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('the packaged copy of the shared endpoint module still pins the region', async () => {
  const { socketUrl } = await import('../local/lib/endpoints.js');
  assert.equal(socketUrl('https://example.test/bridge'), 'wss://example.test/bridge?forceFunctionRegion=ap-southeast-1');
});

test('the package lists every module the server needs, and its shared copies are the current ones', async () => {
  const files = manifest.files;
  for (const needed of ['bin/opera-agent-mcp.js', 'mcp-server.js', 'bridge-ws.js', 'tools.js', 'lib/endpoints.js', 'lib/socket-protocol.js']) {
    assert.ok(files.includes(needed), `the package must ship ${needed}`);
  }
  for (const name of ['socket-protocol.js', 'endpoints.js']) {
    const source = await readFile(new URL(`extension/lib/${name}`, root), 'utf8');
    const copy = await readFile(new URL(`local/lib/${name}`, root), 'utf8');
    assert.equal(copy, source, `local/lib/${name} has drifted from extension/lib/${name}; run node scripts/pack-mcp.mjs`);
  }
});
