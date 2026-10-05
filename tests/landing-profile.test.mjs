// @last-edited: 2026-10-05 14:50 UTC+7.
// @title: landing-profile — the account card renders every real Supabase session shape.
// @state: 4 locks, green against google-after-magic-link, github-without-name, and email-only.
// @dependencies: node:test, node:assert, node:fs, node:vm.

// The profile card is the first thing a stranger reads on the account page, and the
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

// Lift the card's own block out of the page: no copy of the logic lives in the test,
// so the page and the lock can never disagree about what renders.

const block = html.slice(html.indexOf('const PROVIDER_LABEL'), html.indexOf('async function load'));

function render(user) {
  const nodes = {};
  const $ = (id) => ({
    set textContent(value) { nodes[id] = value; },
    get textContent() { return nodes[id]; },
    set title(value) { nodes[`${id}Title`] = value; }
  });
  const context = vm.createContext({ $ });
  const api = vm.runInContext(`(() => { ${block}\nreturn { renderProfile }; })()`, context);
  api.renderProfile(user);
  return {
    name: nodes.profileName,
    email: nodes.profileMeta,
    provider: String(nodes.profileProvider).replace('Masuk lewat ', ''),
    initials: nodes.avatar
  };
}

test('the card block the lock executes is the block the page ships', () => {
  // WHY: if this ever reads empty, the locks below would pass on nothing at all.
  for (const part of ['PROVIDER_LABEL', 'providerOf', 'initialsOf', 'renderProfile']) {
    assert.ok(block.includes(part), `the card block carries ${part}`);
  }
  assert.ok(block.length > 800, 'and it carries the whole block, not a fragment');
});

test('an account created by magic link then signed in with Google still says Google', () => {
  // WHY this exact payload: measured on this project, app_metadata.provider reads
  // "email" for this account while providers reads ["email","google"], because the
  // magic link created the row before Google was linked.
  const card = render({
    email: 'afnan@example.com',
    app_metadata: { provider: 'email', providers: ['email', 'google'] },
    user_metadata: { full_name: 'Afnan Nuzula Sugihartono', name: 'Afnan Nuzula Sugihartono', avatar_url: 'https://example.com/a.png' }
  });
  assert.equal(card.provider, 'Google', 'the named provider wins over the email entry');
  assert.equal(card.name, 'Afnan Nuzula Sugihartono');
  assert.equal(card.email, 'afnan@example.com');
  assert.equal(card.initials, 'AN', 'initials come from the first two words');
});

test('a GitHub account with only a login renders its handle, not a blank', () => {
  const card = render({
    email: 'dev@example.com',
    app_metadata: { provider: 'github', providers: ['github'] },
    user_metadata: { user_name: 'octocat', name: null }
  });
  assert.equal(card.provider, 'GitHub');
  assert.equal(card.name, 'octocat', 'the handle is used when there is no full name');
  assert.equal(card.initials, 'DE', 'initials fall back to the local part of the address');
});

test('a magic-link-only account says so instead of claiming a provider', () => {
  const card = render({
    email: 'solo@example.com',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {}
  });
  assert.equal(card.provider, 'Tautan email');
  assert.equal(card.name, 'solo@example.com', 'the address stands in for a missing name');
  assert.equal(card.initials, 'SO');
});

test('a session missing every name field still renders something', () => {
  const card = render({ email: '', app_metadata: {}, user_metadata: {} });
  // WHY: the card must never render a blank row that looks like a broken product.
  assert.equal(card.initials, 'OA', 'a person with no name at all gets the product initials');
  assert.ok(card.name !== undefined, 'the name line is written, not left undefined');
});