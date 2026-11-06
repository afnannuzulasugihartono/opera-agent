// @last-edited: 2026-11-06 UTC+7.
// @title: agent-call-docs — the guide a reader is sent to must name the surfaces that exist and the tools that are registered.
// @state: the call guide, the local README, the pilot runbook, and the tool list they must agree with.
// @dependencies: node:test, strict, node:fs, node:url, local/tools.js.

// WHY THE GUIDE IS PINNED TO THE CODE.
// A reader who asks how to call Opera Agent is sent to one file.
// If that file names a tool the server does not register, or a command that does not exist, the reader finds out from an error.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { TOOLS } from '../local/tools.js';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const tools = TOOLS.map((entry) => entry.name);

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

// WHY THE TRANSPORT DEFAULT IS LOCKED.
// The driver asks the bridge on every call when the variable is unset, so "unset" is auto, not CDP - a reader told otherwise waits on a port nobody opened.

test('the guide and the README state the transport default the code implements', () => {
  const guide = read('docs/agent-call.md');
  const readme = read('local/README.md');
  for (const [name, text] of [['the guide', guide], ['the README', readme]]) {
    assert.match(text, /unset \(auto\)/, `${name} says unset means auto`);
    assert.doesNotMatch(text, /unset \(CDP\)/, `${name} does not claim unset means CDP`);
  }
  assert.ok(guide.includes('bridge when an extension is linked'), 'the guide says what auto picks first');
});

// WHY THE PORT REFUSAL IS LOCKED.
// The MCP server opens its session with launch:false, so a port with nothing listening is an error, not a second browser on a fresh profile.

test('the guide says a port with nothing listening is refused, not answered with a second browser', () => {
  const guide = read('docs/agent-call.md');
  assert.ok(guide.includes('No browser is listening on port 9333'), 'the refusal the server gives is named');
  assert.doesNotMatch(guide, /opens a second browser/, 'the guide does not claim the server opens a second browser');
  assert.match(guide, /local\/README\.md/, 'the guide points at the README for starting a browser with a port');
});

// WHY THE HOSTED CLAIM IS DATED.
// The record is one run against one server at one moment; the guide must say when it was taken, and the date must be the record's own.

test('the hosted section is dated from the record and calls it a snapshot', () => {
  const guide = read('docs/agent-call.md');
  const record = JSON.parse(fs.readFileSync(new URL('../proof/hosted-mcp.json', import.meta.url), 'utf8'));
  const day = String(record.checkedAt).slice(0, 10);
  assert.ok(guide.includes(day), `the hosted claim carries the record's date ${day}`);
  assert.match(guide, /snapshot/, 'the guide calls the record a snapshot');
});

// WHY THE CONFIG SHAPE IS LOCKED.
// OpenCode's schema puts servers under mcp.servers and takes snake_case oauth fields; the old mcp.<name> + clientId shape is silently ignored.

test('the guide gives the OpenCode config in the shape OpenCode reads', () => {
  const guide = read('docs/agent-call.md');
  assert.match(guide, /"mcp"\s*:\s*\{\s*"servers"/s, 'servers live under mcp.servers');
  assert.match(guide, /"client_id"\s*:/, 'oauth uses the snake_case client_id field');
  assert.doesNotMatch(guide, /"clientId"/, 'the camelCase field current OpenCode ignores is gone');
  assert.ok(guide.includes('http://127.0.0.1:19876/mcp/oauth/callback'), 'the guide names the redirect the registered client accepts');
});

// WHY THE PROOF CLAIM IS LOCKED.
// The suite re-hashes a fixture on disk; it never drives a browser again, so the record cannot be said to be re-proven.

test('the guide says what the proof test actually re-checks', () => {
  const guide = read('docs/agent-call.md');
  assert.doesNotMatch(guide, /cannot drift away from the code/, 'the overstated sentence is gone');
  assert.ok(guide.includes('re-hashes'), 'the guide says the test re-hashes the fixture');
});
