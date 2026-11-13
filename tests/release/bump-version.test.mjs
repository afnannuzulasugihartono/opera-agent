// @last-edited: 2026-11-12 UTC+7.
// @title: bump-version - the clocks all move together, or the tree is red.
// @state: one test over the real tree; the enumeration is pinned here so a version added anywhere else fails CI.
// @dependencies: node:test, node:assert/strict, node:fs, node:child_process.

// WHY THIS GATE EXISTS.
// A version bump writes the clock into more files than any reviewer can hold in their head, and a forgotten one reads as a broken release until CI catches it.
// Every file that carries the clock is either named in the bump enumeration (they must all read the current version) or under an allowlist whose content is historical by construction.
// A reference to the current version anywhere else is a new clock nobody taught the bump to move - so this test is the enumeration's contract, and both move in the same PR.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { applyEntries, buildEnumeration, countOccurrences } from '../../scripts/release/bump-version-lib.mjs';

const root = new URL('../../', import.meta.url);
const current = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8')).version;
const currentLine = current.split('.').slice(0, 2).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\.');
const currentPattern = new RegExp(`\\b${currentLine}\\.\\d+(\\.\\d+)?\\b`, 'g');
const allowedFourPart = `${current}.0`;

// The files scripts/release/bump-version.mjs rewrites; each must carry the current version at least once.

const ENUMERATED = [
  'extension/lib/protocol.js',
  'extension/manifest.json',
  'docs/store/store-manifest.json',
  'package.json',
  'local/package.json',
  'scripts/verify/check.mjs',
  'hosted/functions/opera-agent-mcp/index.ts',
  'tests/extension/burst-atomic-actions.test.mjs',
  'tests/extension/hover-settle.test.mjs',
  'tests/hosted/mcp-surface.test.mjs',
  'tests/extension/protocol.test.mjs',
  'tests/extension/role-reconcile.test.mjs',
  'tests/extension/timeout-retry-popup-parity.test.mjs',
  'landing/mcp.html',
  'docs/handoff.md'
];

// Paths whose content is history or unrelated digits by construction; never a clock.

const ALLOW = [
  /^docs\/releases\//,
  /^docs\/superpowers\//,
  /^archive\//,
  /^CHANGELOG\.md$/,
  /^docs\/handoff\.md$/,
  /^tests\/helpers\/boundary-locks\.mjs$/
];

const isText = (file) => /\.(md|mjs|js|ts|json|html|css|yml|yaml|py|sql|toml|txt|xml|svg|lock)$/i.test(file);
let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: new URL('.', root), encoding: 'utf8' }).split('\n').filter(Boolean);
} catch {
  tracked = [];
}

test('every enumerated clock reads the current version', () => {
  for (const file of ENUMERATED) {
    const text = fs.readFileSync(new URL(file, root), 'utf8');
    const hits = text.match(currentPattern) ?? [];
    const own = hits.filter((hit) => hit === current || hit === allowedFourPart);
    assert.ok(own.length >= 1, `${file}: none of its ${hits.length} 1.x match(es) read ${current} - the bump enumeration is stale, or the clock was deleted from the file`);
  }
});

test('the current version appears nowhere outside the enumeration and the allowlist', () => {
  const stray = [];
  for (const file of tracked.filter(isText)) {
    if (ENUMERATED.includes(file)) continue;
    if (ALLOW.some((pattern) => pattern.test(file))) continue;
    const text = fs.readFileSync(new URL(file, root), 'utf8');
    for (const match of text.matchAll(currentPattern)) {
      if (match[0] === current || match[0] === allowedFourPart) stray.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(stray, [], `the current version is carried by file(s) the bump does not know how to move:\n${stray.join('\n')}`);
});

test('two rewrites for the same file both land, in order', () => {
  const handoff = '- main = at the 1.2.3 release commit (everything 1.2.3). See [docs/releases/1.2.3.md](releases/1.2.3.md).';
  const entries = buildEnumeration('1.2.3', '4.5.6').filter((entry) => entry.file === 'docs/handoff.md');
  const out = applyEntries(handoff, entries);
  assert.match(out, /at the 4\.5\.6 release commit/);
  assert.match(out, /everything 4\.5\.6/);
  assert.equal(countOccurrences(out, 'releases/4.5.6.md'), 2);
  assert.equal(countOccurrences(out, '1.2.3'), 0);
});

test('an entry whose expected count is not met fails loudly and names the file', () => {
  const entries = buildEnumeration('1.2.3', '4.5.6').filter((entry) => entry.file === 'extension/manifest.json');
  assert.throws(() => applyEntries('{ "version": "0.0.0" }', entries), /extension\/manifest\.json/);
});

test('a file with several clocks moves them all in one pass', () => {
  const script = "assert.equal(a, '1.2.3'); assert.equal(b, '1.2.3'); assert.equal(c, '1.2.3');";
  const entries = buildEnumeration('1.2.3', '4.5.6').filter((entry) => entry.file === 'scripts/verify/check.mjs');
  const out = applyEntries(script, entries);
  assert.equal(countOccurrences(out, '4.5.6'), 3);
  assert.equal(countOccurrences(out, '1.2.3'), 0);
});
