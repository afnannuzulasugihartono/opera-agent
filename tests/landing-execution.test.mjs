// @last-edited: 2026-10-06 11:26 UTC+7.
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

const CONSENT_ELEMENTS = ['status', 'factsCard', 'signedOutCard', 'signInButton', 'clientName', 'factClient', 'factRedirect', 'redirectNote', 'scopeList', 'factUser', 'approveButton', 'denyButton', 'consentsCard', 'consentList'];

// WHY the home elements start in their markup state and not in the stub's default:
// the shared stub answers `hidden: true` so an untouched card reads as hidden. The
// home page shows `ctaOut` in the markup, so a stub that started it hidden would
// make "acquisition actions hide on a stored session" pass on an empty node —
// a lock that cannot fail. The truth a run must change is recorded here instead.

const HOME_ELEMENTS = {
  heroEyebrow: { textContent: 'Daftar terbuka \u00b7 Gratis dipakai' },
  ctaOut: { hidden: false },
  ctaIn: { hidden: true },
  quickTiles: { hidden: true }
};

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
  nodes.__bodyClasses = new Set();
  const element = (id) => (nodes[id] ||= {
    id, textContent: '', innerHTML: '', className: '', value: '', hidden: true, href: '',
    disabled: false, dataset: {}, children: [], querySelectorAll: () => [],
    addEventListener() {}, querySelector: () => null, closest: () => null,

    // WHY real child bookkeeping and not no-ops: the home page builds its model
    // datalist with createElement/append, so the stub keeps the appended options
    // where an assertion can read them instead of swallowing them silently.
    replaceChildren() { this.children.length = 0; },
    append(child) { this.children.push(child); return child; }
  });

  // Every element the page could ask for exists, so an untouched card reads as hidden rather
  // than absent, which is what the markup's `hidden` attribute means to a person.
  const preCreated = new Set(['status', 'whoami', 'profileCard', 'avatar', 'profileName', 'profileMeta', 'profileProvider', 'factEmail', 'factProvider', 'factLastSignIn', 'factUserId', 'linkedProviders', 'deviceSummary', 'signOutButton', 'runButton', 'runStatus', 'pairButton', 'pairStatus', 'devices', 'sessionStatus', ...CONSENT_ELEMENTS]);
  for (const id of preCreated) element(id);

  // The home page reads these only when a session is stored, so a run with no
  // session would otherwise answer `undefined` for the very flags it must prove
  // stayed put. Markup state is the baseline both cases are judged against.
  for (const [id, state] of Object.entries(HOME_ELEMENTS)) Object.assign(element(id), state);

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

      // WHY MutationObserver exists here: the dashboard watches for the install marker
      // landing after the module has read the document, so the harness has to offer the
      // observer the page constructs. observe() records nothing; the two cases set the
      // marker before load, and a second run sets it later to prove the page reacts.
      body: {
        // WHY a recording set: the home page marks the body signed-in from a stored
        // session, and only an executed module proves the swap instead of its source.
        classes: new Set(),
        classList: {
          add(c) { nodes.__bodyClasses.add(c); },
          remove(c) { nodes.__bodyClasses.delete(c); },
          contains(c) { return nodes.__bodyClasses.has(c); }
        }
      },
      getElementById: (id) => element(id),
      querySelectorAll: () => [],
      createElement: (tag) => ({ tagName: String(tag).toUpperCase(), value: '', textContent: '' }),

      // WHY a stub element and not null: the dashboard writes the device count
      // into its rail link, so a null answer turns every device render into a
      // TypeError. The stub records under its selector, like getElementById does.
      querySelector: (sel) => element(`qs:${sel}`),
      addEventListener() {}
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; context.observers.push(this); }
      observe() {}
      disconnect() {}
    },

    // WHY the rail observer is stubbed too: the dashboard marks which section the
    // reader is on, and the harness runs the same module. A missing IntersectionObserver
    // makes every dashboard case fail on a feature no reader would ever notice.
    IntersectionObserver: class {
      constructor() { this.cb = () => {}; }
      observe() {}
      disconnect() {}
    },
    observers: [],
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

  // WHY the summary is asserted from the same run: the stats must be sums over the
  // payload the cards render, and only an executed module proves the arithmetic.
  assert.equal(nodes.statDevices.textContent, 1, 'the device count is computed, not written');
  assert.equal(nodes.statOnline.textContent, 1, 'and so is the online count');
  assert.match(nodes.statCommands.textContent, /8970 dari 9000/, 'and the command tally');
  assert.equal(nodes['qs:.rail a[href="#device"]'].textContent, 'Device (1)', 'the rail counts what it links to');
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

test('the dashboard reacts to the marker landing after it has already read the page', async () => {
  // WHY this case: the content script runs at document_idle, so on a slow page the
  // marker arrives after the module has rendered. Reading once would tell a reader who
  // already has the extension that it is missing, and they would install a second copy.
  const { nodes, rejected, context } = await run('dashboard.html', { extensionInstalled: false });
  assert.deepEqual(rejected, [], `the module rejected: ${rejected.join('; ')}`);
  assert.match(nodes.installState.textContent, /belum terpasang/, 'the page starts by reporting it missing');
  assert.ok(context.observers.length > 0, 'the page watches for the marker instead of reading once');

  context.document.documentElement.dataset.operaAgent = 'installed';
  for (const observer of context.observers) observer.callback();
  assert.match(nodes.installState.textContent, /Opera Agent terpasang di browser ini/,
    'the line corrects itself when the marker arrives, without a reload');
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

test('home swaps to member actions on a stored session, and stays put without one', async () => {
  // WHY executed and not source-read: the swap touches four elements and a body
  // class from one localStorage read. Only a run proves the hidden flags land
  // where the stylesheet expects them.
  const signed = await run('index.html');
  assert.deepEqual(signed.rejected, [], `the module rejected: ${signed.rejected.join('; ')}`);
  assert.ok(signed.context.document.body.classList.contains('signed-in'), 'the body is marked');
  assert.equal(signed.nodes.ctaOut.hidden, true, 'acquisition actions hide');
  assert.equal(signed.nodes.ctaIn.hidden, false, 'member actions show');
  assert.equal(signed.nodes.quickTiles.hidden, false, 'and the inward tiles show');
  assert.equal(signed.nodes.heroEyebrow.textContent, 'Sesi aktif di browser ini', 'the eyebrow says what is true');
  const stranger = await run('index.html', { stored: {} });
  assert.ok(!stranger.context.document.body.classList.contains('signed-in'), 'no session, no mark');
  assert.equal(stranger.nodes.ctaIn.hidden, true, 'member actions stay hidden');
});

test('a pending permission request shows the real client name and the facts to judge', async () => {
  const { nodes, rejected } = await run('oauth/consent.html');
  assert.deepEqual(rejected, [], `the module rejected: ${rejected.join('; ')}`);
  assert.equal(nodes.factsCard.hidden, false, 'the permission card is shown');
  assert.equal(nodes.factClient.textContent, 'opencode', 'the application name is the one the server reported');
  assert.equal(nodes.clientName.textContent, 'opencode', 'and the heading names it too');
  assert.equal(nodes.factRedirect.textContent, AUTHORIZATION.redirect_uri, 'the code destination is shown');
  assert.match(nodes.scopeList.innerHTML, /openid/, 'each requested scope is listed');
  assert.match(nodes.scopeList.innerHTML, /email/, 'with its plain-language meaning, not the raw string alone');
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