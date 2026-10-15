// @last-edited: 2026-10-13 UTC+7.
// @title: bridge-socket — the push transport is checkable without a socket, a database, or a browser.
// @state: 8 locks; the handshake gate, the frame shapes, and the failure modes that must close the socket.
// @dependencies: node:test, strict, ../supabase/functions/opera-agent-bridge/bridge-socket.js.

// WHY THIS FILE EXISTS
//
// The push transport is the piece that decides whether an action costs one round
// trip or two, so it cannot be checked by driving it. WebSocket, Deno and Postgres
// are all absent from a unit test, which is why the socket's decisions live in plain
// functions here and Deno.upgradeWebSocket stays a single line.
//
// WHY the handshake is the load-bearing test. A socket that has not authenticated
// must never receive a command, and a socket that sends garbage must be answered
// rather than left to grow a buffer. Those are the two ways this design could leak
// one device's commands to another.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEEPALIVE_MS,
  MAX_DECOMPRESSED_BYTES,
  MAX_FRAME_BYTES,
  frameForCommand,
  frameForKeepalive,
  isUpgradeRequest,
  keepaliveDecision,
  parseDeviceFrame,
  handshakePayload,
  serveDeviceSocket
} from '../supabase/functions/opera-agent-bridge/bridge-socket.ts';
import { FRAME_MAX_BYTES, handshakeFrame } from '../extension/lib/socket-protocol.js';
import { MAX_RESULT_BYTES } from '../extension/lib/serialize.js';

const upgradeRequest = (headers = {}) => new Request('https://bridge.example/', {
  method: 'GET',
  headers: { upgrade: 'websocket', ...headers }
});

// WHY this lock exists. A service worker with a silent WebSocket is an idle
// service worker, and Chrome ends idle workers after thirty seconds. Observed on
// this extension against the deployed bridge: connected and ready, then closed
// with "signal is aborted without reason" roughly every thirty seconds, which is
// the worker being torn down rather than the bridge refusing anything.
//
// A frame the bridge sends on a timer is not polling. Polling is asking a question
// and waiting for an answer, and nothing here waits: the frame says nothing and
// expects nothing. It is what keeps the device alive, and it doubles as the check
// that a peer which has gone away is noticed rather than written to forever.

test('the keepalive is frequent enough to beat the worker idle timeout', () => {
  assert.ok(KEEPALIVE_MS > 0 && KEEPALIVE_MS < 30000,
    `a ${KEEPALIVE_MS}ms keepalive cannot keep a 30000ms idle worker alive`);
});

test('a keepalive frame asks for nothing, so a device never waits on it', () => {
  const frame = JSON.parse(frameForKeepalive('2026-10-12T00:00:00.000Z'));
  assert.equal(frame.type, 'ping');
  assert.equal(frame.serverTime, '2026-10-12T00:00:00.000Z');
  assert.deepEqual(Object.keys(frame).sort(), ['serverTime', 'type']);
});

test('a device ignores a keepalive rather than treating it as work', async () => {
  const parsed = await parseDeviceFrame(frameForKeepalive('2026-10-12T00:00:00.000Z'));
  assert.equal(parsed.ok, true);
  assert.notEqual(parsed.message.type, 'command');
  assert.notEqual(parsed.message.type, 'complete');
});

// WHY a missed pong closes the socket. Observed live: a device socket held for
// twenty minutes across an edge instance being replaced, still receiving pings,
// with a change subscription that had died with the old instance. Every signal
// said healthy and no command ever arrived. A ping that is answered proves both
// directions are alive; a ping that is not answered is the only evidence there is
// that the peer is gone, so the socket is closed and the device reconnects to a
// live instance.

test('a keepalive tick with no answer since the last one closes the socket', () => {
  assert.equal(keepaliveDecision({ pings: 2, pongs: 2 }), 'wait', 'an answered peer was closed anyway');
  assert.equal(keepaliveDecision({ pings: 1, pongs: 1 }), 'wait', 'one tick of slack, or a slow reply closes a healthy socket');
  assert.equal(keepaliveDecision({ pings: 2, pongs: 1 }), 'close', 'the latest ping went unanswered for a whole interval');
  assert.equal(keepaliveDecision({ pings: 1, pongs: 0 }), 'close', 'a peer that never answered must not be waited on forever');
  assert.equal(keepaliveDecision({ pings: 0, pongs: 0 }), 'wait', 'the first tick has nothing to compare against');
});

// WHY the transport cap is locked against the product bound. Results up to
// MAX_RESULT_BYTES are legal output, and a completion carries one, so any frame
// cap below that refuses legal results. Observed live: a 64 KiB cap answered a
// lawful page.read with "Frame too large" and stranded the command as claimed
// forever. Both caps are stated twice because neither side can import the other,
// which is exactly why the relation is asserted rather than trusted.

