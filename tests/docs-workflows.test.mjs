// @last-edited: 2026-10-08 UTC+7.
// @title: docs-workflows.test — Test.
// @state: locks the docs append workflow contract.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261008170000_opera_agent_docs_append.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

test('docs append navigates to the given doc and types without vision', () => {
  const def = definition();
  assert.ok(Array.isArray(def.steps) && def.steps.length > 3);
  const nav = def.steps.find((s) => s.method === 'tabs.open' || s.method === 'tabs.navigate');
  assert.ok(nav, 'must open the doc url itself instead of requiring it open');
  assert.deepEqual(nav.params.url, { $ref: 'input.url' });
  const keys = JSON.stringify(def.steps);
  assert.ok(keys.includes('trusted'), 'canvas text entry requires the trusted path');
  assert.ok(def.output.verified !== undefined, 'output reports the append outcome');
});

test('docs append uses only known runner step types and methods', () => {
  const def = definition();
  const types = new Set(['command', 'if', 'set', 'repeat', 'foreach', 'wait', 'fail']);
  const methods = new Set([
    'tabs.open', 'tabs.get', 'tabs.find', 'tabs.navigate', 'tabs.activate',
    'page.wait_for', 'page.query', 'page.find', 'page.click', 'page.key', 'page.pointer', 'page.read', 'page.scroll', 'page.capture', 'media.state'
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
