// @last-edited: 2026-10-21 UTC+7.
// @title: docs-read-workflows.test — the docs read workflow opens the doc and returns one bounded screenshot.
// @state: the open step, the capture step, and the bound on what the model may read.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261008190000_opera_agent_docs_read.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

test('docs read opens the doc and returns one bounded screenshot', () => {
  const def = definition();
  const open = def.steps.find((s) => s.method === 'tabs.open');
  assert.ok(open, 'must open a tab itself instead of requiring one');
  assert.equal(open.params.active, false);
  const cap = def.steps.find((s) => s.method === 'page.capture');
  assert.ok(cap, 'must capture the canvas for the model to read');
  assert.ok(Number(cap.params.maxWidth) <= 800, 'screenshot stays small enough for workflow output');
  assert.ok(Number(cap.params.quality) <= 60, 'screenshot stays small enough for workflow output');
  assert.ok(def.output.screenshot, 'output carries the screenshot');
  assert.ok(def.output.title && def.output.url, 'output names title and url');
});

test('docs read uses only known runner step types and methods', () => {
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
