// @last-edited: 2026-10-26 UTC+7.
// @title: migration-ledger-map — the measured map from the tree's migration files to the versions the live ledger holds.
// @state: one entry per file, one evidence class per entry, and the counts the measurement produced; a file the map forgets fails here.
// @dependencies: node:test, node:assert/strict, node:fs.

// WHY THIS FILE IS A GATE AND NOT A DOCUMENT.
// The tree and the live migration ledger disagree, and the disagreement was measured on 2026-10-26 against the live ledger: 106 files, 112 applied versions, 43 versions shared by both sides.
// The map records which version applied each file and on what evidence, so a reader can tell a proved fact from a guess.
// A map that is not checked rots the moment a migration is added, so the tree is read here and every file must be in the map exactly once.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const map = JSON.parse(fs.readFileSync(new URL('supabase/migrations/ledger-map.json', root), 'utf8'));

const EVIDENCE = [
  'version-and-name',
  'name',
  'ledger-names-the-file',
  'content',
  'part-of-combined',
  'applied-outside-ledger',
  'no-ledger-row',
  'applied-then-recorded'
];

const treeFiles = fs.readdirSync(new URL('supabase/migrations/', root))
  .filter((file) => file.endsWith('.sql'))
  .sort();

test('every migration file in the tree is in the map, exactly once', () => {
  const listed = map.map.map((entry) => entry.file).sort();
  assert.deepEqual(listed, treeFiles, 'a migration the map does not name is a migration nobody can prove');
});

test('each entry names one evidence class the measurement can defend', () => {
  for (const entry of map.map) {
    assert.ok(EVIDENCE.includes(entry.evidence), `${entry.file}: unknown evidence ${entry.evidence}`);
  }
});

test('a version is claimed by one file, unless the combined migration carries several', () => {
  const claims = new Map();
  for (const entry of map.map) {
    if (!entry.remote || entry.evidence === 'part-of-combined') continue;
    assert.ok(!claims.has(entry.remote), `${entry.remote} is claimed by both ${claims.get(entry.remote)} and ${entry.file}`);
    claims.set(entry.remote, entry.file);
  }
});

test('a file with no version says which kind of nothing it is', () => {
  for (const entry of map.map) {
    if (entry.remote) continue;
    assert.ok(
      entry.evidence === 'no-ledger-row' || entry.evidence === 'applied-outside-ledger',
      `${entry.file}: no version and no reason`
    );
  }
});

test('the counts the map states are the counts the map holds', () => {
  const counted = {};
  for (const entry of map.map) counted[entry.evidence] = (counted[entry.evidence] || 0) + 1;
  assert.deepEqual(counted, map.counts, 'a stated count that moved is a claim nobody re-measured');
  assert.equal(map.treeFiles, treeFiles.length);
  assert.equal(map.resolved, map.map.filter((entry) => entry.remote).length);
});

test('the two files applied outside the ledger are the ones the database proves', () => {
  const outside = map.map.filter((entry) => entry.evidence === 'applied-outside-ledger').map((entry) => entry.file).sort();
  assert.deepEqual(outside, [
    '20261015090000_opera_billing.sql',
    '20261015091000_opera_invoice_id_text.sql'
  ], 'opera_invoices and opera_price_list exist and opera_invoices.id is text, while no ledger row carries that SQL');
});
