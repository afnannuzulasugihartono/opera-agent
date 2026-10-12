// @last-edited: 2026-10-11 UTC+7.
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
  frameForCommand,
  frameForKeepalive,
  isUpgradeRequest,
  keepaliveDecision,
  parseDeviceFrame,
  handshakePayload
} from '../supabase/functions/opera-agent-bridge/bridge-socket.ts';

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

test('a device ignores a keepalive rather than treating it as work', () => {
  const parsed = parseDeviceFrame(frameForKeepalive('2026-10-12T00:00:00.000Z'));
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

test('a frame that is not JSON is refused with a reason, not by throwing inside the socket', () => {
  const parsed = parseDeviceFrame('not json');
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /JSON/);
});

test('an oversized frame is refused before it is parsed, or one message can exhaust memory', () => {
  const parsed = parseDeviceFrame(`{"type":"x","pad":"${'a'.repeat(500)}"}`, 100);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /large/i);
});

test('a frame with no type is refused, so an unlabelled message cannot reach a handler', () => {
  assert.equal(parseDeviceFrame('{"commandId":"x"}').ok, false);
});

test('a well formed frame is accepted and keeps its type', () => {
  const parsed = parseDeviceFrame('{"type":"complete","commandId":"c-9","ok":true}');
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