// @last-edited: 2026-10-13 UTC+7.
// @title: docs-structure.test — structure workflow migrations embed valid, proven JSON.
// @state: locks heading, list, table, and image workflow shapes and proofs.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => {
  const migration = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, `${name} must embed the workflow JSON`);
  return JSON.parse(match[1]);
};

test('apply_heading styles by shortcut with a menu fallback and proves the style', () => {
  const def = read('20261014020000_docs_apply_heading.sql');
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('Ctrl') || text.includes('control'), 'heading shortcut is the fast road');
  assert.ok(text.includes('menuFallback'), 'menu road backs up the shortcut');
  assert.ok(def.output.applied && def.output.style, 'output proves the applied style');
});

test('make_list types items and proves the count', () => {
  const def = read('20261014030000_docs_make_list.sql');
  assert.ok(JSON.stringify(def.steps).includes('foreach'), 'items are typed one per step');
  assert.ok(def.output.count, 'output proves the item count');
});

test('insert_table walks Insert menu and proves dimensions', () => {
  const def = read('20261014040000_docs_insert_table.sql');
  assert.ok(JSON.stringify(def.steps).includes('Table'), 'table path is walked, not typed');
  assert.ok(def.output.rows && def.output.cols && def.output.verified, 'output proves dimensions');
});

test('insert_image uploads and leaves the caption paragraph ready', () => {
  const def = read('20261014050000_docs_insert_image.sql');
  assert.ok(JSON.stringify(def.steps).includes('Image'), 'image path is walked');
  assert.ok(def.output.placed, 'output proves placement');
});

// WHY v2 proofs poll instead of reading once. Canvas content reaches the DOM
// mirrors on Docs time, not ours: the outline lags saves by seconds, so a
// single read races the mirror and flakes. A bounded repeat exits early on
// success and fails loudly on exhaustion, which is a wait with proof.

test('apply_heading v2 polls the outline for the exact text, then falls back by menu', () => {
  const def = read('20261014120000_docs_apply_heading_v2.sql');
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('"type":"repeat"'), 'the outline is polled, never read once');
  assert.ok(text.includes('input.text'), 'the poll looks for the caller text exactly');
  assert.ok(text.includes('menuFallback'), 'the menu road still backs up the shortcut');
  assert.ok(text.includes('"exact":true'), 'menu finds are exact');
  assert.ok(def.output.applied && def.output.style, 'output proves the applied style');
});

test('make_list v2 proves the word count the caller computed', () => {
  const def = read('20261014130000_docs_make_list_v2.sql');
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('foreach'), 'items are typed one per step');
  assert.ok(text.includes('expectedWords'), 'the count dialog is read against caller words');
  assert.ok(text.includes('WORDS_MISSING'), 'a count miss fails naming the miss');
  assert.ok(def.output.verified && def.output.count, 'output proves the count');
});
