// @last-edited: 2026-11-11 UTC+7.
// @title: device-revoke-state - a revoked device leaves the account's device list.
// @state: the revoke writes the revoked state, the device list leaves it out, and the relay never chooses it.
// @dependencies: node:test, node:assert/strict, node:fs, ../hosted/functions/opera-agent-mcp/device.ts.

// WHY THIS GATE READS THE MIGRATION AND THE RESOLVER.
// The button in the dashboard said "cut this device off" and the device stayed on the page wearing an offline badge, because the revoke only cut the token and set the row offline while the account's list carried every row.
// A reader who presses the button and sees the same card concludes that nothing happened, so the state has to be a state and the list has to leave it.
// CI has no Postgres, so what can be proved here is the text and the pure function that reads the same rows.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { resolveDevice } from '../hosted/functions/opera-agent-mcp/device.ts';

const root = new URL('..', import.meta.url);
const sql = fs.readFileSync(new URL('hosted/migrations/20261110210000_opera_device_revoked_state.sql', root), 'utf8');
const resolver = fs.readFileSync(new URL('hosted/functions/opera-agent-mcp/device.ts', root), 'utf8');
const gateway = fs.readFileSync(new URL('hosted/functions/opera-agent-mcp/index.ts', root), 'utf8');

test('the revoke writes a state of its own, and cuts the token with it', () => {
  assert.match(sql, /status = 'revoked'/, 'the row is marked revoked');
  assert.match(sql, /token_hash = repeat\('0', 64\)/, 'and the token is replaced by one no browser holds');
  assert.match(sql, /last_seen_at = null/, 'the presence is cleared, so it cannot read as a live browser');
});

test('the status check knows the word, so the state can be written', () => {
  assert.match(sql, /drop constraint if exists opera_devices_status_check/, 'the old check is dropped');
  assert.match(sql, /'revoked'::text/, 'and the new one carries the state');
});

test('the device list leaves a revoked row out', () => {
  assert.match(sql, /d\.user_id = v_uid and d\.status <> 'revoked'/, 'the account sees its devices, minus the revoked ones');
});

test('the rows revoked before this state are named the same way', () => {
  assert.match(sql, /where token_hash = repeat\('0', 64\) and status <> 'revoked'/, 'a cut token is the evidence of a revoke');
});

test('the relay never chooses a revoked device', () => {
  assert.match(resolver, /status === 'disabled' \|\| status === 'revoked'/, 'the resolver skips both');
  assert.match(gateway, /\.neq\("status", "revoked"\)/, 'and the query never brings one in');
});

test('a revoked row is never chosen, whatever the pin says', () => {
  const rows = [
    { device_name: 'opera-7', last_seen_at: new Date().toISOString(), status: 'online' },
    { device_name: 'opera-3', last_seen_at: new Date().toISOString(), status: 'revoked' }
  ];
  const pinned = resolveDevice({ pin: 'opera-3', devices: rows, now: Date.now() });
  assert.equal(pinned.name, null, 'a revoked device answers nothing');
  assert.equal(pinned.pinState, 'missing', 'and the caller is told the device is not there');

  const freshest = resolveDevice({ pin: null, devices: rows, now: Date.now() });
  assert.equal(freshest.name, 'opera-7', 'the freshest live device is the one that answers');
});
