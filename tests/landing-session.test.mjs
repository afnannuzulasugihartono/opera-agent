// @last-edited: 2026-10-05 19:20 UTC+7.
// @title: landing-session — a signed-in reader is not signed out every hour.
// @state: 5 locks; the renewal is executed against a stub Auth, not read as text.
// @dependencies: node:test, node:assert, node:fs, node:vm.

// Measured symptom: the owner reported the session not persisting, signing them out
// often. The cause is plain once stated: a Supabase access token lasts about an hour, and
// these pages store it and hold no client library to renew it, so an aged token read as
// "signed out" and was deleted. Nothing told the reader why, so it looked like the product
// forgetting them.
//
// These locks execute the renewal in each page against a stub Auth, because the failure
// mode is a silent deletion, which no assertion on the source text can see.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

const STORAGE_KEYS = ['opera-agent-access-token', 'opera-agent-refresh-token'];

/**
 * Run one page's own module against a stub Auth and report what it stores.
 *
 * @param {string} page file name under landing/
 * @param {{accessOk?: boolean, refreshOk?: boolean}} shape what the stub answers
 * @returns {Promise<{store: object, cleared: string[], rejections: string[]}>}
 */

async function run(page, { accessOk = false, refreshOk = true, refreshStatus = 200, refreshFails = false } = {}) {
  const html = read(`landing/${page}`);
  const source = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  const store = { 'opera-agent-access-token': 'expired-access-token', 'opera-agent-refresh-token': 'a-refresh-token' };
  const cleared = [];
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason?.message || String(reason));
  process.on('unhandledRejection', onRejection);

  const node = () => ({
    id: '', textContent: '', innerHTML: '', className: '', value: '', hidden: true, href: '',
    disabled: false, dataset: {}, children: { length: 0 }, querySelectorAll: () => [],
    addEventListener() {}, querySelector: () => null, closest: () => null
  });
  const context = vm.createContext({
    console, Intl, Date, JSON, Math, Number, String, Array, Object, RegExp, Error,
    URLSearchParams, encodeURIComponent, setTimeout,
    location: { search: '?authorization_id=abc', hash: '', pathname: `/${page}`, href: `https://opera-agent.vercel.app/${page}`, replace() {}, assign() {} },
    localStorage: {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { cleared.push(key); delete store[key]; }
    },
    navigator: { clipboard: { writeText: async () => {} } },
    document: { getElementById: () => node(), querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
    confirm: () => false,
    fetch: async (url) => {
      if (url.includes('/token?grant_type=refresh_token')) {
        // WHY three ways to fail: a dropped packet, a refused token and a server having a
        // bad day are different events, and only the second one means the reader is gone.
        if (refreshFails) throw new TypeError('Failed to fetch');
        // WHY a 400 when no status was named: "not ok" means refused, and 400 is what
        // Supabase answers for a refresh token it will not renew. A named status always
        // wins, so a test can ask for a 401 or a 503 without also saying refreshOk false.
        if (!refreshOk || refreshStatus !== 200) {
          return { ok: false, status: refreshStatus === 200 ? 400 : refreshStatus, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ({ access_token: 'renewed-access-token', refresh_token: 'renewed-refresh-token' }) };
      }
      if (url.includes('/auth/v1/user')) {
        // WHY the stub reads the store rather than a fixed flag: a renewal produces a new
        // token, so a call made after one must succeed. A stub that answered 401 forever
        // would make every page look broken for a reason that does not exist.
        const current = store['opera-agent-access-token'];
        const usable = accessOk || current === 'renewed-access-token';
        return { ok: usable, status: usable ? 200 : 401, json: async () => (usable ? { email: 'a@b.c' } : {}) };
      }
      if (url.includes('/oauth/authorizations/')) return { ok: true, status: 200, json: async () => ({ authorization_id: 'abc', redirect_uri: 'http://127.0.0.1:1/callback', client: { name: 'opencode' }, scope: 'openid email' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, devices: [], user: { email: 'a@b.c' } }) };
    }
  });
  context.globalThis = context;
  try {
    vm.runInContext(source, context, { filename: page });
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return { store, cleared, rejections };
}

const RENEWING_PAGES = ['akun.html', 'dashboard.html', 'oauth/consent.html'];

test('an aged access token is renewed rather than deleted', async () => {
  for (const page of RENEWING_PAGES) {
    const { store, cleared, rejections } = await run(page, { accessOk: false, refreshOk: true });
    assert.deepEqual(rejections, [], `${page} rejected: ${rejections.join('; ')}`);
    assert.equal(store['opera-agent-access-token'], 'renewed-access-token', `${page} stores the renewed access token`);
    assert.equal(store['opera-agent-refresh-token'], 'renewed-refresh-token', `${page} rotates the refresh token too`);
    assert.deepEqual(cleared, [], `${page} forgets nothing when renewal worked`);
  }
});

test('a refresh token that is also refused ends the session, and both halves of it', async () => {
  // WHY both keys: clearing only the access token leaves a refresh token behind, and the
  // next load would try to renew with a token already known to be dead.
  for (const page of RENEWING_PAGES) {
    const { cleared } = await run(page, { accessOk: false, refreshOk: false });
    for (const key of STORAGE_KEYS) {
      assert.ok(cleared.includes(key), `${page} forgets ${key} when the session is truly gone`);
    }
  }
});

test('a valid access token is not renewed at all', async () => {
  for (const page of RENEWING_PAGES) {
    const { store, cleared } = await run(page, { accessOk: true });
    assert.equal(store['opera-agent-access-token'], 'expired-access-token', `${page} keeps a token that still works`);
    assert.deepEqual(cleared, [], `${page} forgets nothing`);
  }
});

test('a renewal that cannot reach Auth is not a sign-out', async () => {
  // WHY this is the lock that matters for every other user: the renewal answers null for a
  // dropped packet and for a refused token alike, and the caller was deleting the session
  // either way. A phone in a tunnel must not end a session. `refreshFails` throws from the
  // stub, which is what a network error looks like to fetch.
  for (const page of RENEWING_PAGES) {
    const { store, cleared } = await run(page, { accessOk: false, refreshFails: true });
    assert.deepEqual(cleared, [], `${page} forgets nothing when Auth is unreachable`);
    assert.equal(store['opera-agent-access-token'], 'expired-access-token', `${page} leaves the stored token alone`);
    assert.equal(store['opera-agent-refresh-token'], 'a-refresh-token', `${page} keeps the refresh token for the retry`);
  }
});

test('a refused refresh token is the only thing that ends a session', async () => {
  for (const page of RENEWING_PAGES) {
    const { cleared } = await run(page, { accessOk: false, refreshStatus: 401 });
    for (const key of STORAGE_KEYS) {
      assert.ok(cleared.includes(key), `${page} forgets ${key} when the refresh token is refused`);
    }
  }
});

test('a server error from the renewal endpoint is treated as temporary', async () => {
  for (const page of RENEWING_PAGES) {
    const { cleared } = await run(page, { accessOk: false, refreshStatus: 503 });
    assert.deepEqual(cleared, [], `${page} keeps the session when Auth is having a bad day`);
  }
});

test('the sign-in page stores the refresh token, which is what makes renewal possible', () => {
  const html = read('landing/auth.html');
  // WHY this one asserts on source rather than on a run: the refresh token arrives in the
  // URL fragment, which only a real provider login produces.
  assert.match(html, /fragment\.get\('refresh_token'\)/, 'the returning session keeps its refresh token');
  assert.match(html, /localStorage\.setItem\('opera-agent-refresh-token'/, 'and stores it');
  assert.match(html, /token\?grant_type=refresh_token/, 'the renewal endpoint is the documented one');
});

test('every signed-in page can renew, so signing out on one does not sign out on all', () => {
  for (const page of ['auth.html', 'akun.html', 'dashboard.html', 'oauth/consent.html']) {
    const html = read(`landing/${page}`);
    assert.match(html, /async function renewAccessToken/, `${page} can renew its session`);
    assert.match(html, /opera-agent-refresh-token/, `${page} knows the refresh token`);
  }
});