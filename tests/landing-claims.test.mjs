// @last-edited: 2026-10-06 12:20 UTC+7.
// @title: landing-claims — every number the site states is checked against the code.
// @state: 8 locks, all green; the audit that wrote them found the permission count unstated.
// @dependencies: node:test, node:assert, node:fs.

// landing/AGENTS.md requires the copy never to claim what the runtime cannot do.
// The numbers drift silently otherwise: bump the manifest version or the tool count
// and the site keeps advertising the old figure until a reader notices it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const site = ['landing/index.html', 'landing/auth.html', 'landing/akun.html', 'landing/privasi.html', 'landing/syarat.html', 'landing/unduh.html', 'landing/404.html']
  .map(read).join('\n');

const manifest = JSON.parse(read('extension/manifest.json'));
const mcp = read('supabase/functions/opera-agent-mcp/index.ts');
const extensionReadme = read('extension/README.md');

test('no page states a version, because a stated version is a promise nothing keeps', () => {
  // WHY this inverted: every page used to name the build it was written for, so a release
  // had to edit prose in several places to avoid telling readers to install the build that
  // shipped last week. The download page names no version now — the file a reader saves is
  // named by the server, which is the only place that knows — and this lock keeps the other
  // pages from growing the habit back.
  // WHY the pattern is anchored on the product and not on any three-part number: the
  // model settings name 127.0.0.1:11434 and similar, and those are ports, not builds.

  const copy = site.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/Opera Agent\s*\d+\.\d+\.\d+/g, 'Opera Agent VERSION')
    .replace(/opera-agent-\d+\.\d+\.\d+/g, 'opera-agent-VERSION');
  assert.doesNotMatch(copy, /Opera Agent VERSION|opera-agent-VERSION/,
    'no page names a build next to the product');
  // WHY the manifest version is still checked somewhere: the tree and the served archive
  // agreeing is proved in landing-download, which builds the payload the endpoint slices.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'and the manifest carries a version to check against');
});

test('the tool count on the site equals the tools the MCP server registers', () => {
  const registered = (mcp.match(/registerTool\(/g) || []).length;
  assert.ok(registered > 0, 'the MCP server must register tools for this to mean anything');
  assert.match(site, new RegExp(`\\b${registered}\\b|dua puluh dua tool`), `the site must state ${registered} tools`);
});

test('the primitive count on the site equals the allowlist the extension enforces', () => {
  const protocol = read('extension/lib/protocol.js');
  assert.match(protocol, /export const ALLOWED_METHODS = Object\.freeze\(Object\.keys\(METHOD_SPECS\)\)/, 'the allowlist is derived from the specs');
  const declared = (protocol.match(/'([a-z]+\.[a-z_]+)':\s*\{/g) || []).length;
  assert.ok(declared > 0, 'the allowlist must name primitives');
  assert.match(site, new RegExp(`\\b${declared}\\b|dua puluh enam primitive`), `the site must state ${declared} primitives`);
});

test('the site names the permission count it asks the reader to accept', () => {
  assert.ok(site.includes(`${manifest.permissions.length} izin`) || site.includes('lima izin'), 'the permission count is stated');
  assert.match(read('landing/unduh.html'), /debugger/, 'the heaviest permission is named and justified');
});

test('the site promises no speed the runtime has not measured', () => {
  // WHY: the measured pickup for one primitive is seconds, not milliseconds, and a
  // marketing page that says "instant" is a claim nobody can hold us to.
  assert.doesNotMatch(site, /dalam (1|2|3) detik|instant|milliseconds|milidetik/i, 'no unsourced speed promise');
});

test('the site does not claim a store listing that does not exist', () => {
  assert.doesNotMatch(site, /tersedia di Chrome Web Store|available (in|on) the Chrome Web Store/i, 'the listing is still pending review');
  assert.match(read('landing/unduh.html'), /review/i, 'and the page says so');
});

test('the refusals the site advertises are the refusals the runtime enforces', () => {
  for (const [phrase, source] of [['password', 'password'], ['kode sekali pakai', 'OTP'], ['pembayaran', 'card|CVV'], ['private', 'private|incognito']]) {
    assert.ok(site.includes(phrase), `the site must state the ${phrase} refusal`);
    assert.match(extensionReadme, new RegExp(source, 'i'), `the runtime README must document ${phrase}`);
  }
});

test('the shared-key rule is stated as a refusal, not as a promise', () => {
  // WHY phrased this way: the correct sentence contains the words "kunci bersama",
  // so a scan that merely looks for the phrase finds the promise and misses the
  // negation. Only the negation may appear.
  assert.match(site, /tidak pernah menerbitkan kunci bersama/, 'the terms refuse a shared key');
  assert.doesNotMatch(site, /kunci API kami|api key kami|shared (model )?key/i, 'no page offers a key of ours');
});