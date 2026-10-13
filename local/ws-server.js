// @last-edited: 2026-10-13 UTC+7.
// @title: ws-server — a dependency-free RFC6455 server for one local bridge link.
// @state: handshake, masked text frames, 64-bit payloads, ping, close, latest-wins link.
// @dependencies: node:net, node:crypto (both stock).

// WHY THIS FILE EXISTS
//
// Chrome refuses a debugging port on the Default profile, and the relay road to
// the extension costs ~2 s a call through Singapore. The extension can, however,
// open an outbound WebSocket to this machine, and stock Node has a WebSocket
// client but no server — so this is the server: ~120 lines, text frames only,
// written against the RFC rather than a package, because a bridge meant to run
// anywhere is the worst place to introduce an install step.
//
// WHY latest-wins. One Chrome runs the bridge connector; a second link means the
// worker restarted and reconnected, so the stale socket is dead weight. The old
// one is closed and the new one serves, and no caller can tell the difference.
//
// WHAT IT DELIBERATELY DOES NOT DO. No subprotocols, no extensions, no
// fragmentation: the connector sends whole text frames and anything else closes
// the link loudly rather than being half-read. No auth beyond the loopback bind,
// which is exactly the trust boundary the debugging port it replaces already had.

import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

// One sentence for a dead link, written once: three call sites throw it, and a
// driver, a test and a person all read the same words.

export const LINK_ERROR = 'bridge: extension is not connected (start the local driver, then reload the extension)';

export function acceptKey(clientKey) {
  return createHash('sha1').update(String(clientKey).trim() + GUID).digest('base64');
}

export function encodeTextFrame(text) {
  const payload = Buffer.from(String(text), 'utf8');
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

export function decodeClientFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    if (!masked) throw new Error('ws: client frames must be masked');
    if (!fin) throw new Error('ws: fragmented frames are not supported');
    let length = second & 0x7f;
    let head = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      head = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const big = buffer.readBigUInt64BE(offset + 2);
      if (big > BigInt(MAX_FRAME_BYTES)) throw new Error('ws: frame exceeds 16 MiB');
      length = Number(big);
      head = 10;
    }
    if (length > MAX_FRAME_BYTES) throw new Error('ws: frame exceeds 16 MiB');
    if (offset + head + 4 + length > buffer.length) break;
    const mask = buffer.subarray(offset + head, offset + head + 4);
    const payload = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
      payload[i] = buffer[offset + head + 4 + i] ^ mask[i % 4];
    }
    offset += head + 4 + length;
    if (opcode === 0x8) {
      frames.push({ close: true });
      break;
    }
    if (opcode === 0x9) {
      frames.push({ ping: true });
      continue;
    }
    if (opcode === 0xa) continue;
    if (opcode !== 0x1) throw new Error(`ws: unsupported opcode ${opcode}`);
    frames.push({ text: payload.toString('utf8') });
  }
  return { frames, rest: buffer.subarray(offset) };
}

function parseHandshake(head) {
  const lines = head.split('\r\n');
  const [method, target] = (lines[0] ?? '').split(' ');
  const headers = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { method, target, headers };
}

export function createWsBridge({ port = 9451, host = '127.0.0.1', log = () => {} } = {}) {
  const server = createServer();
  let link = null;
  let linkId = 0;

  const drop = (socket, id) => {
    if (link && link.id === id) link = null;
    try {
      socket.destroy();
    } catch {}
  };

  const onMessage = { handler: null };

  server.on('connection', (socket) => {
    let head = Buffer.alloc(0);
    let upgraded = false;
    let tail = Buffer.alloc(0);
    const id = (linkId += 1);

    socket.on('data', (chunk) => {
      if (!upgraded) {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf('\r\n\r\n');
        if (end < 0) return;
        const { method, headers } = parseHandshake(head.subarray(0, end).toString('latin1'));
        const key = headers['sec-websocket-key'];
        if (method !== 'GET' || !key) {
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
          return;
        }
        upgraded = true;
        tail = head.subarray(end + 4);
        if (link) drop(link.socket, link.id);
        link = { id, socket };
        log(`bridge link #${id} up`);
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
        );
      } else {
        tail = Buffer.concat([tail, chunk]);
      }
      if (!upgraded) return;
      let frames;
      try {
        const parsed = decodeClientFrames(tail);
        frames = parsed.frames;
        tail = Buffer.from(parsed.rest);
      } catch (error) {
        log(`bridge link #${id} protocol error: ${error.message}`);
        drop(socket, id);
        return;
      }
      for (const frame of frames) {
        if (frame.close) {
          drop(socket, id);
          return;
        }
        if (frame.ping) {
          socket.write(Buffer.from([0x8a, 0x00]));
          continue;
        }
        if (link?.id === id && onMessage.handler) {
          void Promise.resolve()
            .then(() => onMessage.handler(frame.text))
            .catch((error) => log(`bridge handler failed: ${error?.message ?? error}`));
        }
      }
    });

    socket.on('error', () => drop(socket, id));
    socket.on('close', () => { if (link?.id === id) link = null; });
  });

  return {
    onMessage(fn) {
      onMessage.handler = fn;
    },
    linked() {
      return link !== null;
    },
    send(text) {
      if (!link) throw new Error(LINK_ERROR);
      link.socket.write(encodeTextFrame(text));
    },
    ping() {
      if (!link) throw new Error(LINK_ERROR);
      link.socket.write(Buffer.from([0x89, 0x00]));
    },
    dropLink() {
      if (link) drop(link.socket, link.id);
    },
    async waitForLink({ timeoutMs = 10000, intervalMs = 100 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (link) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve({ port: server.address().port, host }));
      });
    },
    address() {
      return server.address();
    },
    async close() {
      if (link) drop(link.socket, link.id);
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
