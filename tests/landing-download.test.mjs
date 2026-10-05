// @last-edited: 2026-10-05 11:05 UTC+7.
// @title: landing-download — a stranger must be able to get the extension.
// @state: failing first: the download page does not exist yet.
// @dependencies: test, assert, fs.

// The install section currently ends in a manual sentence, which is where a
// layperson stalls. The download page gives one archive link, the version it
// came from, the checksum to verify it, and the three steps that follow.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');

test('the download page names the exact version the repo ships', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));
  const html = read('unduh.html');
  assert.ok(html.includes(manifest.version), `the page must state version ${manifest.version}`);
  assert.match(html, new RegExp(manifest.version.replace(/\./g, '\\.')), 'the version is named in the copy');
});

test('the download page offers one archive with its checksum', () => {
  const html = read('unduh.html');
  assert.match(html, /href="\.\/opera-agent-[^"]+\.zip"/, 'one archive link, named after the product');
  assert.match(html, /[a-f0-9]{64}/, 'a sha256 the reader can verify');
  assert.match(html, /Load unpacked|unpacked/i, 'the reader is told what the archive is');
});

test('the install section links the download page instead of dead-ending', () => {
  const html = read('index.html');
  assert.match(html, /href="\.\/unduh\.html"/, 'install reaches the download page');
  assert.match(html, /unduh\.html/, 'the link exists in the copy too');
});

test('the download page shares the site navigation and floor', () => {
  const html = read('unduh.html');
  assert.match(html, /<html lang="id"/, 'the language is declared');
  assert.match(html, /<main/, 'a main landmark exists');
  assert.match(html, /<footer/, 'the footer exists');
  assert.match(html, /akun\.html/, 'the dashboard is reachable');
  const noScript = html.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.match(noScript, /(unduh|Unduh|arsip|archive)/, 'it reads without script');
});