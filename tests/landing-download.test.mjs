// @last-edited: 2026-10-06 09:58 UTC+7.
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

// A zip of the extension tree, built the way the release pack step builds one: entries in
// a fixed order with a fixed timestamp, so the same tree always produces the same bytes.
// WHY it is built here and not read from the tree: the lock is about what the endpoint
// derives from the CRX it holds, and the CRX it holds is produced in CI from this tree.
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
  return Buffer.concat([...locals, directory, eocd]);
}

// WHY the table rather than a dependency: zlib.crc32 landed in Node 20.12 and this
// repository pins no dependency, so the fallback keeps the lock runnable on both.
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

// A CRX3 envelope around a payload, which is the shape the endpoint has to slice.
function buildCrxAround(payload) {
  const header = Buffer.from([0x12, 0x02, 0x01, 0x02]);
  const crx = Buffer.alloc(12 + header.length + payload.length);
  crx.write('Cr24', 0, 'utf8');
  crx.writeUInt32LE(3, 4);
  crx.writeUInt32LE(header.length, 8);
  header.copy(crx, 12);
  payload.copy(crx, 12 + header.length);
  return crx;
}

test('the download page names no version, because a named version goes stale', () => {
  // WHY this inverted: the page used to say "Pasang Opera Agent 1.6.15" and link
  // opera-agent-1.6.15.zip. Both are claims nothing re-checks, so the day 1.6.16 shipped the
  // page still told every reader to install 1.6.15 and offered them those exact bytes. The
  // page now says nothing about which build it is, and the file the reader saves says it.
  const html = read('unduh.html');
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /\b\d+\.\d+\.\d+\b/,
    'no version appears in the copy a reader sees');
  assert.match(html, /build terbaru/, 'and the page says plainly that what it offers is the newest build');
});

test('the download page offers one archive and says how to verify it', () => {
  const html = read('unduh-zip.html');
  assert.match(html, /download\/opera-agent\.zip/, 'one archive link, on the path that never changes');
  // WHY the archive digest is no longer printed here: the archive is always the newest
  // build, so its digest changes on every release and a static page would print one that
  // is wrong by the next morning. The page tells the reader to ask the server instead,
  // and the two locks below prove those instructions actually run.
  assert.match(html, /findstr \/i x-opera-sha256/, 'the page gives the command that reads the served digest');
  assert.match(html, /Get-FileHash/, 'and the command that hashes what the reader downloaded');
  assert.match(html, /Load unpacked|unpacked/i, 'the reader is told what the archive is');
});

test('the endpoint serves the newest build, so a release needs no edit to the site', () => {
  // WHY this lock: the download page used to name opera-agent-1.6.15.zip and
  // opera-agent-1.6.15.crx and print three sha256 values, all hand-maintained. A
  // release had to rebuild the archive, copy the CRX out of the endpoint by hand, re-cut
  // every digest and redeploy — six steps, each of which can be silently skipped. The
  // endpoint already holds the newest signed CRX, so it serving the archive is what
  // makes the page stop carrying a version.
  const src = fs.readFileSync(new URL('supabase/functions/opera-agent-update/index.ts', root), 'utf8');
  assert.match(src, /\/download\/opera-agent\.crx/, 'a version-less CRX path exists');
  assert.match(src, /\/download\/opera-agent\.zip/, 'and a version-less archive path exists');
  // WHY the archive is a slice of the CRX rather than a stored file: the payload after
  // the CRX header is already a valid zip, measured at offset 12 + headerLength. Building
  // it means no second copy of the tree exists that can disagree with the signed bytes.
  assert.match(src, /payload/, 'the archive is derived from the signed bytes');
  assert.match(src, /CRX_MAGIC/, 'and the slice is gated on the CRX magic, not a guessed offset');
  // WHY no-store: the newest build changes under a fixed path, so a cached answer is a
  // stale answer. The versioned paths keep their immutable year because their bytes never
  // change under them.
  assert.match(src, /"Cache-Control": "no-store, max-age=0"/, 'the newest-build path is never cached');
});

test('the download page links the paths that never change', () => {
  const crx = read('unduh-crx.html');
  const zip = read('unduh-zip.html');
  const hub = read('unduh.html');
  // WHY the page must not name a version: a link to opera-agent-1.6.15.crx is a promise
  // that 1.6.15 is current. Nothing enforces it, so the page goes stale on the next
  // release and serves an old build to a reader who has no way to tell.
  for (const [page, html] of [['unduh.html', hub], ['unduh-exe.html', read('unduh-exe.html')], ['unduh-zip.html', zip], ['unduh-crx.html', crx]]) {
    assert.doesNotMatch(html, /opera-agent-\d+\.\d+\.\d+\.(zip|crx)/,
      `${page}: no download link carries a version, so no release can leave the page behind`);
  }
  assert.match(crx, /\/download\/opera-agent\.crx/, 'the CRX link is the version-less path');
  assert.match(zip, /\/download\/opera-agent\.zip/, 'and so is the archive link');
  // WHY the link text names no file either: the file a reader saves is named by the
  // server, which knows the version, so the text could only ever be a stale guess.
  assert.doesNotMatch(crx, /Unduh opera-agent-/, 'the link text no longer claims to name a file');
  // WHY the reader is told the name will carry the version: the installer and the CRX do
  // not change, and a reader comparing two downloads needs to tell them apart.
  assert.match(crx, /namanya membawa versi build/, 'the page says the saved file is named with its version');
});

