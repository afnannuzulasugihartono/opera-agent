// @last-edited: 2026-11-09 UTC+7.
// @title: hosted-device-resolution - the browser the caller actually has open is the browser that answers.
// @state: a pinned-but-stale device yields to the freshest fresh one, an open pin is honored, and no fresh device is a loud refusal.
// @dependencies: node:test, strict, ../supabase/functions/opera-agent-mcp/device.ts.

// WHY THIS FILE IS A GATE AND NOT A THOUGHT.
// The hosted road used to enqueue every command to whatever the config pinned at the day it was written; a seven-hour-stale pin blackholed every command into AWAIT_OUTCOME_UNKNOWN.
// The refusal is by design, and this file pins it: fresh pin wins, stale pin falls back to what is live, nothing live is a named refusal.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDevice } from '../supabase/functions/opera-agent-mcp/device.ts';

const NOW = Date.parse('2026-11-09T06:03:00.000Z');
const fresh = (name, lastSeenAt = '2026-11-09T06:02:30.000Z') => ({ device_name: name, last_seen_at: lastSeenAt, status: 'online' });
const stale = (name) => ({ device_name: name, last_seen_at: '2026-11-09T05:57:21.000Z', status: 'online' });

test('a fresh pin is honored', () => {
  const out = resolveDevice({ pin: 'opera', devices: [fresh('opera'), fresh('other')], now: NOW });
  assert.equal(out.name, 'opera');
  assert.equal(out.source, 'pin');
  assert.equal(out.pinned, 'opera');
});

test('a stale pin falls back to the freshest fresh device', () => {
  const out = resolveDevice({ pin: 'opera', devices: [stale('opera'), fresh('opera-6', '2026-11-09T06:02:49.000Z'), fresh('opera-7', '2026-11-09T06:02:47.000Z')], now: NOW });
  assert.equal(out.name, 'opera-6');
  assert.equal(out.source, 'freshest');
  assert.equal(out.pinned, 'opera');
  assert.equal(out.ageMs, 11_000);
});

test('no pin picks the freshest fresh device', () => {
  const out = resolveDevice({ pin: null, devices: [fresh('a', '2026-11-09T06:02:00.000Z'), fresh('b', '2026-11-09T06:02:55.000Z')], now: NOW });
  assert.equal(out.name, 'b');
  assert.equal(out.source, 'freshest');
});

test('every device stale means no device, named as such', () => {
  const out = resolveDevice({ pin: 'opera', devices: [stale('opera'), stale('opera-6')], now: NOW });
  assert.equal(out.name, null);
  assert.equal(out.source, null);
  assert.equal(out.pinned, 'opera');
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
