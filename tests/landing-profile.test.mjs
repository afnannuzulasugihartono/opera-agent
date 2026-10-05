// @last-edited: 2026-10-05 15:25 UTC+7.
// @title: landing-profile — the account page renders every real Supabase session shape.
// @state: 6 locks, green against google-after-magic-link, github-without-name, and email-only.
// @dependencies: node:test, node:assert, node:fs, node:vm.

// The account page is the first thing a stranger reads after signing in, and the
// shape of a Supabase session is not something to guess: measured on this project, an
// account that signed in with Google reports provider "email" because a magic link
// created the row first, and a GitHub account may carry only a login with no full name.
// Rendering the wrong provider on that data would tell the operator they signed in a
// way they did not, so the card's own logic is executed here against those payloads.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('landing/akun.html', root), 'utf8');

// Lift the page's own block out of the file: no copy of the logic lives in the test,
// so the page and the lock can never disagree about what renders.

const block = html.slice(html.indexOf('const PROVIDER_LABEL'), html.indexOf('async function load'));

function render(user) {
  const nodes = {};
  const $ = (id) => ({
    set textContent(value) { nodes[id] = value; },
    get textContent() { return nodes[id]; },
    set innerHTML(value) { nodes[id] = value; },
    get innerHTML() { return nodes[id]; },
    set title(value) { nodes[`${id}Title`] = value; }
  });
  const context = vm.createContext({ $ });
  const api = vm.runInContext(`(() => { ${block}\nreturn { renderIdentity }; })()`, context);
  api.renderIdentity(user);
  return {
    name: nodes.profileName,
    email: nodes.profileMeta,
    provider: String(nodes.profileProvider).replace('Masuk lewat ', ''),
    factProvider: nodes.factProvider,
    factEmail: nodes.factEmail,
    factUserId: nodes.factUserId,
    initials: nodes.avatar,
    linked: String(nodes.linkedProviders ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  };
}

test('the block the lock executes is the block the page ships', () => {
  // WHY: if this ever reads empty, the locks below would pass on nothing at all.
  for (const part of ['PROVIDER_LABEL', 'providerOf', 'linkedProviders', 'initialsOf']) {
    assert.ok(block.includes(part), `the account page block carries ${part}`);
  }
  assert.ok(block.length > 900, 'and it carries the whole block, not a fragment');
  assert.match(html, /function renderIdentity/, 'the renderer itself is inside the block');
});

test('an account created by magic link then signed in with Google still says Google', () => {
  // WHY this exact payload: measured on this project, app_metadata.provider reads
  // "email" for this account while providers reads ["email","google"], because the
  // magic link created the row before Google was linked.
  const card = render({
    id: '1ec02bc3-7c1b-45a2-b864-837e95ba3b24',
    email: 'afnan@example.com',
    app_metadata: { provider: 'email', providers: ['email', 'google'] },
    user_metadata: { full_name: 'Afnan Nuzula Sugihartono', name: 'Afnan Nuzula Sugihartono', avatar_url: 'https://example.com/a.png' }
  });
  assert.equal(card.provider, 'Google', 'the named provider wins over the email entry');
  assert.equal(card.factProvider, 'Google', 'the facts row agrees with the card');
  assert.equal(card.name, 'Afnan Nuzula Sugihartono');
  assert.equal(card.email, 'afnan@example.com');
  assert.equal(card.factUserId, '1ec02bc3-7c1b-45a2-b864-837e95ba3b24', 'the account id is shown so support can ask for it');
  assert.equal(card.initials, 'AN', 'initials come from the first two words');
  assert.match(card.linked, /google/, 'the linked list names Google');
});

test('a GitHub account with only a login renders its handle, not a blank', () => {
  const card = render({
    id: 'dev-1',
    email: 'dev@example.com',
    app_metadata: { provider: 'github', providers: ['github'] },
    user_metadata: { user_name: 'octocat', name: null }
  });
  assert.equal(card.provider, 'GitHub');
  assert.equal(card.name, 'octocat', 'the handle is used when there is no full name');
  assert.equal(card.initials, 'DE', 'initials fall back to the local part of the address');
  assert.match(card.linked, /github/, 'the linked list names GitHub');
});

test('a magic-link-only account says so instead of claiming a provider', () => {
  const card = render({
    id: 'solo-1',
    email: 'solo@example.com',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {}
  });
  assert.equal(card.provider, 'Tautan email');
  assert.equal(card.name, 'solo@example.com', 'the address stands in for a missing name');
  assert.equal(card.initials, 'SO');
});

test('a session missing every name field still renders something', () => {
  const card = render({ id: 'anon-1', email: '', app_metadata: {}, user_metadata: {} });
  // WHY: the page must never render a blank row that looks like a broken product.
  // The name falls back to "Akun Opera Agent", so the initials come from that rather
  // than from the 'OA' guard, which only fires if a future edit removes the fallback.
  assert.match(card.initials, /^[A-Z]{2}$/, `the avatar is never blank, got "${card.initials}"`);
  assert.equal(card.name, 'Akun Opera Agent', 'a nameless session gets the product name, not undefined');
  assert.equal(card.factEmail, '(tanpa alamat)', 'the missing address is stated, not blank');
  assert.equal(card.factUserId, 'anon-1');
  assert.match(card.provider, /email/, 'a session with no provider metadata still names one');
});

test('the account page never fetches a provider avatar', () => {
  // WHY: an <img> from a provider CDN would be a second network origin, a second CSP
  // entry in vercel.json, and a third party receiving a request on every page view.
  // The name and provider name carry the same information for free.
  assert.doesNotMatch(html, /<img[^>]+src=/, 'no image element is rendered');
  assert.doesNotMatch(html, /avatar_url/, 'not even the provider image URL is read');
  assert.match(html, /class="avatar"/, 'the avatar is drawn locally from initials');
});