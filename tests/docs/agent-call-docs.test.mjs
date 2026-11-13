// @last-edited: 2026-11-09 UTC+7.
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

test('the call guide names every surface that exists', () => {
  const guide = read('docs/agent-call.md');
  assert.ok(guide.includes('opera-agent-mcp'), 'the installed command is named');
  assert.match(guide, /opera-agent-mcp local/, 'the local mode is named');
  assert.match(guide, /opera-agent-mcp cloud/, 'the cloud mode is named');
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
// The everyday browser was the silently failing case: a refuse with no reason reads as a broken extension.
// The one command that answers what is connected, the plan, and the quota is the doctor.

test('the guide names the doctor as the answer for a broken install', () => {
  const guide = read('docs/agent-call.md');
  assert.match(guide, /opera-agent-mcp doctor/, 'the doctor is named');
  assert.match(guide, /PLAN_LIMIT_REACHED/, 'the meter refusal is named');
  assert.doesNotMatch(guide, /No browser is listening on port 9333/, 'the dead port refusal is gone');
});

// WHY THE HOSTED CLAIM IS DATED.
// The record is one run against one server at one moment; the guide must say when it was taken, and the date must be the record's own.

test('the hosted section is dated from the record and calls it a snapshot', () => {
  const guide = read('docs/agent-call.md');
  const record = JSON.parse(fs.readFileSync(new URL('../../docs/proof/hosted-mcp.json', import.meta.url), 'utf8'));
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

test('the guide teaches the whole-page read and the full-page capture', () => {
  const guide = read('docs/agent-call.md');
  assert.match(guide, /view: "map"/, 'the map view of read_page is named');
  assert.match(guide, /skeleton/, 'the first call is described as the skeleton');
  assert.match(guide, /nextOffset/, 'the pull is described with its cursor');
  assert.match(guide, /tileOffset/, 'the tile walk is described');
  assert.match(guide, /document coordinates/, 'the rect is stated as document coordinates');
});

test('the guide says where the worker faults are read', () => {
  const guide = read('docs/agent-call.md');
  assert.match(guide, /browser_status/, 'the tool that answers the faults is named');
  assert.match(guide, /errorCount/, 'the running total is named');
  assert.match(guide, /worker/, 'and the guide says whose faults they are');
});
