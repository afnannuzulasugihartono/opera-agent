// @last-edited: 2026-11-11 UTC+7.
// @title: self-update - the build is read, checked, and written over the reader's own folder.
// @state: the version comparison, the refusal of a build that is not ours, and the write that puts the files in place.
// @dependencies: node:test, node:assert/strict, node:fs, node:zlib, ../extension/lib/self-update.js, ../extension/lib/zip-read.js.

// WHY THIS GATE RUNS THE WRITE.
// The promise is that a newer build lands in the reader's folder and nothing else does.
// That promise is about bytes and paths, so it is proved with bytes and paths: a zip is built here, read here, and written here into a folder that records what it was given.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { applyBuild, newerThan, servedVersion } from '../extension/lib/self-update.js';
import { readZip } from '../extension/lib/zip-read.js';

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

// WHY THE FIXTURE IS BUILT HERE AND NOT READ FROM A FILE.
// The build the update service serves is packed by Chrome and deflated, so the reader has to read that shape; a fixture made by the same writer as the office files would be stored and would prove nothing about it.

const buildZip = (entries) => {
  const encoder = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = encoder.encode(entry.text);
    const deflated = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 8, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, deflated.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    const body = new Uint8Array(header.length + deflated.length);
    body.set(header, 0);
    body.set(deflated, header.length);
    local.push(body);
    const record = new Uint8Array(46 + name.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true);
    recordView.setUint16(4, 20, true);
    recordView.setUint16(6, 20, true);
    recordView.setUint16(8, 0x0800, true);
    recordView.setUint16(10, 8, true);
    recordView.setUint32(16, crc, true);
    recordView.setUint32(20, deflated.length, true);
    recordView.setUint32(24, raw.length, true);
    recordView.setUint16(28, name.length, true);
    recordView.setUint32(42, offset, true);
    record.set(name, 46);
    central.push(record);
    offset += body.length;
  }
  const localBytes = Buffer.concat(local.map((part) => Buffer.from(part)));
  const centralBytes = Buffer.concat(central.map((part) => Buffer.from(part)));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localBytes.length, 16);
  return new Uint8Array(Buffer.concat([localBytes, centralBytes, end]));
};

const fakeFolder = () => {
  const files = new Map();
  const folders = new Map();
  const folder = {
    files,
    folders,
    getDirectoryHandle: async (name) => {
      if (!folders.has(name)) folders.set(name, fakeFolder());
      return folders.get(name);
    },
    getFileHandle: async (name) => ({
      createWritable: async () => ({
        write: async (bytes) => files.set(name, new Uint8Array(bytes)),
        close: async () => {}
      })
    })
  };
  return folder;
};

const buildResponse = (body, headers = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
  json: async () => JSON.parse(body),
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
});

const fetchImpl = (version, zip) => async (url, options) => {
  const u = String(url);
  if (u.includes('/download/opera-agent.zip') && options?.method === 'HEAD') {
    return { ok: true, status: 200, headers: { get: (name) => (String(name).toLowerCase() === 'x-opera-version' ? version : null) } };
  }
  if (u.includes('/download/opera-agent.zip')) return buildResponse(zip, { 'x-opera-version': version });
  throw new Error(`unexpected url ${u}`);
};

test('the version comparison reads as numbers, not as text', () => {
  assert.equal(newerThan('1.6.37', '1.6.38'), true, 'a higher patch wins');
  assert.equal(newerThan('1.6.38', '1.6.38'), false, 'the same version is not an update');
  assert.equal(newerThan('1.9.0', '1.10.0'), true, 'the minor is a number, not a digit');
  assert.equal(newerThan('1.6.40', '1.6.9'), false, 'and so is the patch');
});

test('the zip reader gives back the files the archive holds', async () => {
  const zip = buildZip([
    { name: 'manifest.json', text: '{"name":"Opera Agent","version":"1.6.38"}' },
    { name: 'lib/browser-id.js', text: 'export const x = 1;' }
  ]);
  const entries = await readZip(zip);
  assert.deepEqual(entries.map((entry) => entry.name), ['manifest.json', 'lib/browser-id.js']);
  assert.equal(new TextDecoder().decode(entries[0].bytes), '{"name":"Opera Agent","version":"1.6.38"}');
});

test('a newer build is written over the folder, file by file', async () => {
  const zip = buildZip([
    { name: 'manifest.json', text: '{"name":"Opera Agent","version":"1.6.38"}' },
    { name: 'lib/browser-id.js', text: 'export const family = () => "Brave";' }
  ]);
  const folder = fakeFolder();
  const outcome = await applyBuild({ folder, installedVersion: '1.6.37', fetchImpl: fetchImpl('1.6.38', zip) });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.version, '1.6.38');
  assert.equal(folder.files.has('manifest.json'), true, 'the manifest is written');
  const lib = folder.folders.get('lib');
  assert.equal(new TextDecoder().decode(lib.files.get('browser-id.js')), 'export const family = () => "Brave";', 'and the folder inside it');
});

test('the same version writes nothing', async () => {
  const zip = buildZip([{ name: 'manifest.json', text: '{"name":"Opera Agent","version":"1.6.38"}' }]);
  const folder = fakeFolder();
  const outcome = await applyBuild({ folder, installedVersion: '1.6.38', fetchImpl: fetchImpl('1.6.38', zip) });
  assert.equal(outcome.changed, false);
  assert.equal(folder.files.size, 0, 'nothing is written when there is nothing new');
});

test('a build that is not ours is refused', async () => {
  const zip = buildZip([{ name: 'manifest.json', text: '{"name":"Somebody Else","version":"9.9.9"}' }]);
  const folder = fakeFolder();
  const outcome = await applyBuild({ folder, installedVersion: '1.6.37', fetchImpl: fetchImpl('9.9.9', zip) });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'not-ours');
  assert.equal(folder.files.size, 0, 'and nothing is written');
});

test('the served version is the one the build carries, asked by a head on the archive', async () => {
  const seen = [];
  const probe = async (url, options) => {
    seen.push({ url: String(url), method: options?.method ?? 'GET' });
    return { ok: true, status: 200, headers: { get: (name) => (String(name).toLowerCase() === 'x-opera-version' ? '1.6.41' : null) } };
  };
  const version = await servedVersion(probe);
  assert.equal(version, '1.6.41', 'the version the build carries is read, not the health page of the legacy extension');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'HEAD', 'and it is asked for cheaply, without carrying the build');
  assert.match(seen[0].url, /\/download\/opera-agent\.zip$/, 'and it is the archive this extension is updated from, not another surface');
});

test('a head that cannot say leaves the download to decide, and the write still happens', async () => {
  const zip = buildZip([{ name: 'manifest.json', text: '{"name":"Opera Agent","version":"1.6.38"}' }]);
  const folder = fakeFolder();
  const blind = async (url, options) => {
    if (options?.method === 'HEAD') return { ok: false, status: 503, headers: { get: () => null } };
    return buildResponse(zip, { 'x-opera-version': '1.6.38' });
  };
  const outcome = await applyBuild({ folder, installedVersion: '1.6.37', fetchImpl: blind });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.changed, true, 'the manifest inside the build still decides');
  assert.equal(folder.files.has('manifest.json'), true, 'and the write happens');
});
