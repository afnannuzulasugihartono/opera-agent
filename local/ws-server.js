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
const MAX_FRAME_BYTES = 1024 * 1024;

export function acceptKey(key) {
  return createHash('sha1').update(`${key}${GUID}`).digest('base64');
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

export function createFrameReader(onText, onControl = () => {}) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const first = buffer[0];
      const second = buffer[1];
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
      if (length > MAX_FRAME_BYTES) {
        onControl('close', 1009);
        buffer = Buffer.alloc(0);
        return;
      }
      let mask = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) { onControl('close', 1000); return; }
      if (opcode === 0x9) { onControl('ping'); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x2) { onControl('binary'); continue; }
      if (opcode === 0x1) onText(payload.toString('utf8'));
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

export function isOriginAllowed(origin, allowed) {
  if (!origin) return true;
  return allowed.some((entry) => origin === entry || origin.endsWith(entry));
}
