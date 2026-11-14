// @last-edited: 2026-11-14 UTC+7.
// @title: agent-call-docs — the guide a reader is sent to must name the surfaces that exist and the tools that are registered.
// @state: the call guide, the local README, the pilot runbook, and the tool list they must agree with.
// @dependencies: node:test, strict, node:fs, node:url, local/tools.js.

// WHY THE GUIDE IS PINNED TO THE CODE.
// A reader who asks how to call Opera Agent is sent to one file.
// If that file names a tool the server does not register, or a command that does not exist, the reader finds out from an error.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { TOOLS } from '../../local/tools.js';

const read = (name) => fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const tools = TOOLS.map((entry) => entry.name);

test('the call guide names the one surface, and no dead one', () => {
  const guide = read('docs/agent-call.md');
  assert.ok(guide.includes('opera-agent-mcp'), 'the installed command is named');
  assert.match(guide, /opera-agent-mcp local/, 'the local mode is named');
  assert.doesNotMatch(guide, /opera-agent-mcp cloud/, 'the deleted cloud mode is not named');
  assert.match(guide, /extension/, 'the extension road is named');
});

test('the guide and the README agree with the tool list', () => {
  const readme = read('local/README.md');
  assert.ok(readme.includes(`The server advertises ${tools.length} tools`), 'the README counts the tools the server registers');
  for (const tool of tools) assert.ok(readme.includes(tool), `the README must name ${tool}`);
});

test('every page a reader is sent to names the install that works today', () => {
  const pages = [
    ['the guide', read('docs/agent-call.md')],
    ['the README', read('local/README.md')],
    ['the runbook', read('docs/product/pilot-runbook.md')]
  ];
  for (const [name, text] of pages) {
    assert.match(text, /npm i -g opera-agent-mcp|npm install -g \./, `${name} must name the install that works today`);
  }
});

// WHY THE ROAD IS LOCKED.
// The debug port died with the loopback bridge; a reader told to pick a transport waits on a port nothing opens.
// The docs must say the bridge is the one road.

test('the guide says the bridge is the one road, with no transport flag left', () => {
  const guide = read('docs/agent-call.md');
  const readme = read('local/README.md');
  for (const [name, text] of [['the guide', guide], ['the README', readme]]) {
    assert.doesNotMatch(text, /OPERA_LOCAL_TRANSPORT/, `${name} does not carry the dead flag`);
  }
  assert.match(guide, /loopback bridge/i, 'the guide names the road');
});

// WHY THE DOCTOR IS THE GATE FOR A BROKEN INSTALL.
// The everyday browser was the silently failing case: a refuse with no reason read as a broken extension.
// The one command that answers what is connected, the plan, and the quota is the doctor.

test('the guide names the doctor as the answer for a broken install', () => {
  const guide = read('docs/agent-call.md');
  assert.match(guide, /opera-agent-mcp doctor/, 'the doctor is named');
  assert.match(guide, /PLAN_LIMIT_REACHED/, 'the meter refusal is named');
  assert.doesNotMatch(guide, /No browser is listening on port 9333/, 'the dead port refusal is gone');
});

// WHY THE CONFIG SHAPE IS LOCKED.
// OpenCode's schema puts servers under mcp.servers; the guide must give the shape the reader's harness actually reads.

test('the guide gives the OpenCode config in the shape OpenCode reads', () => {
  const guide = read('docs/agent-call.md');
  assert.match(guide, /"mcp"\s*:\s*\{\s*"servers"/s, 'servers live under mcp.servers');
  assert.match(guide, /"type"\s*:\s*"local"/, 'the server type is local, not remote');
  assert.doesNotMatch(guide, /"type"\s*:\s*"remote"/, 'the deleted remote verb is gone');
  assert.match(guide, /"args"\s*:\s*\[\s*"local"/, 'the local mode is what is passed');
});

// WHY THE PROOF CLAIM IS LOCKED.
// The suite re-hashes a fixture on disk; it never drives a browser again, so the record cannot be said to be re-proven.

test('the guide says what the proof test actually re-checks', () => {
  const guide = read('docs/agent-call.md');
  assert.doesNotMatch(guide, /cannot drift away from the code/, 'the overstated sentence is gone');
  assert.ok(guide.includes('re-hashes'), 'the guide says the test re-hashes the fixture');
});

test('the guide teaches the capture ladder and the settled flag', () => {
  const guide = read('docs/agent-call.md');
  assert.match(guide, /settled/, 'the settled flag is named');
  assert.match(guide, /allowCaretMove/, 'the consented borrow for canvas editors is named');
  assert.match(guide, /grewBy/, 'the two-reads growth bound is named');
  assert.match(guide, /scan_page/, 'the measuring call is named');
});

test('the guide says how a device out of quota answers', () => {
  const guide = read('docs/agent-call.md');
  assert.match(guide, /planExhaustedDevices/, 'the exhaustion marker is named');
  assert.match(guide, /5000 and 500|one daily count/i, 'the shape of the meter is named');
});
