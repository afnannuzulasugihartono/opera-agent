// @last-edited: 2026-10-08 UTC+7.
// @title: youtube-workflows.test — Test.
// @state: locks the watch-and-summarize workflow contract.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261008140000_opera_agent_youtube_watch_summarize_v5.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

test('watch_summarize opens the given url and returns transcript payload', () => {
  const def = definition();
  assert.ok(Array.isArray(def.steps) && def.steps.length > 5);
  const open = def.steps.find((s) => s.method === 'tabs.open');
  assert.ok(open, 'must open a tab itself instead of requiring one');
  assert.deepEqual(open.params.url, { $ref: 'input.url' });
  assert.equal(open.params.active, false);
  assert.ok(def.output.title && def.output.url, 'output names title and url');
  assert.ok(def.output.segments || def.output.text, 'output carries transcript payload');
  assert.ok(JSON.stringify(def.steps).includes('watchAgain'), 'tolerates slow first render with a second watch window');
  assert.ok(JSON.stringify(def.steps).includes('scrollexpand'), 'scrolls the expander into view before clicking');
});

test('watch_summarize uses only known runner step types and methods', () => {
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
