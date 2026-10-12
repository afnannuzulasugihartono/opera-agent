// @last-edited: 2026-10-12 UTC+7.
// @title: cf-device — one device socket: handshake, drain, waiters, keepalive.
// @state: 8 locks; handshake gate, replacement, concurrent waiters, timeout, close, keepalive.
// @dependencies: node:test, strict, ../cloudflare/src/device-logic.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from '../cloudflare/src/device-logic.js';

const HELLO = (overrides = {}) => JSON.stringify({
  type: 'hello', token: 'a'.repeat(64), deviceName: 'opera', ...overrides
});

function harness(overrides = {}) {
  const sent = [];
  const closed = [];
  const alarms = [];
  const calls = { verify: 0, claim: 0, complete: 0, replaced: 0 };
  let time = 1000;
  const { verify: verifyOutcome, commands: commandsOpt, ...rest } = overrides;
  const commands = commandsOpt || [];
  const device = createDevice({
    verify: async () => { calls.verify += 1; return verifyOutcome ?? { ok: true }; },
    claim: async () => {
      calls.claim += 1;
      return commands.length ? { id: 'c1', method: 'browser.ping', params: {}, timeoutMs: 5000 } : null;
    },
    complete: async () => { calls.complete += 1; return { ok: true }; },
    send: (text) => { sent.push(JSON.parse(text)); },
    close: (code, reason) => { closed.push({ code, reason }); },
    replaced: () => { calls.replaced += 1; },
    setAlarm: (atMs) => { alarms.push(atMs); },
    now: () => time,
    setTimer: (fn) => fn,
    ...rest
  });
  return {
    device, sent, closed, alarms, calls,
    setTime: (ms) => { time = ms; },
    getTime: () => time
  };
}

test('a valid handshake answers ready and schedules the keepalive', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());

  assert.equal(h.sent[0].type, 'ready');
  assert.equal(h.calls.verify, 1);
  assert.equal(h.alarms.length, 1, 'no keepalive was scheduled');
});

test('a bad handshake is closed unread and never drains', async () => {
  const h = harness({ verify: { ok: false } });
  await h.device.onMessage(HELLO({ token: 'wrong' }));

  assert.equal(h.closed.length, 1);
  assert.equal(h.closed[0].code, 4001);
  assert.equal(h.calls.claim, 0, 'an unauthenticated socket triggered a claim');
});

test('a verifier outage closes with 1011 instead of hanging the socket silent', async () => {
  const h = harness();
  h.device = createDevice({
    verify: async () => { throw new Error('postgrest down'); },
    claim: async () => { throw new Error('must never drain'); },
    complete: async () => {},
    send: (text) => { h.sent.push(JSON.parse(text)); },
    close: (code, reason) => { h.closed.push({ code, reason }); },
    setAlarm: (atMs) => { h.alarms.push(atMs); },
    now: h.getTime,
    setTimer: (fn) => fn
  });
  await h.device.onMessage(HELLO());

  assert.equal(h.closed.length, 1);
  assert.equal(h.closed[0].code, 1011);
  assert.equal(h.sent[0].type, 'error');
});

test('a second socket replaces the first instead of doubling it', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  await h.device.onMessage(HELLO());

  assert.equal(h.calls.replaced, 1, 'the old socket was left open');
  assert.equal(h.closed.length, 0, 'a blind close-all would kill the new socket too');
  assert.equal(h.sent.filter((f) => f.type === 'ready').length, 2);
});

test('a woken object restores its session instead of forgetting the device', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());

  const reborn = createDevice({
    verify: async () => { throw new Error('must not re-verify on wake'); },
    claim: async () => null,
    complete: async () => {},
    send: (text) => { h.sent.push(JSON.parse(text)); },
    close: (code, reason) => { h.closed.push({ code, reason }); },
    setAlarm: (atMs) => { h.alarms.push(atMs); },
    now: h.getTime,
    setTimer: (fn) => fn
  });

  const before = await reborn.runCommand({ commandId: 'c0', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });
  assert.equal(before.error.code, 'DEVICE_GONE', 'a fresh object somehow knew the device');

  reborn.restore({ deviceName: 'opera', token: 'a'.repeat(64) });
  const pending = reborn.runCommand({ commandId: 'c1', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });
  await reborn.onMessage(JSON.stringify({ type: 'complete', commandId: 'c1', ok: true, result: { ok: true } }));

  assert.deepEqual(await pending, { ok: true, result: { ok: true } });
});

test('two concurrent runs complete exactly once each, in order', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  const first = h.device.runCommand({ commandId: 'c1', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });
  const second = h.device.runCommand({ commandId: 'c2', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });

  await h.device.onMessage(JSON.stringify({ type: 'complete', commandId: 'c1', ok: true, result: { n: 1 } }));
  await h.device.onMessage(JSON.stringify({ type: 'complete', commandId: 'c2', ok: true, result: { n: 2 } }));

  assert.deepEqual(await first, { ok: true, result: { n: 1 } });
  assert.deepEqual(await second, { ok: true, result: { n: 2 } });
  assert.equal(h.calls.complete, 2);
});

test('a run that outlives its deadline fails, but a late completion is still recorded', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  const outcome = await h.device.runCommand({ commandId: 'c9', timeoutMs: 5000, deadlineMs: h.getTime() - 1 });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'AWAIT_TIMEOUT');

  await h.device.onMessage(JSON.stringify({ type: 'complete', commandId: 'c9', ok: true, result: { late: true } }));
  assert.equal(h.calls.complete, 1, 'the late completion was never recorded');
});

test('a command with no answer times out on schedule instead of hanging the caller', async () => {
  const h = harness({
    setTimer: (fn) => { setImmediate(fn); return fn; }
  });
  await h.device.onMessage(HELLO());
  const outcome = await h.device.runCommand({ commandId: 'c8', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'AWAIT_TIMEOUT');
});

test('closing the socket fails every waiter instead of hanging them', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  const pending = h.device.runCommand({ commandId: 'c1', timeoutMs: 5000, deadlineMs: h.getTime() + 5000 });

  await h.device.onClose(1006, '');

  const outcome = await pending;
  assert.equal(outcome.ok, false);
});

test('an answered ping resets the deadline; silence past it closes with 4003', async () => {
  const h = harness();
  await h.device.onMessage(HELLO());
  h.setTime(h.getTime() + 19000);
  await h.device.onAlarm();
  assert.equal(h.sent.filter((f) => f.type === 'ping').length, 1);

  await h.device.onMessage(JSON.stringify({ type: 'pong' }));
  h.setTime(h.getTime() + 19000);
  await h.device.onAlarm();
  assert.equal(h.closed.length, 0, 'an answering peer was closed');

  h.setTime(h.getTime() + 22000);
  await h.device.onAlarm();
  assert.equal(h.closed.length, 1);
  assert.equal(h.closed[0].code, 4003);
});
