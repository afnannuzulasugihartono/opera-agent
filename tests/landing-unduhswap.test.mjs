// @last-edited: 2026-10-09 UTC+7.
// @title: landing-unduhswap — the Steam-style hub door and the merged per-browser file cards.
// @state: 6 locks; the card/detection/hash pins live on the merged page, the hub keeps only the door pins.
// @dependencies: test, assert, fs, crypto.

// The hub opens with one giant door and an also-available row, while the merged
// page answers "which one is mine" with one card per browser, each card offering
// both files before the shared steps. The download URLs and the compatibility
// facts are out of scope and stay pinned in landing-download and landing-unduh-hub.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const hub = read('unduh.html');
const berkas = read('unduh-berkas.html');

const ZIP = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip';
const CRX = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.crx';

test('the hub opens with one giant door to the merged files page', () => {
  // WHY the URL is cross-checked and not just repeated: the verification steps on the
  // merged page vouch for one archive URL, and a card drifting to another path would
  // offer a build those steps cannot verify.
  const curl = /curl\.exe -sI (\S+) \|/.exec(berkas)[1];
  assert.equal(ZIP, curl, 'the verification command reads the URL the cards offer');
  assert.ok(hub.includes('<a class="btn giant" href="./unduh-berkas.html">Unduh Opera Agent</a>'),
    'one giant button to the merged page, product name as its text');
  assert.doesNotMatch(hub, /class="btn giant"[^>]*download/, 'navigation, not a download');
});

test('the also-available row names the other doors without leaving the page', () => {
  const row = /<p class="also">([\s\S]*?)<\/p>/.exec(hub)[1];
  assert.match(row, /juga tersedia/, 'the row says what it is');
  assert.ok(row.includes('<a href="./unduh-berkas.html">Panduan format</a>'), 'the one format guide');
  assert.ok(row.includes('<a href="./dashboard.html">Dashboard</a>'), 'and the dashboard');
  assert.match(hub, /\.btn\.giant \{[^}]*font-size: 19px/, 'the giant door is styled larger than the rest');
  assert.match(hub, /\.hero-text h1 \{[^}]*text-align: left/, 'and the hero reads left like the reference, beside its visual');
});

test('every merged card names its own extensions surface and the archive requirement', () => {
  // WHY the URL is cross-checked per card: five cards offering five different archives
  // would break the one-build promise the verification steps keep.
  const cards = [...berkas.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi']);
  const names = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi' };
  const surfaces = { chrome: 'chrome://extensions', edge: 'edge://extensions', brave: 'brave://extensions', opera: 'opera://extensions', vivaldi: 'opera://extensions' };
  for (const [, key, body] of cards) {
    assert.ok(body.includes(`<h3>${names[key]}</h3>`), `${key} names itself`);
    assert.ok(body.includes('<span class="glyph"'), `${key} carries a text glyph, not an image asset`);
    assert.doesNotMatch(body, /<img/, `${key} loads no image`);
    assert.ok(body.includes(`<a class="btn" href="${ZIP}" download>Unduh .zip</a>`), `${key} offers the one archive`);
    assert.ok(body.includes(`<code>${surfaces[key]}</code>`), `${key} names its own extensions surface`);
    assert.match(body, /mode developer/, `${key} states the requirement`);
    assert.ok(body.includes('<span class="badge" hidden>Browser Anda</span>'), `${key} hides its badge until detected`);
  }
});

test('every merged card keeps the enterprise frame on its signed file', () => {
  const cards = [...berkas.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi']);
  for (const [, key, body] of cards) {
    assert.ok(body.includes(`<a class="btn" href="${CRX}" download>Unduh .crx</a>`), `${key} offers the signed file`);
    assert.match(body, /enterprise-managed/, `${key} keeps the policy audience`);
    assert.match(body, /Drag-and-drop manual ditolak/, `${key} keeps the manual rejection`);
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
  // WHY this mirrors the hub hash lock additively: the /(.*) policy is shared, so
  // a script without a hash would go silent in the browser while every other
  // page stayed green.
  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers.find((h) => h.source === '/(.*)').headers
    .find((h) => h.key === 'Content-Security-Policy').value;
  const headers = read('_headers');
  const body = /<script type="module">([\s\S]*?)<\/script>/.exec(berkas)[1];
  const hash = "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
  assert.ok(csp.includes(hash), 'vercel names the unduh-berkas.html script');
  for (const path of ['/unduh-berkas.html', '/unduh-berkas']) {
    const block = headers.split('\n\n').find((b) => b.startsWith(`${path}\n`));
    assert.ok(block && block.includes(hash), `_headers names it for ${path}`);
  }
});
