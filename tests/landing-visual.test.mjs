// @last-edited: 2026-10-06 10:56 UTC+7.
// @title: landing-visual — the site looks finished on every screen.
// @state: red first: gibberish hero copy, nested sections, overflowing nav and code pills.
// @dependencies: test, assert, fs.

// Company grade is decided in five seconds on a phone: a hero that shows the
// product, copy without a broken sentence, and nothing spilling out of its box.
// Military grade adds validity underneath it. Measured in Chromium screenshots:
// the hero was text-only with "Sembilan dua tool", the FAQ section opened inside
// the privacy section without closing it, the seven-item nav wrapped into two
// ragged lines at 390px, a code pill crossed its card border, and unduh broke
// code mid-word with word-break:break-all.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const pages = ['index.html', 'akun.html', 'auth.html', 'dashboard.html', 'unduh.html', 'privasi.html', 'syarat.html', '404.html', 'oauth/consent.html'];

test('the hero sells the product instead of apologizing for it', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /Sembilan dua/, 'the broken sentence is gone');
  assert.match(html, /22 tool|dua puluh dua/, 'the tool count is stated as a number');
  assert.match(html, /class="eyebrow"/, 'an eyebrow names the release above the headline');
  assert.match(html, /id="demo"/, 'a product visual answers what the words claim');
  assert.match(html, /id="heroStats"/, 'numbers sit under the call to action, not in prose');
});

test('every section closes before the next one opens', () => {
  for (const page of pages) {
    const html = read(page);
    const opens = (html.match(/<section/g) || []).length;
    const closes = (html.match(/<\/section>/g) || []).length;
    assert.equal(opens, closes, `${page} balances its sections`);
  }
  const index = read('index.html');
  assert.match(index, /<\/section>\s*<section id="faq">/, 'the FAQ stands beside privacy, not inside it');
});

test('the nav survives a 390px phone without wrapping ragged', () => {
  for (const page of pages) {
    const css = read(page);
    assert.match(css, /white-space:\s*nowrap/, `${page} keeps each nav item on one line`);
  }
  const index = read('index.html');
  assert.match(index, /overflow-x:\s*auto/, 'the row scrolls instead of wrapping');
});

test('a code pill never crosses its card border or breaks mid-word', () => {
  for (const page of pages) {
    assert.doesNotMatch(read(page), /word-break:\s*break-all/, `${page} breaks at word bounds, not mid-token`);
  }
  assert.match(read('index.html'), /box-decoration-break:\s*clone/, 'a wrapped pill keeps both halves boxed');
});

test('the marked nav item is visible, not metadata only', () => {
  for (const page of ['index.html', 'akun.html', 'dashboard.html', 'unduh.html', 'privasi.html', '404.html']) {
    assert.match(read(page), /a\[aria-current="page"\]/, `${page} styles the current item`);
  }
});

test('the provider buttons show their marks, not bare text', () => {
  const html = read('auth.html');
  assert.match(html, /id="googleButton"[^>]*>[\s\S]*?<svg/, 'Google carries its mark inside the button');
  assert.match(html, /id="githubButton"[^>]*>[\s\S]*?<svg/, 'GitHub carries its mark inside the button');
});

test('the 404 exits are real doors, counted honestly', () => {
  // WHY this lock: the page promises ways out, and a tile that looks like a card
  // but goes nowhere is the one lie a lost visitor cannot forgive. Counted too:
  // the copy said four while five tiles stood under it.
  const html = read('404.html');
  const tiles = [...html.matchAll(/<a class="tile" href="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(tiles.length >= 4, 'the exits exist as links, not divs');
  const words = { 4: 'Empat', 5: 'Lima', 6: 'Enam' };
  assert.match(html, new RegExp(`${words[tiles.length]} jalan keluar`), 'the copy counts what stands under it');
  assert.match(html, /\.tile:hover/, 'a tile answers the hover, so it reads clickable');
});

test('the legal pages open with a map, not a wall', () => {
  // WHY this lock: five h2s with no way to jump is a wall of text. A three-line
  // table of contents costs nothing and a company policy page always has one.
  for (const page of ['privasi.html', 'syarat.html']) {
    const html = read(page);
    const ids = [...html.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]);
    assert.ok(ids.length >= 4, `${page} names its sections`);
    for (const id of ids) {
      assert.ok(html.includes(`href="#${id}"`), `${page} links to #${id} from its map`);
    }
  }
});
