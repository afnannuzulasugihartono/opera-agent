// @last-edited: 2026-11-11 UTC+7.
// @title: zip-read - the archive the update service serves, read into the files it holds.
// @state: the entries of a zip archive, each with its bytes, read without a dependency.
// @dependencies: none.

// WHY THE EXTENSION READS THE ARCHIVE ITSELF.
// A build that updates itself has to know what it is writing, and the browser can only be asked to write files it already holds.
// The update service serves the extension tree as a zip, so the extension reads that zip and writes the entries over its own folder; nothing else in the tree needs a zip reader, and the office writers only ever write.

// WHY THE READER IS HERE AND NOT BORROWED.
// The tree has a zip writer for the office files, and it writes entries stored and uncompressed; the build the update service serves is packed by Chrome and deflated, so it is read with the browser's own decompressor instead of a second implementation.

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const STORED = 0;
const DEFLATED = 8;

const inflateRaw = async (bytes) => {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const findEndOfCentralDirectory = (view, length) => {
  const earliest = Math.max(0, length - 65557);
  for (let index = length - 22; index >= earliest; index -= 1) {
    if (view.getUint32(index, true) === END_SIGNATURE) return index;
  }
  return -1;
};

export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view, bytes.length);
  if (end < 0) throw new Error('the archive carries no central directory');
  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(pointer, true) !== CENTRAL_SIGNATURE) throw new Error('the archive is damaged');
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    const data = method === STORED ? raw : method === DEFLATED ? await inflateRaw(raw) : null;
    if (!data) throw new Error(`the archive entry ${name} uses a compression this browser does not read`);
    entries.push({ name, bytes: data });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
