// @last-edited: 2026-11-06 UTC+7.
// @title: agent-call-docs — the guide a reader is sent to must name the surfaces that exist and the tools that are registered.
// @state: the call guide, the local README, the pilot runbook, and the tool list they must agree with.
// @dependencies: node:test, strict, node:fs, node:url.

// WHY THE GUIDE IS PINNED TO THE CODE.
// A reader who asks how to call Opera Agent is sent to one file.
// If that file names a tool the server does not register, or a command that does not exist, the reader finds out from an error.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const tools = [...read('local/tools.js').matchAll(/name:\s*'([a-z_]+)'/g)].map((match) => match[1]);

test('the call guide names every surface that exists', () => {
  const guide = read('docs/agent-call.md');
  assert.ok(guide.includes('opera-agent-mcp'), 'the hosted server is named');
  assert.match(guide, /local\/bin\/opera-local\.js/, 'the local server is named');
  assert.match(guide, /extension/, 'the extension road is named');
});

test('the guide and the README agree with the tool list', () => {
  const readme = read('local/README.md');
  assert.ok(readme.includes(`The server advertises ${tools.length} tools`), 'the README counts the tools the server registers');
  for (const tool of tools) assert.ok(readme.includes(tool), `the README must name ${tool}`);
});

test('every page a reader is sent to names the command that works today', () => {
  const pages = [
    ['the guide', read('docs/agent-call.md')],
    ['the README', read('local/README.md')],
    ['the runbook', read('docs/product/pilot-runbook.md')]
  ];
  for (const [name, text] of pages) {
    assert.match(text, /node local\/bin\/opera-local\.js/, `${name} must name the command that works from a clone`);
  }
});
