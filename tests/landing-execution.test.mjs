// @last-edited: 2026-10-06 05:12 UTC+7.
// @title: landing-execution — every page's own module, run against a stub Auth and a stub DOM.
// @state: 12 locks, one harness; it replaces the three files that each built their own.
// @dependencies: node:test, node:assert, node:fs, node:vm.

// A page whose markup is perfect and whose script throws renders nothing, and the failures
// that mattered on this site were all invisible in the source: the device list came up
// empty under a correct status line, the permission screen named the wrong application, and
// a renewal that could not reach Auth deleted a working session. Reading HTML cannot see any
// of them. So each page's own module is executed here against a stub Auth and a stub DOM.
//
// WHY one file and three: the render, consent-flow and session locks each built the same
// harness. Three copies of a stub is three places for a stub to be wrong, which is the same
// rule the repository applies to every other mechanism.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const moduleOf = (page) => /<script type="module">([\s\S]*?)<\/script>/.exec(read(`landing/${page}`))[1];

const EMAIL = 'afnan@example.com';
const TOKEN = 'test-access-token';
const REFRESH = 'a-refresh-token';
const RENEWED = 'renewed-access-token';
const DEVICE = {
  id: '47045394-b983-4299-a5de-ba6e4b64270d',
  name: 'opera',
  status: 'online',
  extensionVersion: '1.6.14',
  lastSeenAt: new Date(Date.now() - 7_200_000).toISOString(),
  completedCommands: 8970,
  totalCommands: 9000,
  commands: [{ method: 'tabs.list', status: 'completed' }]
};
const AUTHORIZATION = {
  authorization_id: 'abc123',
  redirect_uri: 'http://127.0.0.1:50365/callback',
  client: { id: '53e484d7', name: 'opencode' },
  scope: 'openid email'
};

const CONSENT_ELEMENTS = ['status', 'factsCard', 'signedOutCard', 'signInButton', 'clientName', 'factClient', 'factRedirect', 'factScope', 'factUser', 'approveButton', 'denyButton'];

/**
 * Run one landing page's module against stub network and stub DOM.
 *
 * @param {string} page file name under landing/
 * @param {object} shape what the stub Auth and the stub account answer
 * @returns {Promise<{nodes: object, store: object, cleared: string[], rejected: string[], rejectedFetch: boolean, assigned: string|undefined, forgot: boolean}>}
 */
