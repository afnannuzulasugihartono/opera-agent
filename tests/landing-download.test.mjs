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
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

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

test('the advertised checksum is the checksum of the shipped archive', () => {
  const zip = fs.readFileSync(new URL('landing/opera-agent-1.6.15.zip', root));
  const digest = crypto.createHash('sha256').update(zip).digest('hex');
  const html = read('unduh.html');
  assert.match(html, new RegExp(digest), 'the page prints the real sha256 of the real archive');
  assert.ok(zip.length > 1024, 'the archive is not an empty placeholder');
});

test('the archive contains every file the manifest names', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));
  // WHY this lock: a download page whose archive is missing background.js or a
  // content script fails only after a stranger installs it and clicks around.
  const listing = execFileSync('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead(\'D:\\GitHub\\opera-agent\\landing\\opera-agent-1.6.15.zip\').Entries.FullName'], { encoding: 'utf8', maxBuffer: 4e7 });
  const names = listing.split('\n').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\\/g, '/'));
  const needed = [
    'manifest.json',
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    'styles.css',
    'lib/protocol.js',
    'lib/options-store.js',
    ...manifest.content_scripts.flatMap((cs) => cs.js)
  ];
  for (const file of needed) {
    assert.ok(names.includes(file), `the archive must contain ${file}`);
  }
});

test('the download page explains every permission the manifest requests', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));
  const html = read('unduh.html');
  // WHY this lock: Chrome Web Store review asks what each permission is for, and a
  // stranger deciding to install deserves the same answer before, not after.
  for (const permission of manifest.permissions) {
    assert.ok(html.includes(permission), `the page must name the ${permission} permission`);
  }
  assert.match(html, /debugger/, 'the debugger permission is named and justified');
  assert.match(html, /host permission/i, 'host permissions are named too');
  assert.match(html, /ditolak di tab private/, 'the private-tab refusal is stated');
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