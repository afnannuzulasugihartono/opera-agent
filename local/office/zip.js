// @last-edited: 2026-11-05 UTC+7.
// @title: zip - the container every Office file is: entries in, one archive out.
// @state: entries are stored, not compressed, and the same entries always give the same bytes.
// @dependencies: none.

// WHY THE ARCHIVE IS STORED AND NOT COMPRESSED.
// An Office file is a zip, and a zip may hold its entries uncompressed.
// Compression would save a few kilobytes on a file the customer opens in Excel, and cost a dependency and a source of drift.
// The bytes stay the same for the same entries, so a hash of the artifact means the same thing every time it is taken.

// WHY THE DATE INSIDE THE FILE IS FIXED.
// A file that carries the clock inside it hashes differently on every run, and a delivery is settled by the hash of its bytes.
// A fixed date keeps one report one hash.

const CRC_TABLE = (() => {
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

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = 20513;
const UTF8_NAME = 0x0800;
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

const encoder = new TextEncoder();

export function zipBytes(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of list) {
    const name = encoder.encode(String(entry?.name ?? ''));
    const data = typeof entry?.data === 'string' ? encoder.encode(entry.data) : entry.data;
    if (!data) throw new Error(`the zip entry ${String(entry?.name ?? '')} has no bytes.`);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_SIGNATURE, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, UTF8_NAME, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, DOS_TIME, true);
    localView.setUint16(12, DOS_DATE, true);
    localView.setUint32(14, crc32(data), true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, data);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, CENTRAL_SIGNATURE, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 20, true);
    headerView.setUint16(8, UTF8_NAME, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, DOS_TIME, true);
    headerView.setUint16(14, DOS_DATE, true);
    headerView.setUint32(16, crc32(data), true);
    headerView.setUint32(20, data.length, true);
    headerView.setUint32(24, data.length, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint16(30, 0, true);
    headerView.setUint16(32, 0, true);
    headerView.setUint16(34, 0, true);
    headerView.setUint16(36, 0, true);
    headerView.setUint32(38, 0, true);
    headerView.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_SIGNATURE, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, list.length, true);
  endView.setUint16(10, list.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of central) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(end, cursor);
  return out;
}
