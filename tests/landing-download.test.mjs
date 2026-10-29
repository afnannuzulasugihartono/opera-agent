// @last-edited: 2026-10-06 09:58 UTC+7.
// @title: landing-download — a stranger must be able to get the extension.
// @state: failing first: the download page does not exist yet.
// @dependencies: test, assert, fs.

// The install section currently ends in a manual sentence, which is where a layperson stalls.
// The download page gives one archive link, the version it came from, the checksum to verify it, and the three steps that follow.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');

function zipEntryNames(buffer) {
  const EOCD = 0x06054b50;
  const RECORD = 0x02014b50;

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

function zipEntryText(
  buffer,
  wanted
) {
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

      const bytes = method === 0
        ? raw
        : zlib.inflateRawSync(raw);
      return Buffer.from(bytes).toString('utf8');
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${wanted} is not in the archive`);
}

function zipOfTree() {
  const dir = new URL('extension/', root);
  const walk = (prefix = '') => fs.readdirSync(new URL(prefix, dir), { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? walk(`${prefix}${entry.name}/`) : [`${prefix}${entry.name}`])
    .sort();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of walk()) {
    const raw = fs.readFileSync(new URL(name, dir));
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32 ? zlib.crc32(raw) : crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + deflated.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(walk().length, 8);
  eocd.writeUInt16LE(walk().length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([
    ...locals,
    directory,
    eocd
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function buildCrxAround(payload) {
  const header = Buffer.from([
    0x12,
    0x02,
    0x01,
    0x02
  ]);
  const crx = Buffer.alloc(12 + header.length + payload.length);
  crx.write('Cr24', 0, 'utf8');
  crx.writeUInt32LE(3, 4);
  crx.writeUInt32LE(header.length, 8);
  header.copy(crx, 12);
  payload.copy(crx, 12 + header.length);
  return crx;
}

test('the download page names no version, because a named version goes stale', () => {
  const html = read('unduh.html');
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /\b\d+\.\d+\.\d+\b/,
    'no version appears in the copy a reader sees');
  assert.match(html, /build terbaru/, 'and the page says plainly that what it offers is the newest build');
});

test('the download page offers one archive and says how to verify it', () => {
  const html = read('unduh-berkas.html');
  assert.match(html, /download\/opera-agent\.zip/, 'one archive link, on the path that never changes');

  assert.match(html, /findstr \/i x-opera-sha256/, 'the page gives the command that reads the served digest');
  assert.match(html, /Get-FileHash/, 'and the command that hashes what the reader downloaded');
  assert.match(html, /Load unpacked|unpacked/i, 'the reader is told what the archive is');
});

test('the endpoint serves the newest build, so a release needs no edit to the site', () => {
  const src = fs.readFileSync(new URL('supabase/functions/opera-agent-update/index.ts', root), 'utf8');
  assert.match(src, /\/download\/opera-agent\.crx/, 'a version-less CRX path exists');
  assert.match(src, /\/download\/opera-agent\.zip/, 'and a version-less archive path exists');

  assert.match(src, /payload/, 'the archive is derived from the signed bytes');
  assert.match(src, /CRX_MAGIC/, 'and the slice is gated on the CRX magic, not a guessed offset');

  assert.match(src, /"Cache-Control": "no-store, max-age=0"/, 'the newest-build path is never cached');
});

test('the download page links the paths that never change', () => {
  const berkas = read('unduh-berkas.html');
  const hub = read('unduh.html');

  for (const [page, html] of [[
    'unduh.html',
    hub
  ], [
    'unduh-berkas.html',
    berkas
  ]]) {
    assert.doesNotMatch(html, /opera-agent-\d+\.\d+\.\d+\.(zip|crx)/,
      `${page}: no download link carries a version, so no release can leave the page behind`);
  }
  assert.match(berkas, /\/download\/opera-agent\.crx/, 'the CRX link is the version-less path');
  assert.match(berkas, /\/download\/opera-agent\.zip/, 'and so is the archive link');

  assert.doesNotMatch(berkas, /Unduh opera-agent-/, 'the link text no longer claims to name a file');

  assert.match(berkas, /namanya membawa versi build/, 'the page says the saved file is named with its version');
});

test('both formats share one page, reached from the hub and back', () => {
  const hub = read('unduh.html');

  const page = 'unduh-berkas.html';
  assert.ok(hub.includes(`href="./${page}"`), `the hub opens ${page}`);
  const html = read(page);
  assert.match(html, /class="btn" href="[^"]*opera-agent\.zip" download/, `${page} downloads the archive without scrolling elsewhere`);
  assert.match(html, /class="btn" href="[^"]*opera-agent\.crx" download/, `${page} downloads the signed file without scrolling elsewhere`);
  assert.ok(html.includes('href="./unduh.html"'), `${page} links back to the hub`);
});

test('the payload of a CRX is already the tree, so the archive needs no second build', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));
  const payload = buildCrxAround(zipOfTree());
  const headerLength = payload.readUInt32LE(8);
  assert.equal(payload.toString('utf8', 0, 4), 'Cr24', 'the envelope is a CRX');
  assert.equal(payload.toString('utf8', 12 + headerLength, 14 + headerLength), 'PK',
    'and the bytes after its header are a zip, so no separate archive build exists');
  const archive = payload.subarray(12 + headerLength);
  const inner = JSON.parse(zipEntryText(archive, 'manifest.json'));
  assert.equal(inner.key, manifest.key, 'the archive carries the tree’s signing key');
  assert.equal(inner.version, manifest.version, 'and the tree’s version');
  for (const needed of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page]) {
    assert.ok(zipEntryNames(archive).includes(needed), `the archive carries ${needed}`);
  }
});

test('the download page names every browser it supports and why one is not', () => {
  const html = read('unduh-berkas.html');

  for (const browser of ['Chrome', 'Edge', 'Brave', 'Opera', 'Vivaldi']) {
    assert.match(html, new RegExp(`<td>${browser}</td>`), `${browser} has a row saying what it can do`);
  }

  assert.match(html, /<td>Firefox<\/td>/, 'Firefox is named');
  assert.match(html, /Firefox tidak punya izin <code>debugger<\/code>/, 'and the reason is the permission it lacks');

  const rows = [...html.matchAll(/<tr><td>(\w+)<\/td>((?:<td\b[^>]*class="\w+"[^>]*>[^<]*<\/td>){2,4})<\/tr>/g)];
  assert.ok(rows.length >= 6, `the table has a row per browser, found ${rows.length}`);
  const cells = rows.map(([
    ,
    name,
    body
  ]) => [
    name,
    ...[...body.matchAll(/<td\b[^>]*class="(\w+)"[^>]*>([^<]*)<\/td>/g)].map((m) => [
      m[1],
      m[2].trim()
    ])
  ]);
  for (const [name, ...answers] of cells) {
    assert.ok(answers.length >= 2, `${name} answers every path the table names`);
  }
  const archive = cells.map(([
    name,
    ...answers
  ]) => [
    name,
    answers[answers.length - 1]
  ]);
  const chromium = archive.filter(([name]) => name !== 'Firefox');
  assert.ok(chromium.every(([
    ,
    [
      ,
      verdict
    ]
  ]) => verdict === 'berjalan'),
    'every Chromium browser loads the archive');
  assert.equal(archive.find(([name]) => name === 'Firefox')?.[1][1], 'tidak',
    'Firefox cannot load it, and the table says so rather than omitting it');
});

test('the install section links the download page instead of dead-ending', () => {
  const html = read('beranda.html');
  assert.match(html, /href="\.\/unduh\.html"/, 'install reaches the download page');
  assert.match(html, /unduh\.html/, 'the link exists in the copy too');
});

test('the archive the endpoint serves is not an empty placeholder', () => {
  const payload = buildCrxAround(zipOfTree());
  const archive = payload.subarray(12 + payload.readUInt32LE(8));
  assert.ok(archive.length > 1024, 'the payload is not an empty placeholder');
  assert.ok(zipEntryNames(archive).length > 20, 'and it holds the whole tree');
});

test('the archive carries the manifest key, so an unpacked install can update', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));
  const payload = buildCrxAround(zipOfTree());
  const archive = payload.subarray(12 + payload.readUInt32LE(8));
  assert.ok(zipEntryNames(archive).includes('manifest.json'), 'the archive has a manifest to read');
  const inner = JSON.parse(zipEntryText(archive, 'manifest.json'));
  assert.equal(inner.key, manifest.key, 'the archive carries the tree’s signing key');
  assert.equal(inner.version, manifest.version, 'and the tree’s version');
  assert.ok(inner.update_url, 'and the update URL that makes an unpacked install self-updating');
});

test('the archive contains every file the manifest names', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));

  const payload = buildCrxAround(zipOfTree());
  const names = zipEntryNames(payload.subarray(12 + payload.readUInt32LE(8)));
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

test('the download page has no typo where a stranger decides to trust it', () => {
  const html = read('unduh-berkas.html');

  assert.doesNotMatch(html, /polityvek/, 'kebijakan is spelled correctly');
  assert.match(html, /Kalau kebijakan ditolak/, 'the sentence reads as written');
});