async function run(page, shape = {}) {
  const {
    search = '?authorization_id=abc123',
    stored = { 'opera-agent-access-token': TOKEN, 'opera-agent-refresh-token': REFRESH },
    accessOk = true,
    refreshStatus = 200,
    refreshFails = false,
    unreachable = false,
    // WHY the default is false: a harness that claimed the extension was installed
    // would make every dashboard case pass on the "installed" copy and never exercise
    // the message a reader who has not installed anything will actually see.
    extensionInstalled = false,
    devices = [DEVICE],
    authorization = AUTHORIZATION,
    authorizationRedirect = null
  } = shape;

  const store = { ...stored };
  const cleared = [];
  const rejected = [];
  const onRejection = (reason) => rejected.push(reason?.message || String(reason));
  process.on('unhandledRejection', onRejection);

  const nodes = {};
  const element = (id) => (nodes[id] ||= {
    id, textContent: '', innerHTML: '', className: '', value: '', hidden: true, href: '',
    disabled: false, dataset: {}, children: { length: 0 }, querySelectorAll: () => [],
    addEventListener() {}, querySelector: () => null, closest: () => null
  });
  // Every element the page could ask for exists, so an untouched card reads as hidden rather
  // than absent, which is what the markup's `hidden` attribute means to a person.
  const preCreated = new Set(['status', 'whoami', 'profileCard', 'avatar', 'profileName', 'profileMeta', 'profileProvider', 'factEmail', 'factProvider', 'factLastSignIn', 'factUserId', 'linkedProviders', 'deviceSummary', 'signOutButton', 'runButton', 'runStatus', 'pairButton', 'pairStatus', 'devices', 'sessionStatus', ...CONSENT_ELEMENTS]);
  for (const id of preCreated) element(id);

  const context = vm.createContext({
    console, Intl, Date, JSON, Math, Number, String, Array, Object, RegExp, Error,
    URLSearchParams, encodeURIComponent, setTimeout,
    location: { search, hash: '', pathname: `/${page}`, href: `https://opera-agent.vercel.app/${page}`, replace() {}, assign(url) { context.assigned = url; } },
    localStorage: {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { cleared.push(key); context.forgot = true; delete store[key]; }
    },
    navigator: { clipboard: { writeText: async () => {} } },
    document: {
      // WHY documentElement exists here: the dashboard reads the install marker the
      // content script leaves on documentElement, so the harness has to offer the node
      // the page reads. `extensionInstalled` models the two real cases — a browser with
      // the extension, where the content script has written the marker, and one
      // without, where it has not.
      documentElement: {
        dataset: extensionInstalled ? { operaAgent: 'installed' } : {}
      },
      getElementById: (id) => element(id),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {}
    },
    confirm: () => false,
    fetch: async (url) => {
      if (unreachable) throw new TypeError('Failed to fetch');
      if (url.includes('/token?grant_type=refresh_token')) {
        if (refreshFails) throw new TypeError('Failed to fetch');
        if (refreshStatus !== 200) return { ok: false, status: refreshStatus, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ access_token: RENEWED, refresh_token: 'renewed-refresh-token' }) };
      }
      if (url.includes('/auth/v1/user')) {
        // WHY the stub reads the store rather than a flag: a renewal produces a new token,
        // so a call made after one must succeed. A stub answering 401 forever would make
        // every page look broken for a reason that does not exist.
        const usable = accessOk || store['opera-agent-access-token'] === RENEWED;
        // WHY this shape exactly: measured on this project, an account that signed in with
        // Google still reports provider "email" with providers ["email","google"], because a
        // magic link created the row first. A stub with a single google entry would not
        // exercise the reason the page reads the array.
        const user = {
          email: EMAIL,
          id: 'u1',
          app_metadata: { provider: 'email', providers: ['email', 'google'] },
          user_metadata: { full_name: 'Afnan Nuzula Sugihartono', name: 'Afnan Nuzula Sugihartono', avatar_url: 'https://example.com/a.png' },
          last_sign_in_at: new Date(Date.now() - 3_600_000).toISOString()
        };
        return { ok: usable, status: usable ? 200 : 401, json: async () => (usable ? user : {}) };
      }
      if (url.includes('/oauth/authorizations/') && url.endsWith('/consent')) {
        return { ok: true, status: 200, json: async () => ({ redirect_url: `${DEVICE.redirectUri || 'http://127.0.0.1:1/callback'}?code=abc` }) };
      }
      if (url.includes('/oauth/authorizations/')) {
        return { ok: true, status: 200, json: async () => ({ ...authorization, redirect_url: authorizationRedirect }) };
      }
      if (url.includes('opera_my_devices')) return { ok: true, status: 200, json: async () => ({ ok: true, devices }) };
      if (url.includes('opera_run_on_my_device')) return { ok: true, status: 200, json: async () => ({ ok: true, status: 'completed' }) };
      if (url.includes('opera_create_pairing_code')) return { ok: true, status: 200, json: async () => ({ ok: true, deviceName: 'opera', code: 'ABCD' }) };
      if (url.includes('opera_revoke_my_device')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });
  context.globalThis = context;
  try {
    vm.runInContext(moduleOf(page), context, { filename: page });
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return { nodes, store, cleared, rejected, context };
}

const SIGNED_IN_PAGES = ['akun.html', 'dashboard.html', 'oauth/consent.html'];

test('the dashboard renders a device card for a paired device', async () => {
  const { nodes, rejected } = await run('dashboard.html');
  assert.deepEqual(rejected, [], `the module rejected: ${rejected.join('; ')}`);
  assert.match(nodes.status.textContent, /1 device ter-pairing/, 'the status line counts the device');
  // WHY the card and not the count: the deployed bug produced a correct status line above an
  // empty list, because the throw happened while building the cards.
  assert.match(nodes.devices.innerHTML, /opera/, 'the device name is rendered');
  assert.match(nodes.devices.innerHTML, new RegExp(DEVICE.id), 'the device id is rendered');
  assert.match(nodes.devices.innerHTML, /tabs\.list/, 'the recent commands are rendered');
  assert.match(nodes.devices.innerHTML, /Cabut device ini/, 'the revoke control is rendered');
});

test('the dashboard names the extension when the browser does not have it', async () => {
  const { nodes, rejected } = await run('dashboard.html', { extensionInstalled: false });
  assert.deepEqual(rejected, [], `the module rejected: ${rejected.join('; ')}`);
  // WHY this case matters most: an empty device list and a "not installed" browser look
  // identical on the page without this line, so a reader who has not installed anything
  // cannot tell which step is missing.
  assert.match(nodes.installState.textContent, /Opera Agent belum terpasang di browser ini/,
    'the missing extension is named, not left for the reader to infer');
  assert.match(nodes.installState.textContent, /Pasang dulu/, 'and the next step is given');
});

test('the dashboard confirms the extension once the content script has marked the page', async () => {
  const { nodes, rejected } = await run('dashboard.html', { extensionInstalled: true });
  assert.deepEqual(rejected, [], `the module rejected: ${rejected.join('; ')}`);
  assert.match(nodes.installState.textContent, /Opera Agent terpasang di browser ini/,
    'the installed case is stated, so the line is not a permanent warning');
});

test('the account page renders the identity facts and the device count', async () => {
  const { nodes, rejected } = await run('akun.html');
  assert.deepEqual(rejected, [], `the module rejected: ${rejected.join('; ')}`);
  assert.equal(nodes.factEmail.textContent, EMAIL, 'the address is rendered');
  assert.equal(nodes.factProvider.textContent, 'Google', 'the resolved provider is rendered');
  assert.equal(nodes.factUserId.textContent, 'u1', 'the account id is rendered');
  assert.match(nodes.factLastSignIn.textContent, /lalu|jam|hari|detik|menit/, 'the last sign-in reads as relative Indonesian time');
  assert.match(nodes.deviceSummary.textContent, /1 device ter-pairing/, 'the device count is rendered');
});

test('a pending permission request shows the real client name and the facts to judge', async () => {
  const { nodes, rejected } = await run('oauth/consent.html');
  assert.deepEqual(rejected, [], `the module rejected: ${rejected.join('; ')}`);
  assert.equal(nodes.factsCard.hidden, false, 'the permission card is shown');
  assert.equal(nodes.factClient.textContent, 'opencode', 'the application name is the one the server reported');
  assert.equal(nodes.clientName.textContent, 'opencode', 'and the heading names it too');
  assert.equal(nodes.factRedirect.textContent, AUTHORIZATION.redirect_uri, 'the code destination is shown');
  assert.equal(nodes.factScope.textContent, AUTHORIZATION.scope, 'the scope is shown');
  assert.equal(nodes.factUser.textContent, EMAIL, 'the account granting consent is shown');
  assert.doesNotMatch(JSON.stringify(nodes), /ChatGPT/, 'no other application name appears anywhere');
});

test('a person with no session is offered sign-in with the request intact', async () => {
  const { nodes } = await run('oauth/consent.html', { stored: {} });
  assert.equal(nodes.signedOutCard.hidden, false, 'the sign-in card is shown');
  assert.equal(nodes.factsCard.hidden, true, 'and no permission is offered to someone who cannot grant it');
  assert.ok(nodes.signInButton.href.includes('abc123'), 'the authorization_id survives the round trip');
  assert.match(nodes.status.textContent, /Masuk dulu/, 'and the page says why');
});

test('a client that sent no name is not replaced with a guess', async () => {
  const { nodes } = await run('oauth/consent.html', { authorization: { ...AUTHORIZATION, client: { id: 'x', name: null } } });
  assert.equal(nodes.clientName.textContent, 'Nama aplikasi tidak diberikan');
});

test('a request Supabase already decided is followed, not asked again', async () => {
  // WHY: GoTrue auto-approves when the same client already holds consent covering the
  // requested scopes and returns the redirect instead of details. Asking again would put a
  // decision in front of a person that was already made for them.
  const { nodes, context } = await run('oauth/consent.html', { authorizationRedirect: 'http://127.0.0.1:1/callback?code=already' });
  assert.equal(context.assigned, 'http://127.0.0.1:1/callback?code=already');
  assert.equal(nodes.factsCard.hidden, true, 'nothing is asked for');
});

test('an unreachable Auth does not offer a sign-in form, and says the session is safe', async () => {
  // WHY: the session is intact and the network is not. Offering a sign-in form tells them the
  // opposite, and signing them out over a dropped packet was the defect this page was
  // measured with.
  const { nodes, context } = await run('oauth/consent.html', { unreachable: true });
  assert.equal(nodes.signedOutCard.hidden, true, 'no sign-in form while the network is down');
  assert.match(nodes.status.textContent, /Sesi Anda tetap aman/, 'and the page reassures rather than alarms');
  assert.equal(context.forgot, undefined, 'and nothing is forgotten');
});

test('an aged access token is renewed rather than deleted', async () => {
  for (const page of SIGNED_IN_PAGES) {
    const { store, cleared, rejected } = await run(page, { accessOk: false });
    assert.deepEqual(rejected, [], `${page} rejected: ${rejected.join('; ')}`);
    assert.equal(store['opera-agent-access-token'], RENEWED, `${page} stores the renewed access token`);
    assert.equal(store['opera-agent-refresh-token'], 'renewed-refresh-token', `${page} rotates the refresh token`);
    assert.deepEqual(cleared, [], `${page} forgets nothing when renewal worked`);
  }
});

test('a renewal that cannot reach Auth is not a sign-out', async () => {
  // WHY this is the lock that matters for every other user: a dropped packet and a refused
  // token look identical to a caller that only sees null, and the caller was deleting the
  // session either way. A phone in a tunnel must not end a session.
  for (const page of SIGNED_IN_PAGES) {
    const { store, cleared } = await run(page, { accessOk: false, refreshFails: true });
    assert.deepEqual(cleared, [], `${page} forgets nothing when Auth is unreachable`);
    assert.equal(store['opera-agent-access-token'], TOKEN, `${page} leaves the stored token alone`);
    assert.equal(store['opera-agent-refresh-token'], REFRESH, `${page} keeps the refresh token for the retry`);
  }
});

test('a server error from the renewal endpoint is treated as temporary', async () => {
  for (const page of SIGNED_IN_PAGES) {
    const { cleared } = await run(page, { accessOk: false, refreshStatus: 503 });
    assert.deepEqual(cleared, [], `${page} keeps the session when Auth is having a bad day`);
  }
});

test('a refused refresh token is the only thing that ends a session, and both halves of it', async () => {
  // WHY both keys: clearing only the access token leaves a refresh token behind, and the next
  // load would try to renew with a token already known to be dead.
  for (const page of SIGNED_IN_PAGES) {
    const { cleared } = await run(page, { accessOk: false, refreshStatus: 401 });
    for (const key of ['opera-agent-access-token', 'opera-agent-refresh-token']) {
      assert.ok(cleared.includes(key), `${page} forgets ${key} when the refresh token is refused`);
    }
  }
});

test('a valid access token is not renewed at all', async () => {
  for (const page of SIGNED_IN_PAGES) {
    const { store, cleared } = await run(page);
    assert.equal(store['opera-agent-access-token'], TOKEN, `${page} keeps a token that still works`);
    assert.deepEqual(cleared, [], `${page} forgets nothing`);
  }
});