test('both frame caps fit the largest legal completion with room to spare', () => {
  assert.ok(MAX_FRAME_BYTES >= MAX_RESULT_BYTES * 1.5,
    `the bridge cap (${MAX_FRAME_BYTES}) no longer fits a legal result (${MAX_RESULT_BYTES})`);
  assert.ok(FRAME_MAX_BYTES >= MAX_RESULT_BYTES * 1.5,
    `the device cap (${FRAME_MAX_BYTES}) no longer fits a legal result (${MAX_RESULT_BYTES})`);
});

test('a completion near the product bound parses instead of being refused', async () => {
  const frame = JSON.stringify({
    type: 'complete',
    commandId: 'cmd-big',
    ok: true,
    result: { blob: 'y'.repeat(400 * 1024) }
  });
  const parsed = await parseDeviceFrame(frame);
  assert.equal(parsed.ok, true, 'a lawful completion was refused by the transport');
});

test('only a websocket request is treated as an upgrade, or a normal POST would be hijacked', () => {
  assert.equal(isUpgradeRequest(upgradeRequest()), true);
  assert.equal(isUpgradeRequest(new Request('https://bridge.example/')), false);
  assert.equal(isUpgradeRequest(upgradeRequest({ upgrade: 'h2c' })), false);
});

test('a command frame carries the id, method, params and timeout the device needs to run it', () => {
  const frame = JSON.parse(frameForCommand(
    { id: 'cmd-1', method: 'page.key', params: { key: 'a' }, timeoutMs: 15000 },
    '2026-10-11T00:00:00.000Z'
  ));

  assert.equal(frame.type, 'command');
  assert.equal(frame.command.id, 'cmd-1');
  assert.equal(frame.command.method, 'page.key');
  assert.deepEqual(frame.command.params, { key: 'a' });
  assert.equal(frame.command.timeoutMs, 15000);
});

test('a command with no params still carries an object, or the device dereferences undefined', () => {
  const frame = JSON.parse(frameForCommand({ id: 'c', method: 'browser.ping' }, 'now'));
  assert.deepEqual(frame.command.params, {});
  assert.equal(frame.command.timeoutMs, 30000);
});

test('a frame that is not JSON is refused with a reason, not by throwing inside the socket', async () => {
  const parsed = await parseDeviceFrame('not json');
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /JSON/);
});

test('an oversized frame is refused before it is parsed, or one message can exhaust memory', async () => {
  const parsed = await parseDeviceFrame(`{"type":"x","pad":"${'a'.repeat(500)}"}`, 100);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /large/i);
});

test('a frame with no type is refused, so an unlabelled message cannot reach a handler', async () => {
  assert.equal((await parseDeviceFrame('{"commandId":"x"}')).ok, false);
});

test('a well formed frame is accepted and keeps its type', async () => {
  const parsed = await parseDeviceFrame('{"type":"complete","commandId":"c-9","ok":true}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.message.type, 'complete');
  assert.equal(parsed.message.commandId, 'c-9');
});

test('a handshake needs both a token and a device name, and never accepts a partial one', () => {
  assert.equal(handshakePayload({ token: 'secret', deviceName: 'opera' })?.deviceName, 'opera');
  assert.equal(handshakePayload({ token: 'secret' }), null);
  assert.equal(handshakePayload({ deviceName: 'opera' }), null);
  assert.equal(handshakePayload({ token: '   ', deviceName: 'opera' }), null);
});

// WHY the bridge accepts gzip frames. The device sends completions over 2 KiB
// as versioned gzip, because page JSON shrinks five to fifty times and the
// transfer dominates on a slow link. The bridge must read exactly what the
// device writes — same version byte, same cap relation — or large results die
// in transit with no error the device can act on.

async function gzipFrame(payload, version = 1) {
  const text = JSON.stringify(payload);
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks = [];
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      chunks.push(value);
    }
  })();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
  await pump;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total + 1);
  out[0] = version;
  let offset = 1;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

test('a gzip completion decodes to the message the device sent', async () => {
  const frame = await gzipFrame({ type: 'complete', commandId: 'c9', ok: true, result: { n: 1 } });
  const parsed = await parseDeviceFrame(frame);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.message.type, 'complete');
  assert.equal(parsed.message.commandId, 'c9');
});

test('a gzip frame with the wrong version is refused, not misparsed', async () => {
  const frame = await gzipFrame({ type: 'complete', commandId: 'c9', ok: true }, 99);
  const parsed = await parseDeviceFrame(frame);

  assert.equal(parsed.ok, false);
});

