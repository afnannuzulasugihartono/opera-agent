// @last-edited: 2026-11-02 UTC+7.
// @title: opera-plugin-child - the native tools run in a child that is replaced when the code moves.
// @state: one spawn and one respawn, driven through the real plugin, the real bin and the real files.
// @dependencies: node:test, strict, node:fs, ../local/bin/opera-opencode.js.

// WHY THIS IS AN INTEGRATION TEST AND NOT A FAKE.
// The bug it holds is the one a fake cannot see: the module cache hands a reloaded plugin the code it was loaded with, so the tools answer with the old build and nothing in a unit test objects.
// Only a real child, started from the real bin, proves that a write in the tree becomes a server that reads it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  createOperaPlugin,
  pluginChildStarts
} from '../local/bin/opera-opencode.js';

const textOf = (result) => {
  const part = result?.content?.find?.((one) => one.type === 'text');
  return String(part?.text ?? '');
};

const registry = () => {
  const added = [];
  return {
    added,
    ctx: {
      tool: {
        transform: async (fn) => {
          fn({
            namespace: () => {},
            add: (tool) => added.push(tool),
            remove: () => {}
          });
        }
      }
    }
  };
};

test('a write in the tree is answered by a fresh tool server, with no reload', async () => {
  const {
    added,
    ctx
  } = registry();
  await createOperaPlugin().setup(ctx);
  const guide = added.find((tool) => tool.name === 'guide');

  const before = pluginChildStarts();
  const first = await guide.execute({ topic: 'wait' }, ctx);
  assert.match(textOf(first), /recipes/, 'the child answers a tool the same shape the server does');
  assert.equal(pluginChildStarts(), before + 1, 'the first call started one child');

  const same = await guide.execute({ topic: 'wait' }, ctx);
  assert.match(textOf(same), /recipes/);
  assert.equal(pluginChildStarts(), before + 1, 'and a second call reuses it');

  const marker = new URL('../local/tools.js', import.meta.url);
  const now = new Date();
  fs.utimesSync(marker, now, now);
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const after = await guide.execute({ topic: 'wait' }, ctx);
  assert.match(textOf(after), /recipes/);
  assert.equal(pluginChildStarts(), before + 2, 'a tree write started a fresh child, which is the reload');
});