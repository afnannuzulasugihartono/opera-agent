// @last-edited: 2026-11-09 UTC+7.
// @title: pair-identity - the cookie is the browser, and the legacy identity is only ever adopted, never confused.
// @state: the cookie is preferred at pair time, the legacy still works when the cookie is missing, and the SQL adopts the old row in place or refuses to.
// @dependencies: node:test, strict, node:fs, ../extension/worker/instance-id.js.

// WHY THIS FILE IS A GATE AND NOT A THOUGHT.
// chrome.storage.local is deleted when the extension is removed, so the per-profile random identity minted a new device row on every reinstall, and the dashboard drowned in ghost browsers.
// The cookie jar of the browser profile is what survives, and this file pins every link of that chain: the cookie is mirrored into storage, pair time prefers it, the bridge forwards it, and the SQL adopts the legacy row in place with the owner guaranteed before it does.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { cookieInstanceId, pairIdentity } from '../../extension/worker/instance-id.js';

const storage = new Map();

function fakeChrome(seed = {}) {
  for (const key of Object.keys(globalThis)) if (key.startsWith('oaTest')) delete globalThis[key];
  storage.clear();
  for (const [key, value] of Object.entries(seed)) storage.set(key, value);
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (typeof key === 'string' ? { [key]: storage.get(key) } : Object.fromEntries(key.map((k) => [k, storage.get(k)]))),
        set: async (obj) => { for (const [key, value] of Object.entries(obj)) storage.set(key, value); },
        remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) storage.delete(key); }
      }
    }
  };
}

test.afterEach(() => {
  delete globalThis.chrome;
});

test('pair time prefers the cookie identity, prefixed and bounded', async () => {
  fakeChrome({ oaDeviceCookieId: 'a1b2c3d4-0000-4000-8000-abcdefabcdef' });
  const pair = await pairIdentity();
  assert.equal(pair.cookie, 'b:a1b2c3d4-0000-4000-8000-abcdefabcdef');
  assert.match(pair.cookie, /^[A-Za-z0-9._:-]{1,64}$/);
  assert.equal(pair.legacy.length > 0, true, 'the legacy identity still travels alongside for adoption');
});

test('a browser that never saw the cookie sends no cookie identity, and pair time still works', async () => {
  fakeChrome({});
  const pair = await pairIdentity();
  assert.equal(pair.cookie, '');
  assert.match(pair.legacy, /^[A-Za-z0-9._:-]{8,64}$/);
});

test('the cookie identity is exactly the mirrored cookie value, nothing else', async () => {
  fakeChrome({ oaDeviceCookieId: 'deadbeef' });
  assert.equal(await cookieInstanceId(), 'b:deadbeef');
  delete globalThis.chrome;
  fakeChrome({ oaDeviceCookieId: '' });
  assert.equal(await cookieInstanceId(), '');
});

test('the mirror only fires on the paired site and only reads the one cookie', () => {
  const source = fs.readFileSync(new URL('../../extension/worker/pair-cookie.js', import.meta.url), 'utf8');
  assert.match(source, /opera-agent\.pages\.dev/);
  assert.match(source, /oa_device_id/);
  assert.match(source, /oaDeviceCookieId/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, 'the mirror never touches page storage');
  assert.doesNotMatch(source, /fetch|XMLHttpRequest/, 'the mirror never phones anywhere');
});

test('the dashboard writes the identity cookie with the pairing-safe flags', () => {
  const html = fs.readFileSync(new URL('../../landing/dashboard.html', import.meta.url), 'utf8');
  assert.match(html, /oa_device_id=/);
  assert.match(html, /Secure/);
  assert.match(html, /SameSite=Lax/);
  assert.match(html, /Path=\//);
});

test('the bridge forwards the cookie identity to the 10-argument overload', () => {
  const bridge = fs.readFileSync(new URL('../../hosted/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8');
  assert.match(bridge, /p_cookie_instance_id/);
  assert.match(bridge, /cookieInstanceId/);
});

test('the 10-argument overload exists and keeps the old guards', () => {
  const sql = fs.readFileSync(new URL('../../hosted/migrations/20261110160000_opera_pair_cookie_identity.sql', import.meta.url), 'utf8');
  assert.match(sql, /p_cookie_instance_id text default ''/);
  assert.match(sql, /public\.opera_sha256\(upper\(trim\(p_code\)\)\)/);
  assert.match(sql, /v_device\.user_id is distinct from v_pair\.issued_by/);
  assert.match(sql, /update public\.opera_devices set instance_id = v_cookie/);
  assert.match(sql, /pairing\.refused_owned_legacy/);
  assert.match(sql, /Too many browsers are paired to this name\./);
  assert.match(sql, /revoke all on function public\.opera_pair_device\(text, text, text, text, integer, jsonb, text, text, text\)/);
});

test('the legacy overload is left untouched for older bridges', () => {
  const old = fs.readFileSync(new URL('../../hosted/migrations/20261109120000_opera_device_instance.sql', import.meta.url), 'utf8');
  assert.match(old, /p_instance_id text default ''\)/);
  assert.doesNotMatch(old, /p_cookie_instance_id/);
});

test('the fresh pairing formula rides both roads: cookie first, legacy adopted', () => {
  const sql = fs.readFileSync(new URL('../../hosted/migrations/20261110160000_opera_pair_cookie_identity.sql', import.meta.url), 'utf8');
  const adoptAt = sql.indexOf('update public.opera_devices set instance_id = v_cookie');
  assert.ok(adoptAt > 0, 'the adoption branch exists');
  const cookiePath = sql.slice(0, adoptAt);
  assert.ok(cookiePath.indexOf('where instance_id = v_cookie') > 0, 'the cookie-exact match is checked before adoption');
  assert.ok(cookiePath.indexOf('where instance_id = v_legacy') > 0, 'the legacy adoption branch exists before the suffixing fallback');
  assert.match(sql, /coalesce\(nullif\(v_cookie, ''\), v_legacy\)/, 'the insertion prefers the cookie identity, falls back to legacy, else the legacy random, else nothing');
});