test('a gzip bomb is refused before it can exhaust memory', async () => {
  assert.ok(MAX_DECOMPRESSED_BYTES >= MAX_RESULT_BYTES * 2,
    'the decompressed cap must clear the largest legal result with room');
  const frame = await gzipFrame({ type: 'complete', commandId: 'c9', ok: true, result: { blob: 'y'.repeat(100) } });
  const parsed = await parseDeviceFrame(frame, MAX_FRAME_BYTES, 10);

  assert.equal(parsed.ok, false);
});

test('binary garbage that is not gzip is refused, not thrown', async () => {
  const parsed = await parseDeviceFrame(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

  assert.equal(parsed.ok, false);
});

// WHY the handshake timing is driven, not trusted. The timer used to guard a
// verified socket while verification itself awaited an RPC plus a database
// connect, so a cold isolate timed out valid devices and closed them, then
// kept verifying into the closed socket. These three drive the real socket
// server with small budgets: arrival answers the first timer, absence still
// closes, and a hung verify is still bounded.

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeDeviceSocket() {
  return {
    readyState: 1,
    sent: [],
    closed: null,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(text) {
      this.sent.push(String(text));
    },
    close(code, reason) {
      if (this.closed) return;
      this.closed = { code, reason };
      this.readyState = 3;
      if (typeof this.onclose === 'function') this.onclose();
    }
  };
}

function installFakeUpgrade(socket) {
  const previous = globalThis.Deno;
  globalThis.Deno = { upgradeWebSocket: () => ({ socket, response: new Response('upgraded') }) };
  return () => {
    if (previous === undefined) delete globalThis.Deno;
    else globalThis.Deno = previous;
  };
}

function serveTestSocket({ verify, handshakeTimeoutMs, verifyTimeoutMs }) {
  const socket = fakeDeviceSocket();
  const restore = installFakeUpgrade(socket);
  serveDeviceSocket(upgradeRequest(), {
    verifyDevice: verify,
    complete: async () => ({}),
    subscribe: () => () => {},
    log: { info() {}, warn() {}, error() {} },
    handshakeTimeoutMs,
    verifyTimeoutMs
  });
  return { socket, restore };
}

function closeTestSocket({ socket, restore }) {
  socket.close(1000, 'test done');
  restore();
}

async function waitClosed(socket, limitMs) {
  const started = Date.now();
  while (!socket.closed && Date.now() - started < limitMs) {
    await sleepMs(10);
  }
  return Date.now() - started;
}

test('a hello that verifies slowly still becomes ready instead of timing out', async () => {
  const server = serveTestSocket({
    verify: async () => {
      await sleepMs(80);
      return { ok: true, deviceId: 'd1' };
    },
    handshakeTimeoutMs: 30,
    verifyTimeoutMs: 400
  });
  try {
    server.socket.onopen();
    await server.socket.onmessage({ data: handshakeFrame('tok', 'dev') });
    const types = server.socket.sent.map((raw) => JSON.parse(raw).type);
    assert.deepEqual(types, ['ready']);
    assert.equal(server.socket.closed, null);
  } finally {
    closeTestSocket(server);
  }
});

test('a socket that never says hello is still timed out and closed', async () => {
  const server = serveTestSocket({
    verify: async () => ({ ok: true, deviceId: 'd1' }),
    handshakeTimeoutMs: 30,
    verifyTimeoutMs: 400
  });
  try {
    server.socket.onopen();
    const waited = await waitClosed(server.socket, 2000);
    assert.ok(server.socket.closed, 'a silent socket was never closed');
    assert.ok(waited < 2000, `a silent socket took ${waited} ms to close`);
    const frames = server.socket.sent.map((raw) => JSON.parse(raw));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, 'error');
    assert.match(frames[0].error, /Handshake timeout/);
    assert.equal(server.socket.closed?.code, 4002);
  } finally {
    closeTestSocket(server);
  }
});

test('a verify that never answers is still bounded instead of holding the socket', async () => {
  const server = serveTestSocket({
    verify: () => new Promise(() => {}),
    handshakeTimeoutMs: 30,
    verifyTimeoutMs: 60
  });
  try {
    server.socket.onopen();
    void server.socket.onmessage({ data: handshakeFrame('tok', 'dev') });
    const waited = await waitClosed(server.socket, 2000);
    assert.ok(server.socket.closed, 'a hung verify held the socket past its budget');
    assert.ok(waited < 2000, `a hung verify held the socket for ${waited} ms`);
    const frames = server.socket.sent.map((raw) => JSON.parse(raw));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, 'error');
    assert.match(frames[0].error, /Handshake timeout/);
    assert.equal(server.socket.closed?.code, 4002);
  } finally {
    closeTestSocket(server);
  }
});
