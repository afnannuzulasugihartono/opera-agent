// @last-edited: 2026-11-09 UTC+7.
// @title: tidy-output - the rules are kept by a gate, not by memory.
// @state: the bounded reporter stays in the test script, and the hub names the rules and this gate inside Always.
// @dependencies: node:test, strict, node:fs.

// WHY THIS FILE IS A GATE AND NOT A THOUGHT.
// A green suite used to print a wall of TAP, unscrollable in a terminal.
// The dot reporter shrinks that to a dot per test and prints failures in full, but no reporter is self-enforcing - one edit switches it back and nobody notices.
// This file pins the contract the hub announces inside Always: the test script keeps the bounded reporter, the hub carries the rules, and the hub points at this gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');

test('npm test runs on the bounded reporter, so a green suite prints nothing to scroll', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /--test-reporter=dot\b/, 'one dot per test, failures printed in full');
  assert.doesNotMatch(pkg.scripts.test, /--test-reporter=tap\b/, 'TAP is unbounded; it is the wall this rule exists to stop');
});

test('the hub carries the tidy rules inside the section every agent reads every turn', () => {
  const agents = read('AGENTS.md');
  const always = agents.slice(agents.indexOf('## Always'), agents.indexOf('## Goals'));
  assert.match(always, /Read the lines you need, never the file/, 'the reading rule is named in Always');
  assert.match(always, /Filter before you display/, 'the filtering rule is named in Always');
});

test('the hub names this gate, so the rules cannot rot silently', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /tests\/tidy-output\.test\.mjs/, 'the hub points at the gate that keeps it');
});

test('the check surface keeps its one-line success', () => {
  const check = read('scripts/verify/check.mjs');
  assert.match(check, /check ok:/, 'a green check prints a single summary line, not a log');
});
