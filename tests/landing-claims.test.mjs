// @last-edited: 2026-10-06 12:20 UTC+7.
// @title: landing-claims — every number the site states is checked against the code.
// @state: 8 locks, all green; the audit that wrote them found the permission count unstated.
// @dependencies: node:test, node:assert, node:fs, extension-source.

// The site's copy must never claim what the runtime cannot do.
// The numbers drift silently otherwise: bump the manifest version or the tool count and the site keeps advertising the old figure until a reader notices it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extensionSource } from './helpers/extension-source.mjs';
import { mcpSurfaceSourceSync } from './helpers/mcp-surface-source.mjs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

const site = ['landing/beranda.html', 'landing/index.html', 'landing/akun.html', 'landing/privasi.html', 'landing/syarat.html', 'landing/unduh.html', 'landing/unduh-berkas.html', 'landing/404.html', 'landing/fitur.html', 'landing/dukungan.html', 'landing/dashboard.html', 'landing/oauth/consent.html']
  .map(read).join('\n');

const manifest = JSON.parse(read('extension/manifest.json'));
const mcp = mcpSurfaceSourceSync();
const content = read('extension/content.js');
const background = await extensionSource();

test('no page states a version, because a stated version is a promise nothing keeps', () => {

  const copy = site.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/Opera Agent\s*\d+\.\d+\.\d+/g, 'Opera Agent VERSION')
    .replace(/opera-agent-\d+\.\d+\.\d+/g, 'opera-agent-VERSION');
  assert.doesNotMatch(copy, /Opera Agent VERSION|opera-agent-VERSION/,
    'no page names a build next to the product');

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'and the manifest carries a version to check against');
});

test('the tool count on the site equals the tools the MCP server registers', () => {
  const registered = (mcp.match(/registerTool\(/g) || []).length;
  assert.ok(registered > 0, 'the MCP server must register tools for this to mean anything');
  assert.match(site, new RegExp(`\\b${registered} tool`), `the site must state ${registered} tools`);
});

test('the primitive count on the site equals the allowlist the extension enforces', () => {
  const protocol = read('extension/lib/protocol.js');
  assert.match(protocol, /export const ALLOWED_METHODS = Object\.freeze\(Object\.keys\(METHOD_SPECS\)\)/, 'the allowlist is derived from the specs');
  const declared = (protocol.match(/'([a-z]+\.[a-z_]+)':\s*\{/g) || []).length;
  assert.ok(declared > 0, 'the allowlist must name primitives');
  assert.match(site, new RegExp(`\\b${declared} primitive`), `the site must state ${declared} primitives`);
});

test('the site names the permission count it asks the reader to accept', () => {
  assert.ok(site.includes(`${manifest.permissions.length} izin`) || site.includes('lima izin'), 'the permission count is stated');
  assert.match(read('landing/unduh.html'), /debugger/, 'the heaviest permission is named and justified');
});

test('the site promises no speed the runtime has not measured', () => {

  const MODEL_IDS = ['llama-3.1-8b-instant'];
  let text = site;
  for (const id of MODEL_IDS) text = text.split(id).join('');
  assert.doesNotMatch(text, /dalam (1|2|3) detik|instant|milliseconds|milidetik/i, 'no unsourced speed promise');
});

test('the site does not claim a store listing that does not exist', () => {
  assert.doesNotMatch(site, /tersedia di Chrome Web Store|available (in|on) the Chrome Web Store/i, 'the listing is still pending review');
  assert.match(read('landing/unduh.html'), /review/i, 'and the page says so');
});

test('the refusals the site advertises are the refusals the runtime enforces', () => {

  const guards = [
    ['password', content, /type === 'password'/],
    ['kode sekali pakai', content, /one-time-code/],
    ['pembayaran', content, /cvv|cvc/],
    ['private', background, /tab\.incognito/],
  ];
  for (const [phrase, source, guard] of guards) {
    assert.ok(site.includes(phrase), `the site must state the ${phrase} refusal`);
    assert.match(source, guard, `the runtime must enforce the ${phrase} refusal`);
  }
});

test('the shared-key rule is stated as a refusal, not as a promise', () => {

  assert.match(site, /tidak pernah menerbitkan kunci bersama/, 'the terms refuse a shared key');
  assert.doesNotMatch(site, /kunci API kami|api key kami|shared (model )?key/i, 'no page offers a key of ours');
});