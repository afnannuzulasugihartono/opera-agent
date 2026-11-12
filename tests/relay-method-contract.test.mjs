// @last-edited: 2026-11-11 UTC+7.
// @title: relay-method-contract - the relay may run exactly the methods the extension serves.
// @state: the seed of the relay's method list, and the proof that it holds every method of the extension's contract.
// @dependencies: node:test, node:assert/strict, node:fs.

// WHY THIS GATE EXISTS.
// The relay keeps its own list of the methods it may run, and it had drifted: two methods the extension serves were missing from it, so the hosted tools that call them were refused by name, and two that were listed carried a shorter budget than the contract gives them.
// A list kept in a table cannot be read by the tree, so the seed that writes it is pinned here against the contract it comes from.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const protocol = fs.readFileSync(new URL('extension/lib/protocol.js', root), 'utf8');

// WHY TWO FILES: the seed was applied and may not be edited, so a second seed, kept beside it, carries the methods the contract gained after it - the gate reads both and holds both to the contract.

const seedFiles = ['supabase/migrations/20261110230000_opera_methods_from_contract.sql', 'supabase/migrations/20261112000000_opera_methods_record_scan.sql', 'supabase/migrations/20261113000000_opera_methods_dump.sql'];
const migration = seedFiles.map((file) => fs.readFileSync(new URL(file, root), 'utf8')).join('\n');

const spec = protocol.match(/export const METHOD_SPECS = Object\.freeze\(\{([\s\S]*?)\n\}\);/)[1];
const methods = [...spec.matchAll(/'([a-z_]+\.[a-z_]+)':\s*\{\s*timeoutMs:\s*(\w+)\s*\}/g)]
  .map((match) => ({ method: match[1], timeout: match[2] }));

test('the contract names the methods it serves', () => {
  assert.ok(methods.length >= 30, `the contract holds its methods, found ${methods.length}`);
  assert.ok(methods.some((entry) => entry.method === 'statement.manifest'), 'including the one the relay was missing');
  assert.ok(methods.some((entry) => entry.method === 'statement.download'), 'and the other one');
});

test('the relay list is seeded from the contract, method for method', () => {
  for (const entry of methods) {
    assert.ok(
      migration.includes(`('${entry.method}',`),
      `the seed writes ${entry.method}, so the relay may run it`
    );
  }
});

test('the seed only touches the methods of the contract', () => {
  const seeded = [...migration.matchAll(/\('([a-z_]+\.[a-z_]+)',\s*\d+,\s*true\)/g)].map((match) => match[1]);
  assert.deepEqual(seeded.sort(), methods.map((entry) => entry.method).sort(),
    'the seeded list is the contract, not a hand-kept copy of it');
});
