// @last-edited: 2026-10-13 UTC+7.
// @title: docs-ui-map.test — every menu label workflows use resolves in the map.
// @state: locks EN+ID coverage and verify selectors per path.
// @dependencies: node:test, strict, node:fs, ../supabase/functions/_shared/docs-ui-map.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveMenuTarget } from '../supabase/functions/_shared/docs-ui-map.js';

test('every menu label the workflows use exists in the map', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const texts = new Set();
  for (const file of fs.readdirSync(dir)) {
    if (!/_docs_/.test(file)) continue;
    const src = fs.readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/"action":"find","text":"([^"]+)"/g)) texts.add(m[1]);
  }
  assert.ok(texts.size > 5, 'expected several menu labels across workflows');
  for (const label of texts) {
    assert.ok(resolveMenuTarget([label]), `map covers ${label}`);
  }
});

test('resolveMenuTarget serves both locales with verify selectors', () => {
  const en = resolveMenuTarget([
    'Insert',
    'Table'
  ], 'en');
  assert.deepEqual(en.labels, [
    'Insert',
    'Table'
  ]);
  assert.ok(en.verify && en.verify.selector.includes('menu'));
  const id = resolveMenuTarget([
    'Insert',
    'Table'
  ], 'id');
  assert.deepEqual(id.labels, [
    'Sisipkan',
    'Tabel'
  ]);
});
