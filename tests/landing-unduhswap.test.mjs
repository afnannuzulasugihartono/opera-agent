// @last-edited: 2026-10-10 UTC+7.
// @title: landing-unduhswap — the Steam-style hub door and the merged per-browser file cards.
// @state: 6 locks; the card/detection/hash pins live on the merged page, the hub keeps only the door pins.
// @dependencies: test, assert, fs, crypto.

// The hub opens with one giant door and an also-available row, while the merged page answers "which one is mine" with one card per browser.
// Each card fills the archive button — the file that installs on an unmanaged machine — and closes the signed file and the update manifest behind a details, before the shared steps.
// The download URLs and the compatibility facts are out of scope and stay pinned in landing-download and landing-unduh-hub.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { siteHeaders } from './helpers/site-headers.mjs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const hub = read('unduh.html');
const hubCss = read('download.css');
const berkas = read('unduh-berkas.html');

const ZIP = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip';
const CRX = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.crx';

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the hub opens with one giant door to the merged files page', () => {

  const curl = /curl\.exe -sI (\S+) \|/.exec(berkas)[1];
  assert.equal(ZIP, curl, 'the verification command reads the URL the cards offer');

  assert.match(hub, /<a\b[^>]*class="btn giant"[^>]*href="\.\/unduh-berkas\.html"[^>]*>Unduh Opera Agent<\/a>/,
    'one giant button to the merged page, product name as its text');
  assert.doesNotMatch(hub, /class="btn giant"[^>]*download/, 'navigation, not a download');
});

test('the also-available row names the other doors without leaving the page', () => {
  const row = /<p\b[^>]*class="also"[^>]*>([\s\S]*?)<\/p>/.exec(hub)[1];
  assert.match(row, /juga tersedia/, 'the row says what it is');
  assert.ok(row.includes('<a href="./unduh-berkas.html">Panduan format</a>'), 'the one format guide');
  assert.ok(row.includes('<a href="./dashboard.html">Dashboard</a>'), 'and the dashboard');
  assert.match(hubCss, /\.btn\.giant \{[^}]*font-size: 19px/, 'the giant door is styled larger than the rest');
  assert.match(hubCss, /\.hero-text h1 \{[^}]*text-align: left/, 'and the hero reads left like the reference, beside its visual');
});

test('every merged card offers the archive, and the install steps name the surface once', () => {

  const cards = [...berkas.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi']);
  const names = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi' };
  for (const [, key, body] of cards) {
    assert.ok(body.includes(`<h2>${names[key]}</h2>`), `${key} names itself`);
    assert.ok(body.includes('<span class="glyph"'), `${key} carries a text glyph, not an image asset`);
    assert.doesNotMatch(body, /<img/, `${key} loads no image`);

    assert.match(body, new RegExp(`<a\\b[^>]*class="btn"[^>]*href="${escapeRe(ZIP)}"[^>]*download[^>]*>Unduh \\.zip</a>`), `${key} offers the one archive`);
    assert.doesNotMatch(body, /<p class="req"/, `${key} stays one glance short of prose; the steps below carry the requirement`);
    assert.match(body, /<span\b[^>]*class="badge"[^>]*hidden[^>]*>Browser Anda<\/span>/, `${key} hides its badge until detected`);
  }

  const steps = /<ol class="steps">([\s\S]*?)<\/ol>/.exec(berkas)[1];
  assert.ok(steps.includes('<code>chrome://extensions</code>'), 'the install guide names the Chrome surface once');
  assert.match(steps, /mode pengembang/, 'the install guide states developer mode once');
});

test('the other builds row sits under the button, the way the benchmark download page does it', () => {

  assert.match(hubCss, /\.otherBuilds \{[^}]*display: flex/s, 'the other builds render as one inline row');
  assert.match(hubCss, /\.otherBuilds a \{[^}]*color: var\(--accent\)/s, 'as quiet accent links, not another button');
});

test('every merged card carries the signed file and manifest inline, as quiet links', () => {
  const cards = [...berkas.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi']);
  for (const [, key, body] of cards) {

    assert.match(body, new RegExp(`<a\\b[^>]*href="${escapeRe(CRX)}"[^>]*download`), `${key} offers the signed file inline`);
    assert.doesNotMatch(body, /class="btn"[^>]*crx/, `${key} gives the signed file no button weight`);
    assert.match(body, /update\.xml\?id=[a-p]{32}/, `${key} also offers the manifest the updater reads, pinned to this extension`);
    assert.doesNotMatch(body, /class="more"|moreWrap/, `${key} carries no disclosure widget; the other builds sit in plain sight`);

    assert.doesNotMatch(body, /mengizinkan pemasangan/, `${key} implies no consumer install`);
  }
});

test('the merged detection marks the matching card and phones nowhere', () => {
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(berkas)[1];
  assert.ok(script.includes('navigator.userAgentData?.brands'), 'reads brands first');
  assert.ok(script.includes('navigator.userAgent'), 'falls back to the UA string');
  assert.match(script, /classList\.add\('yours'\)/, 'highlights the match');
  assert.match(script, /badge\.hidden = false/, 'shows its badge');
  assert.doesNotMatch(script, /fetch\s*\(/, 'fetches nothing');
  assert.doesNotMatch(script, /XMLHttpRequest|sendBeacon|WebSocket/, 'reaches no other network either');
});

test('the merged script is named by a hash on both hosts', () => {

  const site = siteHeaders();
  const csp = site.headers.find((h) => h.source === '/unduh-berkas.html').headers
    .find((h) => h.key === 'Content-Security-Policy').value;
  const headers = read('_headers');
  const body = /<script type="module">([\s\S]*?)<\/script>/.exec(berkas)[1];
  const hash = "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
  assert.ok(csp.includes(hash), 'the site names the unduh-berkas.html script');
  for (const path of ['/unduh-berkas.html', '/unduh-berkas']) {
    const block = headers.split('\n\n').find((b) => b.startsWith(`${path}\n`));
    assert.ok(block && block.includes(hash), `_headers names it for ${path}`);
  }
});
