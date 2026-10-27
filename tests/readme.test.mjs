// @last-edited: 2026-10-22 UTC+7.
// @title: readme — the README's numbers are measured, so the file cannot drift from the code.
// @state: four gates: the primitive count, the cloud tool count, the local tool count, and the deployed edge functions.
// @dependencies: node:test, node:assert/strict, node:fs, node:path.

// WHY THE README IS CHECKED.
// A README that states a number the code no longer holds is worse than no number, because a reader trusts it and sizes their work by it.
// The three counts here had already gone stale before this file existed: 29 primitives where there are 32, 31 tools where there are 35, and 8 edge functions where there are 9.
// So the numbers are read from the code, and a drift fails the suite rather than ageing in the file.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const repo = (p) => new URL(p, root);
const read = (name) => fs.readFileSync(repo(name), 'utf8');
const readme = read('README.md');

// The primitives: the allowlist the protocol actually exports.

const protocol = read('extension/lib/protocol.js');
const specs = /METHOD_SPECS\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(protocol)?.[1] ?? '';
const primitives = [...specs.matchAll(/^\s{2}'([a-z_]+\.[a-z_]+)':/gm)].map((m) => m[1]);

// The cloud tools: the frozen contract, which the suite already holds byte-for-byte.

const contract = JSON.parse(read('tests/fixtures/mcp-contract-v1.json'));

// The local tools: what the local server registers.

const localServer = read('local/agent/mcp-server.js');
const localTools = new Set([...read('local/agent/tools.js').matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1]));

// The edge functions: the directories that hold an entrypoint.

const edgeFunctions = fs.readdirSync(repo('supabase/functions'))
  .filter((name) => name !== '_shared')
  .filter((name) => fs.readdirSync(repo(`supabase/functions/${name}`)).includes('index.ts'));

// The row of the contract table that says what this is.

const row = (label) => {
  const line = readme.split('\n').find((candidate) => candidate.startsWith(`| ${label} |`));
  assert.ok(line, `the README must have a ${label} row in its contract table`);
  return line;
};
const countIn = (label) => {
  const match = /\*\*(\d+)\*\*/.exec(row(label));
  assert.ok(match, `the README ${label} row must state a number`);
  return Number(match[1]);
};

test('the README states the number of browser primitives the protocol allows', () => {
  assert.ok(primitives.length > 0, 'the protocol must export an allowlist to count');
  assert.equal(countIn('Browser primitives'), primitives.length,
    `the README must say the protocol allows ${primitives.length} primitives`);
});

test('the README states the number of cloud MCP tools the contract freezes', () => {
  assert.equal(contract.toolCount, contract.tools.length, 'the contract must agree with itself');
  assert.equal(countIn('Cloud MCP surface'), contract.toolCount,
    `the README must say the cloud surface has ${contract.toolCount} tools`);
});

test('the README states the number of local MCP tools the server registers', () => {
  assert.ok(localTools.size > 0, 'the local server must register tools to count');
  assert.equal(countIn('Local MCP surface'), localTools.size,
    `the README must say the local surface has ${localTools.size} tools`);
});

test('the README states how many edge functions are deployed, and names them', () => {
  const layout = readme.split('\n').find((line) => line.startsWith('| `supabase/functions/` |'));
  assert.ok(layout, 'the README must have a row for the edge functions');
  const claimed = /\((\d+) deployed\)/.exec(layout);
  assert.ok(claimed, 'the README must say how many edge functions are deployed');
  assert.equal(Number(claimed[1]), edgeFunctions.length,
    `the README must say ${edgeFunctions.length} edge functions are deployed`);
  for (const directory of edgeFunctions) {
    const short = directory.replace('opera-agent-', '');
    assert.ok(layout.toLowerCase().includes(short.toLowerCase()),
      `the README must name the ${directory} edge function`);
  }
});