test('each format has its own page, reached from the hub and back', () => {
  const hub = read('unduh.html');
  // WHY this lock: three installs on one page made every reader scroll past two that
  // were not theirs. Each format now has its own page; the hub only names the doors.
  for (const page of ['unduh-exe.html', 'unduh-zip.html', 'unduh-crx.html']) {
    assert.ok(hub.includes(`href="./${page}"`), `the hub opens ${page}`);
    const html = read(page);
    assert.match(html, /class="btn".*download/, `${page} still downloads without scrolling elsewhere`);
    assert.ok(html.includes('href="./unduh.html"'), `${page} links back to the hub`);
  }
});

test('the payload of a CRX is already the tree, so the archive needs no second build', () => {
  // WHY this replaces a lock on a committed file: the shipped zip was a hand-built
  // artefact in the tree that no workflow rebuilt, so it survived a key rotation and kept
  // handing strangers a manifest naming the old identity — an install from that archive
  // asked the update endpoint under the old id and was offered a release it already had.
  // Slicing the payload out of the signed CRX removes that second copy entirely, and this
  // proves the property the endpoint's slice depends on.
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
  const html = read('unduh.html');
  // WHY this lock: the page used to say "Brave dan Chrome" and name no others, while
  // the installer writes a policy for four browsers and the zip loads in any
  // Chromium one. A reader on Edge was told the product was not for them.
  for (const browser of ['Chrome', 'Edge', 'Brave', 'Opera', 'Vivaldi']) {
    assert.match(html, new RegExp(`<td>${browser}</td>`), `${browser} has a row saying what it can do`);
  }
  // WHY Firefox is named rather than omitted: it is the one browser a reader will
  // try that cannot work, because it has no debugger permission. Saying nothing
  // leaves them to discover it.
  assert.match(html, /<td>Firefox<\/td>/, 'Firefox is named');
  assert.match(html, /Firefox tidak punya izin <code>debugger<\/code>/, 'and the reason is the permission it lacks');
  // WHY every Chromium row must agree: a page that says "berjalan" for one and
  // "ditolak" for the next is a page nobody can act on.
  // WHY index 1 for the name: matchAll yields the whole match first, so the
  // capture groups start at 1. The pattern allows a fourth cell because the table
  // answers one question per install path, and a column added later must not
  // silently stop being checked.
  const rows = [...html.matchAll(/<tr><td>(\w+)<\/td>((?:<td class="\w+">[^<]*<\/td>){2,4})<\/tr>/g)];
  assert.ok(rows.length >= 6, `the table has a row per browser, found ${rows.length}`);
  const cells = rows.map(([, name, body]) => [
    name,
    ...[...body.matchAll(/<td class="(\w+)">([^<]*)<\/td>/g)].map((m) => [m[1], m[2].trim()])
  ]);
  for (const [name, ...answers] of cells) {
    assert.ok(answers.length >= 3, `${name} answers every path the table names`);
  }
  const archive = cells.map(([name, ...answers]) => [name, answers[answers.length - 1]]);
  const chromium = archive.filter(([name]) => name !== 'Firefox');
  assert.ok(chromium.every(([, [, verdict]]) => verdict === 'berjalan'),
    'every Chromium browser loads the archive');
  assert.equal(archive.find(([name]) => name === 'Firefox')?.[1][1], 'tidak',
    'Firefox cannot load it, and the table says so rather than omitting it');
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
  // WHY the allowlist is a separate assertion: it is the policy that lets a reader
  // enable an extension they dragged in themselves. Without it Brave installs the
  // file and leaves the toggle off with "not listed in the Chrome Web Store", which
  // looks like a broken download and is not.
  assert.match(src, /CreateSubKey\("ExtensionInstallAllowlist"\)/,
    'the allowlist key is written');
  assert.match(src, /HasFeed\(t\) && HasAllowlist\(t\)/,
    'and the read-back requires both, so a half-written install is not called success');
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

test('the installer digest the page prints is the installer in the tree', () => {
  // WHY only the installer: it is the one download whose bytes do not change on a release,
  // so its digest can be printed on a static page and stay true. The archive and the CRX
  // are served fresh from the endpoint and are verified by asking it, which the page says.
  const exe = fs.readFileSync(new URL('landing/OperaAgent-Installer.exe', root));
  const digest = crypto.createHash('sha256').update(exe).digest('hex');
  const html = read('unduh-exe.html');
  assert.ok(html.includes(digest), 'the page prints the real sha256 of the real installer');
  assert.ok(exe.length > 1024, 'and the installer is not an empty placeholder');
});

test('the archive the endpoint serves is not an empty placeholder', () => {
  // WHY this reads the tree rather than a file: the site no longer carries an archive,
  // because a hand-built one is exactly what went stale — it survived a key rotation and
  // kept naming the old identity. The endpoint slices the payload out of the signed CRX,
  // so the archive is whatever the tree packs to.
  const payload = buildCrxAround(zipOfTree());
  const archive = payload.subarray(12 + payload.readUInt32LE(8));
  assert.ok(archive.length > 1024, 'the payload is not an empty placeholder');
  assert.ok(zipEntryNames(archive).length > 20, 'and it holds the whole tree');
});

test('the archive carries the manifest key, so an unpacked install can update', () => {
  // WHY this lock: an install from an unpacked archive asks the update endpoint under
  // whatever id the archive's manifest resolves to. A manifest carrying a stale key asks
  // under the old id and is offered a release it already has, so the reader is stuck on a
  // build they can never leave.
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
  // WHY this lock: a download page whose archive is missing background.js or a
  // content script fails only after a stranger installs it and clicks around.
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

test('the download page has no typo where a stranger decides to trust it', () => {
  const html = read('unduh-zip.html');

  // WHY this lock: the manual-install section is read by someone whose automatic
  // install just failed. A misspelled "kebijakan" there reads as a broken product,
  // exactly when trust matters most.
  assert.doesNotMatch(html, /polityvek/, 'kebijakan is spelled correctly');
  assert.match(html, /Kalau kebijakan ditolak/, 'the sentence reads as written');
});