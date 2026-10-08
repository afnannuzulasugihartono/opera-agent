// @last-edited: 2026-10-08 UTC+7.
// @title: browse-workflows.test — Test.
// @state: locks the generic find-in-list crawler contract.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261008220000_opera_agent_browse_find_v3.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

test('find_in_list checks first, crawls bounded, reports honestly', () => {
  const def = definition();
  const json = JSON.stringify(def.steps);
  assert.ok(json.includes('steps.findFirst'), 'checks before scrolling so visible targets are not skipped');
  assert.ok(json.includes('maxIterations'), 'the crawl is bounded');
  assert.ok(def.output.found !== undefined, 'output reports found');
  assert.ok(def.output.ref !== undefined, 'output carries the ref when found');
  assert.ok(JSON.stringify(def.steps).includes('steps.findN.result.count'), 'found is decided by match count, never by item presence (fuzzy fallback returns count 0 with a nearby candidate)');
});

test('find_in_list uses only known runner step types and methods', () => {
  const def = definition();
  const types = new Set(['command', 'if', 'set', 'repeat', 'foreach', 'wait', 'fail']);
  const methods = new Set([
    'tabs.open', 'tabs.get', 'tabs.find', 'tabs.activate',
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
