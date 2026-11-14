// @last-edited: 2026-11-14 UTC+7.
// @title: code-standard - explicit tools and one flat output shape for the local surface.
// @state: the local stdio surface tidied its output through tidyForAi, every advertised tool carries description and argument docs, and the tab argument accepts anything list_tabs answers with.
// @dependencies: node:test, strict, ../local/tools.js.

// WHY THIS FILE IS A GATE.
// An agent reading the tool table sees two loose ends: a tool without a description of what it does, and a schema property the model has to guess at, and guesses cost turns and tokens.
// A stdio server that prints raw envelopes instead of the one flat shape every surface prints has been shipped once already; the tests passed and the model saw nested junk.
// So all three are pinned, one test each.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const source = (rel) => readFileSync(new URL(rel, root), 'utf8');

test('the local stdio surface answers through tidyForAi', () => {
  const mcp = source('local/mcp-server.js');
  assert.match(mcp, /import \{ tidyForAi \} from '\.\/tidy\.js'/, 'local tool output goes through the shared K&R flattener - the model sees one shape');
});

test('the local tool table advertises explicit descriptions and argument docs', async () => {
  const mod = await import(new URL('../../local/tools.js', import.meta.url));
  const undocumented = [];
  for (const tool of mod.TOOLS) {
    if (!tool.description || tool.description.trim().length < 60) {
      undocumented.push(`${tool.name}: description too short`);
    }
    const properties = tool.inputSchema?.properties ?? {};
    for (const [name, schema] of Object.entries(properties)) {
      if (!schema.description || schema.description.trim().length < 8) {
        undocumented.push(`${tool.name}.${name}: argument type lacks a description`);
      }
    }
  }
  assert.deepEqual(undocumented, [], `\n${undocumented.join('\n')}`);
});

test('the tab argument accepts every shape list_tabs answers with', () => {
  const tools = source('local/tools.js');
  assert.match(tools, /const tabArg = \{ type: \['string', 'number'\]/, 'tabId accepts both strings and numbers - list_tabs and the bridge both answer with either');
});
