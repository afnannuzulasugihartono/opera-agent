// @last-edited: 2026-10-14 UTC+7.
// @title: burst-ref-integrity.test — every workflow burst step references an earlier step.
// @state: structural gate over every workflow migration in the tree.
// @dependencies: node:test, strict, node:fs, node:fs/promises.

// WHY THIS GATE IS PERMANENT. A burst step that names refFromStep equal to or
// past its own index is refused by the device at run time, one workflow at a
// time, which is the most expensive way to learn it. Two hand-written
// migration blobs in one session died on a typo of exactly this shape, and a
// JSON syntax error was worse still: the whole file parsed as a wall of text.
// So the check runs here, over every migration, before any of it ships.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const DIR = new URL('../supabase/migrations/', import.meta.url);

async function workflowMigrations() {
  const files = await readdir(DIR);
  return files.filter((file) => file.endsWith('.sql'));
}

function collectBursts(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectBursts(item, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  if (node.method === 'browser.burst' && Array.isArray(node.params?.steps)) found.push(node.params.steps);
  for (const value of Object.values(node)) collectBursts(value, found);
  return found;
}

test('every burst step references an earlier step in the same burst', async () => {
  const offenders = [];
  for (const file of await workflowMigrations()) {
    const source = await readFile(new URL(file, DIR), 'utf8');
    const blocks = [...source.matchAll(/\$wf\$(.*?)\$wf\$/gs)].map((match) => match[1]);
    if (!blocks.length) continue;
    for (const block of blocks) {
      const definition = JSON.parse(block);
      for (const steps of collectBursts(definition)) {
        steps.forEach((step, index) => {
          const from = step?.refFromStep;
          if (from === undefined || from === null) return;
          if (!Number.isInteger(from) || from < 0 || from >= index) {
            offenders.push(`${file} step ${index} references ${from}`);
          }
        });
      }
    }
  }
  assert.deepEqual(offenders, [], `unusable refs: ${offenders.join(', ')}`);
});

test('every embedded workflow definition is valid JSON', async () => {
  for (const file of await workflowMigrations()) {
    const source = await readFile(new URL(file, DIR), 'utf8');
    const blocks = [...source.matchAll(/\$wf\$(.*?)\$wf\$/gs)];
    for (const [index, match] of blocks.entries()) {
      assert.doesNotThrow(() => JSON.parse(match[1]), `${file} block ${index} must parse as JSON`);
    }
  }
});
