// @last-edited: 2026-10-12 UTC+7.
// @title: device-signal — the fast path from enqueue to bridge, checked without Realtime.
// @state: 7 locks; endpoint shape, headers, timeout, failure tolerance, and name validation.
// @dependencies: node:test, strict, ../supabase/functions/_shared/device-signal.js.

// WHY THIS FILE EXISTS
//
// The bridge learns about new work through postgres_changes, which measured
// 650-1000 ms from insert to claim: WAL to Realtime server to edge isolate. A
// broadcast on the device channel skips all of that — ephemeral pub/sub, tens of
// milliseconds. This helper is the enqueue side of that signal.
//
// WHY every failure mode returns false instead of throwing. The broadcast is an
// optimization, not the source of truth: the insert already committed, and the
// bridge still listens to postgres_changes as backup. A failure that threw would
// turn a fast-path hiccup into a failed user request, which is exactly backwards:
// slow and correct always beats fast and broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceChannel, notifyDevice, signalUrl, validSignalName } from '../supabase/functions/_shared/device-signal.js';

const CREDENTIALS = { supabaseUrl: 'https://ref.supabase.co', supabaseKey: 'service-key' };

function fakeFetch({ ok = true, calls = [], fail = null } = {}) {
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (fail) throw fail;
    return { ok };
  };
  return { fetchImpl, calls };
}

test('a signal is one POST to the broadcast endpoint with the command it announces', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const ok = await notifyDevice(CREDENTIALS, 'opera', 'cmd-1', null, fetchImpl, 1000);

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ref.supabase.co/realtime/v1/api/broadcast/opera-commands-opera/events/new-command');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { commandId: 'cmd-1' });
});

test('authentication rides on apikey alone, because an empty Authorization answers 500', async () => {
  const { fetchImpl, calls } = fakeFetch();
  await notifyDevice(CREDENTIALS, 'opera', 'cmd-1', null, fetchImpl, 1000);

  assert.equal(calls[0].init.headers.apikey, 'service-key');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.ok(!('Authorization' in calls[0].init.headers),
    'an Authorization header rides along; empty means Realtime answers 500');
  assert.ok(!('authorization' in calls[0].init.headers),
    'a lowercase Authorization header rides along');
});

test('a refused broadcast fails the signal, never the request', async () => {
  const { fetchImpl } = fakeFetch({ ok: false });
  const ok = await notifyDevice(CREDENTIALS, 'opera', 'cmd-1', null, fetchImpl, 1000);

  assert.equal(ok, false);
});

test('a signal that throws is swallowed, because postgres_changes is still listening', async () => {
  const { fetchImpl } = fakeFetch({ fail: new Error('socket reset') });
  const ok = await notifyDevice(CREDENTIALS, 'opera', 'cmd-1', null, fetchImpl, 1000);

  assert.equal(ok, false);
});

test('a device name with channel-breaking characters never becomes a topic', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const ok = await notifyDevice(CREDENTIALS, 'opera/injected', 'cmd-1', null, fetchImpl, 1000);

  assert.equal(ok, false);
  assert.equal(calls.length, 0, 'an unvalidated name reached the network');
  assert.equal(validSignalName('opera'), true);
  assert.equal(deviceChannel('opera'), 'opera-commands-opera');
  assert.ok(signalUrl('https://ref.supabase.co/', 'opera').endsWith('/realtime/v1/api/broadcast/opera-commands-opera/events/new-command'));
});

test('missing credentials fail before touching the network', async () => {
  const { fetchImpl, calls } = fakeFetch();

  assert.equal(await notifyDevice(null, 'opera', 'cmd-1', null, fetchImpl, 1000), false);
  assert.equal(await notifyDevice({}, 'opera', 'cmd-1', null, fetchImpl, 1000), false);
  assert.equal(await notifyDevice(CREDENTIALS, 'opera', '', null, fetchImpl, 1000), false);
  assert.equal(calls.length, 0);
});

test('every signal carries a deadline, so a hung Realtime cannot hang the request', async () => {
  const { fetchImpl, calls } = fakeFetch();
  await notifyDevice(CREDENTIALS, 'opera', 'cmd-1', null, fetchImpl, 750);

  assert.ok(calls[0].init.signal, 'the request carries no abort signal at all');
});
