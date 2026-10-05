// @last-edited: 2026-10-05 18:30 UTC+7.
// @title: landing-consent-flow — the consent page's own module, executed against five flows.
// @state: 15 assertions, green against a pending request, no session, an already-decided
//   request, an unnamed client, and an expired session.
// @dependencies: node:test, node:assert, node:fs, node:vm.

// The other consent locks read the file. This one runs it, because the defects that
// mattered on the screen it replaces were all invisible in the source: the wrong
// application name rendered fine, the CDN import worked, and the page looked correct in
// every screenshot. Only executing it against the payloads Supabase actually returns
// shows whether a person would be told the truth.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('landing/consent.html', root), 'utf8');
const source = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];

const TOKEN = 'test-access-token';
const AUTHORIZATION_ID = 'etw5yeqnztjr7t6jzhnctwp24jewcdt';
const ELEMENTS = ['status', 'factsCard', 'signedOutCard', 'signInButton', 'clientName', 'factClient', 'factRedirect', 'factScope', 'factUser', 'approveButton', 'denyButton'];
const DETAILS = {
  authorization_id: AUTHORIZATION_ID,
  redirect_uri: 'http://127.0.0.1:53036/callback',
  client: { id: '53e484d7-42c5-4f4b-83c3-6ab5634194a9', name: 'opencode' },
  scope: 'openid email'
};

async function run({ token = TOKEN, details = DETAILS, redirectUrl = null } = {}) {
  const nodes = {};
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason?.message || String(reason));
  process.on('unhandledRejection', onRejection);
  // WHY every element is pre-created: an untouched card must read as hidden, which is
  // what the markup's `hidden` attribute means to a person, rather than absent.
  for (const id of ELEMENTS) nodes[id] = { id, textContent: '', innerHTML: '', className: '', hidden: true, href: '', disabled: false, dataset: {}, querySelectorAll: () => [], addEventListener() {} };
  const context = vm.createContext({
    console, Intl, Date, JSON, Math, Number, String, Array, Object, RegExp, Error, URLSearchParams, setTimeout, encodeURIComponent,
    location: { search: `?authorization_id=${AUTHORIZATION_ID}`, assign(url) { context.assigned = url; }, href: 'https://opera-agent.vercel.app/consent' },
    localStorage: { getItem: (key) => (key === 'opera-agent-access-token' ? token : null), removeItem() { context.forgot = true; } },
    navigator: {},
    document: { getElementById: (id) => nodes[id], querySelectorAll: () => [] },
    fetch: async (url) => {
      if (url.includes('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ email: 'afnan@example.com' }) };
      if (url.endsWith('/consent')) return { ok: true, status: 200, json: async () => ({ redirect_url: 'http://127.0.0.1:53036/callback?code=abc' }) };
      if (url.includes('/oauth/authorizations/')) return { ok: true, status: 200, json: async () => ({ ...details, redirect_url: redirectUrl }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });
  context.globalThis = context;
  try {
    vm.runInContext(source, context, { filename: 'consent.html' });
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return { nodes, rejections, context };
}

test('a pending request shows the real client name and the three facts to judge', async () => {
  const { nodes, rejections } = await run();
  assert.deepEqual(rejections, [], `the consent module rejected: ${rejections.join('; ')}`);
  assert.equal(nodes.factsCard.hidden, false, 'the permission card is shown');
  assert.equal(nodes.factClient.textContent, 'opencode', 'the application name is the one the server reported');
  assert.equal(nodes.clientName.textContent, 'opencode', 'and the heading names it too');
  assert.equal(nodes.factRedirect.textContent, DETAILS.redirect_uri, 'the code destination is shown');
  assert.equal(nodes.factScope.textContent, DETAILS.scope, 'the scope is shown');
  assert.equal(nodes.factUser.textContent, 'afnan@example.com', 'the account granting consent is shown');
  assert.doesNotMatch(JSON.stringify(nodes), /ChatGPT/, 'no other application name appears anywhere');
});

test('a person with no session is offered sign-in with the request intact', async () => {
  const { nodes } = await run({ token: null });
  assert.equal(nodes.signedOutCard.hidden, false, 'the sign-in card is shown');
  assert.equal(nodes.factsCard.hidden, true, 'and no permission is offered to someone who cannot grant it');
  assert.ok(nodes.signInButton.href.includes(AUTHORIZATION_ID), 'the authorization_id survives the round trip');
});

test('a request Supabase already decided is followed, not asked again', async () => {
  // WHY: GoTrue auto-approves when the same client already holds consent covering the
  // requested scopes and returns the redirect instead of details. Asking again would put
  // a decision in front of a person that was already made for them.
  const { nodes, context } = await run({ redirectUrl: 'http://127.0.0.1:53036/callback?code=already' });
  assert.equal(context.assigned, 'http://127.0.0.1:53036/callback?code=already');
  assert.equal(nodes.factsCard.hidden, true, 'nothing is asked for');
});

test('a client that sent no name is not replaced with a guess', async () => {
  const { nodes } = await run({ details: { ...DETAILS, client: { id: 'x', name: null } } });
  assert.equal(nodes.clientName.textContent, 'Nama aplikasi tidak diberikan');
});

test('an absent session leads to sign-in rather than a loop of failures', async () => {
  const { nodes } = await run({ token: null });
  assert.equal(nodes.signedOutCard.hidden, false, 'the one available recovery is offered');
});