// @last-edited: 2026-10-14 UTC+7.
// @title: ws-server.test — the loopback socket speaks RFC 6455 well enough to be trusted.
// @state: unit pins the handshake, the three length forms, and split-frame decoding.
// @dependencies: node:test, strict, ../local/ws-server.js.

// WHY THIS IS TESTED BEFORE IT IS WIRED. The device is the other half of a
// socket that only exists on this machine: if the handshake or a frame length
// is wrong, the extension reports an offline device while the server reports
// a live one. Decoding is the half that hides bugs, because a client frame is
// masked and may arrive split across TCP reads, so a decoder that assumes
// whole frames turns a working connection into silence.

import test from 'node:test';
import assert from 'node:assert/strict';

import { acceptKey, encodeText, createFrameReader, isWebSocketUpgrade } from '../local/ws-server.js';

function maskedFrame(opcode, text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  return Buffer.concat([header, mask, masked]);
}

test('the handshake answers the RFC key the browser will verify', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('an upgrade is recognised only with both headers', () => {
  assert.equal(isWebSocketUpgrade({ headers: { upgrade: 'websocket', connection: 'Upgrade' } }), true);
  assert.equal(isWebSocketUpgrade({ headers: { upgrade: 'websocket', connection: 'keep-alive' } }), false);
  assert.equal(isWebSocketUpgrade({ headers: { connection: 'Upgrade' } }), false);
});

test('text encodes in all three length forms the device can produce', () => {
  for (const size of [5, 200, 70000]) {
    const text = 'x'.repeat(size);
    const frame = encodeText(text);
    assert.equal(frame[0], 0x81, 'FIN plus text opcode');
    const second = frame[1];
    const declared = second < 126 ? second
      : second === 126 ? frame.readUInt16BE(2)
        : Number(frame.readBigUInt64BE(2));
    assert.equal(declared, Buffer.byteLength(text, 'utf8'), `length form for ${size}`);
    assert.equal(frame.subarray(frame.length - Buffer.byteLength(text)).toString('utf8'), text);
  }
});

test('a masked client frame decodes to its text', () => {
  const seen = [];
  createFrameReader((text) => seen.push(text))(maskedFrame(0x1, JSON.stringify({ type: 'hello', deviceName: 'opera' })));
  assert.deepEqual(JSON.parse(seen[0]), { type: 'hello', deviceName: 'opera' });
});

test('a frame split across reads decodes once, not twice', () => {
  const seen = [];
  const read = createFrameReader((text) => seen.push(text));
  const frame = maskedFrame(0x1, 'a'.repeat(300));
  read(frame.subarray(0, 7));
  assert.deepEqual(seen, [], 'half a frame is not a message');
  read(frame.subarray(7));
  assert.equal(seen.length, 1);
  assert.equal(seen[0], 'a'.repeat(300));
});

test('two frames in one read decode in order', () => {
  const seen = [];
  const read = createFrameReader((text) => seen.push(text));
  read(Buffer.concat([maskedFrame(0x1, 'first'), maskedFrame(0x1, 'second')]));
  assert.deepEqual(seen, ['first', 'second']);
});

test('a ping is answered and a close ends the reader', () => {
  const controls = [];
  createFrameReader(() => {}, (kind) => controls.push(kind))(maskedFrame(0x9, ''));
  assert.deepEqual(controls, ['ping']);

  const closing = [];
  createFrameReader(() => {}, (kind) => closing.push(kind))(maskedFrame(0x8, ''));
  assert.deepEqual(closing, ['close']);
});

test('a binary frame is refused by name instead of parsed as text', () => {
  const controls = [];
  createFrameReader(() => {}, (kind) => controls.push(kind))(maskedFrame(0x2, 'x'));
  assert.deepEqual(controls, ['binary']);
});
