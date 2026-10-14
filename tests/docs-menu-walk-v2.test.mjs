// @last-edited: 2026-10-14 UTC+7.
// @title: docs-menu-walk-v2.test — level one clicks, deeper levels hover, every find exact.
// @state: locks the v2 walk shape against a return to hover-everything.
// @dependencies: node:test, strict, node:fs.

// WHY level one clicks. A menubar opens on click, never on hover: v1 hovered
// every level and its level-one hover opened nothing, so the level-two find
// died on every Docs menu. The click is proven by the next level's find, and
// each deeper hover the same way, which is the whole chain of proof.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261014110000_docs_menu_walk_v2.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

test('menu.walk v2 clicks level one and hovers deeper levels by index', () => {
  const def = definition();
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('"action":"click"'), 'level one opens by click');
  assert.ok(text.includes('"action":"hover"'), 'deeper levels open by hover');
  assert.ok(text.includes('vars.index'), 'the road branches on the level index');
  assert.ok(text.includes('refFromStep'), 'refs cross steps only inside one burst');
  assert.ok(!text.includes('"x":'), 'no raw coordinates anywhere in the walk');
  assert.ok(def.output.walked && def.output.method, 'output names what walked and how');
});

test('menu.walk v2 finds every level by exact text', () => {
  const def = definition();
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('"exact":true'), 'finds are exact, never substring');
  assert.ok(!text.includes('"alt"'), 'no Alt channel, so no keyboard probe to maintain');
  assert.ok(!text.includes('keyboardRoad'), 'the Alt+F probe is gone with its road');
});

test('menu.walk v2 still expands compact mode before walking', () => {
  const def = definition();
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('compactCheck'), 'compact mode is detected before the walk');
});
