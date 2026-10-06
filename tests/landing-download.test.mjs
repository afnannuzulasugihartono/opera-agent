// @last-edited: 2026-10-06 07:52 UTC+7.
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
import zlib from 'node:zlib';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');

// Every entry name in a zip, read with nothing but the buffer.
//
// WHY this replaced a shell: the listing came from Windows PowerShell with the
// absolute path of the laptop it was written on, so the gate passed here and failed
// on the CI runner with `spawnSync powershell ENOENT`. A zip lists its entries in the
// central directory at the end of the file, in a fixed record layout, so reading it
// needs no shell and no dependency -- and this repository has no dependencies.
function zipEntryNames(buffer) {
  const EOCD = 0x06054b50;
  const RECORD = 0x02014b50;
  // WHY the backward scan: the end-of-central-directory record is last, but a zip may
  // carry a comment of up to 65535 bytes after it, so it is found by signature rather
  // than by position.
  let eocd = -1;
  for (let at = buffer.length - 22; at >= 0; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD) {
      eocd = at;
      break;
    }
  }
  assert.notEqual(eocd, -1, 'the archive has an end-of-central-directory record');
  const count = buffer.readUInt16LE(eocd + 10);
  const names = [];
  let at = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(at), RECORD, `entry ${i} has a central-directory record`);
    const nameLength = buffer.readUInt16LE(at + 28);
    names.push(buffer.toString('utf8', at + 46, at + 46 + nameLength));
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return names.map((n) => n.replace(/\\/g, '/'));
}

// WHY the deflate path is handled: the archive is built by the release pack step, which
// compresses, and by hand on a machine with no zip, which does not. Reading only stored
// entries would make this lock depend on which machine built it.
function zipEntryText(buffer, wanted) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let at = buffer.length - 22; at >= 0; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD) {
      eocd = at;
      break;
    }
  }
  assert.notEqual(eocd, -1, 'the archive has an end-of-central-directory record');
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength).replace(/\\/g, '/');
    if (name === wanted) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(start, start + compressedSize);
      // WHY zlib and not DecompressionStream: the suite runs on Node and on Deno with
      // no dependencies, and node:zlib is the one inflate both accept.
      const bytes = method === 0
        ? raw
        : zlib.inflateRawSync(raw);
      return Buffer.from(bytes).toString('utf8');
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${wanted} is not in the archive`);
}

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

test('the installer writes the policy entry Chrome can parse', () => {
  const src = fs.readFileSync(new URL('scripts/OperaAgentInstaller.cs', root), 'utf8');
  // WHY this lock: ExtensionInstallForcelist takes "extension_id;update_url". The
  // installer once wrote the URL alone, which is not a shorter form of the same value
  // but a different one, and Chrome ignores an entry it cannot parse. The policy then
  // reads as applied, the installer reports success, and nothing is installed — which
  // is exactly what an unrun installer looks like from the outside.
  assert.match(src, /ForcelistEntry\s*=\s*ExtensionId\s*\+\s*";"\s*\+\s*FeedUrl/,
    'the entry joins the extension id and the update URL with a semicolon');
  // WHY the id is asserted here and not left to the reader: a key rotation changes the
  // id, and an entry naming the old one installs an extension that can never update.
  const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));
  const digest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
  const currentId = [...digest].map((b) => `${String.fromCharCode(97 + (b >> 4))}${String.fromCharCode(97 + (b & 15))}`).join('');
  assert.match(src, new RegExp(`ExtensionId = "${currentId}"`),
    'the installer names the id the manifest key resolves to');
  // WHY no bare URL: the entry written to the list is the joined form, so a URL alone
  // anywhere in the write path means the bug is back.
  assert.doesNotMatch(src, /next\.Add\(FeedUrl\)/, 'the list never receives the URL without its id');
  // WHY this second lock: Chrome reads a list policy as the numbered values 1, 2, 3
  // inside the policy subkey. A value named after the policy is not in that sequence,
  // so the key existed, the entry was well formed, chrome://policy showed the policy
  // with an empty value, and nothing was installed. Two installers, two invisible
  // failures, both of which looked like success from outside.
  assert.match(src, /SetValue\(\(i \+ 1\)\.ToString\(\)/, 'entries are written as numbered values');
  assert.match(src, /DeleteValue\(name, false\)/, 'and stale value names are cleared first');
  assert.doesNotMatch(src, /GetValue\("ExtensionInstallForcelist"\)/,
    'nothing reads a value named after the policy, which Chrome ignores');
});

test('the advertised checksum is the checksum of the shipped archive', () => {
  const zip = fs.readFileSync(new URL('landing/opera-agent-1.6.15.zip', root));
  const digest = crypto.createHash('sha256').update(zip).digest('hex');
  const html = read('unduh.html');
  assert.match(html, new RegExp(digest), 'the page prints the real sha256 of the real archive');
  assert.ok(zip.length > 1024, 'the archive is not an empty placeholder');
});

test('the archive carries the manifest key, so an unpacked install can update', () => {
  // WHY this lock: the zip is a hand-built artefact in the tree, not something any
  // workflow rebuilds, so it survives a key rotation and keeps handing strangers a
  // manifest that names the old identity. An install from that archive asks the
  // update endpoint under the old id and is offered a release it already has.
  // Measured: the shipped 1.6.15 zip resolved to the old id while the tree and the
  // signed CRX both resolved to the new one.
  const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));
  const archive = fs.readFileSync(new URL('landing/opera-agent-1.6.15.zip', root));
  assert.ok(zipEntryNames(archive).includes('manifest.json'), 'the archive has a manifest to read');
  const inner = JSON.parse(zipEntryText(archive, 'manifest.json'));
  assert.equal(inner.key, manifest.key, 'the archive carries the tree’s signing key');
  assert.equal(inner.version, manifest.version, 'and the tree’s version');
});

test('the archive contains every file the manifest names', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));
  // WHY this lock: a download page whose archive is missing background.js or a
  // content script fails only after a stranger installs it and clicks around.
  const names = zipEntryNames(fs.readFileSync(new URL('landing/opera-agent-1.6.15.zip', root)));
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