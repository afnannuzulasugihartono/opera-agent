// @last-edited: 2026-10-08 UTC+7.
// @title: manifest-pins.test — Test.
// @state: locks the extension CSP shape the compiler needs.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const csp = manifest.content_security_policy.extension_pages;

test('the worker may reach the owner https endpoint and loopback, Supabase stays named', () => {
  assert.match(csp, /(^| )https:( |$|;)/);
  assert.match(csp, /http:\/\/127\.0\.0\.1:\*/);
  assert.match(csp, /https:\/\/\*\.supabase\.co/);
});

// WHY this lock exists. connect-src governs WebSocket the same as fetch, and the
// two schemes never substitute for each other: `https://*.supabase.co` does not
// admit `wss://`, and `http://127.0.0.1:*` does not admit `ws://`. The device
// opened no socket at all, with no error anywhere, because of exactly that. A
// silent transport that never connects is the worst shape of failure there is,
// so the permission is pinned rather than left to be rediscovered.

test('the worker may open a socket to the loopback bridge and to Supabase', () => {
  assert.match(csp, /ws:\/\/127\.0\.0\.1:\*/, 'the test and dev bridge socket is blocked');
  assert.match(csp, /wss:\/\/\*\.supabase\.co/, 'the deployed bridge socket is blocked');
});

test('no websocket scheme is opened wider than the two hosts already trusted', () => {
  assert.doesNotMatch(csp, /ws:\/\/\*/,
    'a wildcard websocket host is more permission than this extension needs');
  assert.doesNotMatch(csp, /wss:\/\/(?!\*\.supabase\.co)/,
    'a secure socket must point only at the bridge host');
});
