// ws-server — the smallest RFC 6455 text server this product needs.
//
// Node ships a WebSocket client and no server, and a dependency for one
// endpoint is heavier than the endpoint. This handles exactly what the device
// uses: the upgrade handshake, masked text frames, ping/pong, and close. Binary
// frames are refused by name, because a command is JSON and anything else on
// this port is a mistake worth saying out loud.

import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// WHY SIXTEEN MEGABYTES, AND WHY OVERFLOW SKIPS INSTEAD OF CLOSING. The only
// peer is the extension on this machine over loopback, past the origin check,
// so the cap guards against accidents, not attackers — and a whole pierced
// document is legitimately megabytes. Measured live: fetching one to find a
// hidden file input tripped the old one-megabyte cap, which answered by
// closing the socket and failing every call in flight. An oversized message
// is now skipped by its own declared length while the link — and every other
// call on it — carries on. Set OPERA_BRIDGE_DEBUG_FRAMES to watch sizes.

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

// WHY SHA-1 HERE, AND WHY IT IS NOT A CHOICE. RFC 6455 section 4.2.2 defines the
// handshake response as the base64 of SHA-1 over the client's key and a fixed GUID:
// the browser checks that exact value, so a different hash computes a different answer
// and the upgrade fails. It authenticates nothing on this road - the socket is loopback
// and the origin is checked separately - so the weak-hash rule does not apply to it.

const handshakeDigest = (text) => createHash('sha1').update(text).digest('base64'); // NOSONAR javascript:S4790

export function acceptKey(key) {
  return handshakeDigest(`${key}${GUID}`);
}

export function encodeText(text) {
  const payload = Buffer.from(String(text), 'utf8');
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x81;
  return Buffer.concat([header, payload]);
}

export function encodeClose(code = 1000) {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return Buffer.concat([Buffer.from([0x88, 0x02]), payload]);
}

export function encodePong() {
  return Buffer.from([0x8a, 0x00]);
}

// A client frame is masked and may be split across TCP reads, so decoding keeps
// a remainder: the next chunk continues the same frame rather than becoming a
// second, malformed one.
//
// WHY FRAGMENTS ARE REASSEMBLED. A large message may also arrive split across
// WebSocket frames — FIN off, continuations after — and the reader used to
// drop every continuation on the floor. Small messages always arrive whole,
// so everything worked until a screenshot-sized completion fragmented: the
// server waited on half a message until the caller gave up, while snapshots
// on the same link answered in milliseconds. Measured live as captures
// failing on whichever tab happened to fragment while reads flew everywhere.
// Reassembly is per RFC 6455: buffer data frames until FIN, let control
// frames interleave, refuse what overflows or violates.

export function createFrameReader(onText, onControl = () => {}) {
  let buffer = Buffer.alloc(0);
  let fragments = null;
  let skipping = false;

  const fail = (code) => {
    fragments = null;
    skipping = false;
    buffer = Buffer.alloc(0);
    onControl('close', code);
  };

  const dropPayload = (offset, length) => {
    buffer = buffer.subarray(offset + length);
  };

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const first = buffer[0];
      const second = buffer[1];
      const fin = (first & 0x80) === 0x80;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) === 0x80;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        length = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      let mask = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + length) return;
      if (process.env.OPERA_BRIDGE_DEBUG_FRAMES) {
        console.error(`[ws-server] opcode=${opcode} fin=${fin} length=${length}`);
      }
      const held = fragments ? fragments.length : 0;
      if (length > MAX_FRAME_BYTES || held + length > MAX_FRAME_BYTES) {
        fragments = null;
        if (fin) {
          dropPayload(offset, length);
        } else {
          skipping = true;
          dropPayload(offset, length);
        }
        continue;
      }
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) { onControl('close', 1000); return; }
      if (opcode === 0x9) { onControl('ping'); continue; }
      if (opcode === 0xa) continue;
      if (skipping) {
        if (opcode === 0x0 && fin) skipping = false;
        continue;
      }
      if (opcode === 0x0) {
        if (!fragments) { fail(1002); return; }
        fragments.parts.push(payload);
        fragments.length += payload.length;
        if (fin) {
          const whole = Buffer.concat(fragments.parts);
          const was = fragments.opcode;
          fragments = null;
          if (was === 0x2) { onControl('binary'); continue; }
          onText(whole.toString('utf8'));
        }
        continue;
      }
      if (fragments) { fail(1002); return; }
      if (opcode === 0x2) {
        if (!fin) { fragments = { opcode, parts: [payload], length: payload.length }; continue; }
        onControl('binary');
        continue;
      }
      if (opcode === 0x1) {
        if (!fin) { fragments = { opcode, parts: [payload], length: payload.length }; continue; }
        onText(payload.toString('utf8'));
      }
    }
  };
}

export class BridgeSocket extends EventEmitter {
  constructor(socket, request) {
    super();
    this.id = randomUUID();
    this.socket = socket;
    this.request = request;
    this.closed = false;
    this.read = createFrameReader(
      (text) => this.emit('text', text),
      (kind, code) => {
        if (kind === 'ping') this.raw(encodePong());
        else this.close(code ?? 1000);
      }
    );
    socket.on('data', (chunk) => this.read(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  raw(buffer) {
    if (this.closed || this.socket.destroyed) return false;
    try {
      this.socket.write(buffer);
      return true;
    } catch {
      this.finish();
      return false;
    }
  }

  send(text) {
    return this.raw(encodeText(text));
  }

  close(code = 1000) {
    if (this.closed) return;
    this.raw(encodeClose(code));
    this.socket.end();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

export function isWebSocketUpgrade(request) {
  const upgrade = String(request.headers.upgrade || '').toLowerCase();
  const connection = String(request.headers.connection || '').toLowerCase();
  return upgrade === 'websocket' && connection.includes('upgrade');
}

// WHY THE HOST IS COMPARED, NOT THE STRING. This used to accept any origin
// ending in an allowed one, which meant `https://notlocalhost` — a domain
// anybody can register — was allowed to drive the browser sitting on this
// machine. An origin is a scheme, a host and a port, so the only part worth
// matching is the host, and the whole string is matched exactly so that a
// scheme cannot smuggle a host in.
//
// WHY A MISSING ORIGIN IS ALLOWED. Node's own WebSocket client sends none, and
// so does any other non-browser process on this machine. The server is bound
// to 127.0.0.1, so an absent Origin means "something local", which is the
// population this server exists for.

export function isOriginAllowed(origin, allowed) {
  if (!origin) return true;
  const host = hostOf(origin);
  if (host === null) return false;
  return allowed.some((entry) => origin === entry || host === entry);
}

function hostOf(origin) {
  try {
    return new URL(origin).hostname || null;
  } catch {
    return null;
  }
}
