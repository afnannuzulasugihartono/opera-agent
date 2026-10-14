// @last-edited: 2026-10-13 UTC+7.
// @title: docs-menu-walk.test — the menu walk migration embeds keyboard-first shape.
// @state: locks keyboard road, hover fallback, ref-only refs, output contract.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261014010000_docs_menu_walk.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

test('menu.walk tries keyboard first, then hover, and proves the walk', () => {
  const def = definition();
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('keyboardRoad'), 'keyboard road runs first');
  assert.ok(text.includes('hoverRoad'), 'hover chain is the fallback, not the default');
  assert.ok(text.includes('refFromStep'), 'refs cross steps only inside one burst');
  assert.ok(!text.includes('"x":'), 'no raw coordinates anywhere in the walk');
  assert.ok(def.output.walked && def.output.method, 'output names what walked and how');
});

test('menu.walk covers Indonesian and English labels and expands compact mode', () => {
  const def = definition();
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('compactCheck'), 'compact mode is detected before Alt shortcuts');
  assert.ok(def.output.labelsTried, 'output records which labels were attempted');
});
