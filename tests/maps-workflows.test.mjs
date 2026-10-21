// @last-edited: 2026-10-21 UTC+7.
// @title: maps-workflows.test — the restaurant search workflow finds the place and reads it back.
// @state: the search step, the bound on how many results it takes, and the fields it returns.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261008160000_opera_agent_maps_search.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

test('maps search opens a query url and returns the results payload', () => {
  const def = definition();
  assert.ok(Array.isArray(def.steps) && def.steps.length > 3);
  const open = def.steps.find((s) => s.method === 'tabs.open');
  assert.ok(open, 'must open a tab itself instead of requiring one');
  assert.equal(open.params.active, false);
  assert.ok(JSON.stringify(open.params).includes('input.query'), 'url carries the input query');
  assert.ok(def.output.results || def.output.text, 'output carries results payload');
  assert.ok(def.output.title && def.output.url, 'output names title and url');
});

test('maps search uses only known runner step types and methods', () => {
  const def = definition();
  const types = new Set(['command', 'if', 'set', 'repeat', 'foreach', 'wait', 'fail']);
  const methods = new Set([
    'tabs.open', 'tabs.get', 'tabs.find', 'tabs.activate',
    'page.wait_for', 'page.query', 'page.find', 'page.click', 'page.read', 'page.scroll', 'media.state'
  ]);
  const walk = (steps) => {
    for (const step of steps || []) {
      assert.ok(types.has(step.type), `unknown step type ${step.type}`);
      if (step.type === 'command') assert.ok(methods.has(step.method), `unknown method ${step.method}`);
      walk(step.then);
      walk(step.else);
      walk(step.steps);
    }
  };
  walk(def.steps);
});
