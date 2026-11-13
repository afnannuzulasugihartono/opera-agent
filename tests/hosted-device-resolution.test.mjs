// @last-edited: 2026-11-11 UTC+7.
// @title: hosted-device-resolution - the browser the caller pinned answers, or the relay says why it cannot.
// @state: a live pin answers every call; a pin that names a sleeping browser is a named refusal with the live alternatives; X-Opera-Device: any opts into the freshest browser; a stored provider pin decides only when no header names a browser, and a header beats it.
// @dependencies: node:test, strict, ../hosted/functions/opera-agent-mcp/device.ts.

// WHY THIS FILE IS A GATE AND NOT A THOUGHT.
// The hosted road used to enqueue every command to whatever the config pinned at the day it was written; a seven-hour-stale pin blackholed every command into AWAIT_OUTCOME_UNKNOWN.
// The first answer to that was to fall back to whichever browser was freshest, which traded a blackhole for a worse failure: tab ids live inside one browser, so a call that landed on the pinned browser and the next call that landed on another left the agent holding a tab id that existed on neither.
// The failure read as a broken tool.
// The rule this file pins: the pin decides.
// While the pinned browser is live it answers every call; when it is not, the relay refuses by name, names the browsers that are awake and gives the header that reaches one.
// The fallback still exists, but the caller asks for it with X-Opera-Device: any.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDevice } from '../hosted/functions/opera-agent-mcp/device.ts';

const NOW = Date.parse('2026-11-09T06:03:00.000Z');
const fresh = (name, lastSeenAt = '2026-11-09T06:02:30.000Z') => ({ device_name: name, last_seen_at: lastSeenAt, status: 'online' });
const stale = (name) => ({ device_name: name, last_seen_at: '2026-11-09T05:57:21.000Z', status: 'online' });

test('a live pin answers every call, and names the other browsers as alternatives', () => {
  const out = resolveDevice({ pin: 'opera', devices: [fresh('opera'), fresh('other')], now: NOW });
  assert.equal(out.name, 'opera');
  assert.equal(out.source, 'pin');
  assert.equal(out.pinned, 'opera');
  assert.equal(out.pinState, 'live');
  assert.deepEqual(out.alternatives, ['other']);
});

test('a pin that names a sleeping browser is refused, not silently swapped for another', () => {
  const out = resolveDevice({ pin: 'opera', devices: [stale('opera'), fresh('opera-6', '2026-11-09T06:02:49.000Z'), fresh('opera-7', '2026-11-09T06:02:47.000Z')], now: NOW });
  assert.equal(out.name, null);
  assert.equal(out.source, null);
  assert.equal(out.pinned, 'opera');
  assert.equal(out.pinState, 'stale');
  assert.deepEqual(out.alternatives, ['opera-6', 'opera-7']);
});

test('the refusal says how long the pinned browser has been silent', () => {
  const out = resolveDevice({ pin: 'opera', devices: [stale('opera')], now: NOW });
  assert.equal(out.ageMs, NOW - Date.parse('2026-11-09T05:57:21.000Z'));
});

test('a pin that names a browser this account never had is refused as missing', () => {
  const out = resolveDevice({ pin: 'ghost', devices: [fresh('opera')], now: NOW });
  assert.equal(out.name, null);
  assert.equal(out.pinState, 'missing');
  assert.equal(out.ageMs, null);
  assert.deepEqual(out.alternatives, ['opera']);
});

test('X-Opera-Device: any asks for the freshest browser on purpose', () => {
  const out = resolveDevice({ pin: 'any', devices: [fresh('a', '2026-11-09T06:02:00.000Z'), fresh('b', '2026-11-09T06:02:55.000Z')], now: NOW });
  assert.equal(out.name, 'b');
  assert.equal(out.source, 'freshest');
  assert.equal(out.pinState, 'none');
});

test('no pin picks the freshest fresh device', () => {
  const out = resolveDevice({ pin: null, devices: [fresh('a', '2026-11-09T06:02:00.000Z'), fresh('b', '2026-11-09T06:02:55.000Z')], now: NOW });
  assert.equal(out.name, 'b');
  assert.equal(out.source, 'freshest');
});

test('every device stale means no device, named as such', () => {
  const out = resolveDevice({ pin: null, devices: [stale('opera'), stale('opera-6')], now: NOW });
  assert.equal(out.name, null);
  assert.equal(out.source, null);
});

test('a disabled device is never chosen', () => {
  const out = resolveDevice({ pin: null, devices: [{ device_name: 'off', last_seen_at: '2026-11-09T06:02:59.000Z', status: 'disabled' }, fresh('on', '2026-11-09T06:02:00.000Z')], now: NOW });
  assert.equal(out.name, 'on');
});

test('a device that never reported an address is not silently dead', () => {
  const out = resolveDevice({ pin: null, devices: [{ device_name: 'unknown', last_seen_at: null, status: 'online' }], now: NOW });
  assert.equal(out.name, null);
});

test('the window is part of the contract', () => {
  const justOutside = { device_name: 'fresh', last_seen_at: new Date(NOW - 120_001).toISOString(), status: 'online' };
  const inside = { device_name: 'inside', last_seen_at: new Date(NOW - 119_000).toISOString(), status: 'online' };
  const out = resolveDevice({ pin: null, devices: [justOutside, inside], now: NOW });
  assert.equal(out.name, 'inside');
});

test('a live provider pin answers for the provider, and says it is the provider pin', () => {
  const out = resolveDevice({ pin: null, providerPin: 'opera-8', devices: [fresh('opera-8'), fresh('opera-9')], now: NOW });
  assert.equal(out.name, 'opera-8');
  assert.equal(out.source, 'pin');
  assert.equal(out.pinState, 'live');
  assert.equal(out.pinSource, 'provider');
});

test('a provider pin that names a sleeping browser is refused, not swapped', () => {
  const out = resolveDevice({ pin: null, providerPin: 'opera-8', devices: [stale('opera-8'), fresh('opera-9', '2026-11-09T06:02:49.000Z')], now: NOW });
  assert.equal(out.name, null);
  assert.equal(out.pinState, 'stale');
  assert.equal(out.pinSource, 'provider');
  assert.deepEqual(out.alternatives, ['opera-9']);
});

test('a provider pin that names a browser the account never had is refused as missing', () => {
  const out = resolveDevice({ pin: null, providerPin: 'ghost', devices: [fresh('opera')], now: NOW });
  assert.equal(out.name, null);
  assert.equal(out.pinState, 'missing');
  assert.equal(out.pinSource, 'provider');
});

test('a header pin on the call beats the stored provider pin', () => {
  const out = resolveDevice({ pin: 'opera-9', providerPin: 'opera-8', devices: [fresh('opera-8'), fresh('opera-9')], now: NOW });
  assert.equal(out.name, 'opera-9');
  assert.equal(out.pinSource, 'header');
});

test('a stored provider pin of any is ignored, and the freshest answers', () => {
  const out = resolveDevice({ pin: null, providerPin: 'any', devices: [fresh('a', '2026-11-09T06:02:00.000Z'), fresh('b', '2026-11-09T06:02:55.000Z')], now: NOW });
  assert.equal(out.name, 'b');
  assert.equal(out.source, 'freshest');
  assert.equal(out.pinSource, null);
});
