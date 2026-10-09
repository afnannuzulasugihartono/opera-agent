// @last-edited: 2026-10-09 UTC+7.
// @title: landing-unduhswap — the Steam-style hub door and the per-browser format cards.
// @state: 6 locks, all additive; the hub cards and every compatibility claim stay pinned where they were.
// @dependencies: test, assert, fs, crypto.

// The hub opens with one giant door and an also-available row, while each format
// page answers "which one is mine" with one card per browser before its own steps.
// The download URLs and the compatibility facts are out of scope and stay pinned
// in landing-download and landing-unduh-hub.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const hub = read('unduh.html');
const zip = read('unduh-zip.html');
const crx = read('unduh-crx.html');

const ZIP = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip';
const CRX = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.crx';

test('the hub opens with one giant door offering the verified archive', () => {
  // WHY the URL is cross-checked and not just repeated: the brief demands the giant
  // button reuse the existing zip URL, and a door drifting to another path would offer
  // a build the verification steps on the zip page cannot vouch for.
  const zipButton = /class="btn" href="([^"]+)"/.exec(zip)[1];
  assert.equal(ZIP, zipButton, 'the shared URL is the one the zip page verifies');
  assert.ok(hub.includes(`<a class="btn giant" href="${ZIP}" download>Unduh Opera Agent</a>`),
    'one giant button, same archive, product name as its text');
});

test('the also-available row names the other doors without leaving the page', () => {
  const row = /<p class="also">([\s\S]*?)<\/p>/.exec(hub)[1];
  assert.match(row, /juga tersedia/, 'the row says what it is');
  assert.ok(row.includes('<a href="./unduh-crx.html">Panduan CRX enterprise</a>'), 'the enterprise CRX guide');
  assert.ok(row.includes('<a href="./unduh-zip.html">Panduan arsip</a>'), 'the archive guide');
  assert.ok(row.includes('<a href="./dashboard.html">Dashboard</a>'), 'and the dashboard');
  assert.match(hub, /\.btn\.giant \{[^}]*font-size: 19px/, 'the giant door is styled larger than the rest');
  assert.match(hub, /h1 \{ text-align: center/, 'and the hero is centered');
});

test('the zip page carries one card per browser, each naming its own extensions surface', () => {
  // WHY the URL is cross-checked per card: five cards offering five different archives
  // would break the one-build promise the hub and the verification steps both keep.
  const cards = [...zip.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
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

test('the CRX page carries one card per browser without softening the enterprise frame', () => {
  const cards = [...crx.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi']);
  const surfaces = { chrome: 'chrome://extensions', edge: 'edge://extensions', brave: 'brave://extensions', opera: 'opera://extensions', vivaldi: 'opera://extensions' };
  for (const [, key, body] of cards) {
    assert.ok(body.includes(`<a class="btn" href="${CRX}" download>Unduh .crx</a>`), `${key} offers the signed file`);
    assert.ok(body.includes(`<code>${surfaces[key]}</code>`), `${key} names its own extensions surface`);
    assert.match(body, /enterprise-managed/, `${key} keeps the policy audience`);
    assert.match(body, /Drag-and-drop ditolak/, `${key} keeps the manual rejection`);
    assert.doesNotMatch(body, /mengizinkan pemasangan/, `${key} implies no consumer install`);
    assert.ok(body.includes('<span class="badge" hidden>Browser Anda</span>'), `${key} hides its badge until detected`);
  }
});

test('both format detections mark the matching card and phone nowhere', () => {
  for (const [page, html] of [['unduh-zip.html', zip], ['unduh-crx.html', crx]]) {
    const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
    assert.ok(script.includes('navigator.userAgentData?.brands'), `${page} reads brands first`);
    assert.ok(script.includes('navigator.userAgent'), `${page} falls back to the UA string`);
    assert.match(script, /classList\.add\('yours'\)/, `${page} highlights the match`);
    assert.match(script, /badge\.hidden = false/, `${page} shows its badge`);
    assert.doesNotMatch(script, /fetch\s*\(/, `${page} fetches nothing`);
    assert.doesNotMatch(script, /XMLHttpRequest|sendBeacon|WebSocket/, `${page} reaches no other network either`);
  }
});

test('both format scripts are named by a hash on both hosts', () => {
  // WHY this mirrors the hub hash lock additively: the /(.*) policy is shared, so
  // a format script without a hash would go silent in the browser while every other
  // page stayed green.
  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers.find((h) => h.source === '/(.*)').headers
    .find((h) => h.key === 'Content-Security-Policy').value;
  const headers = read('_headers');
  for (const [page, html, paths] of [
    ['unduh-zip.html', zip, ['/unduh-zip.html', '/unduh-zip']],
    ['unduh-crx.html', crx, ['/unduh-crx.html', '/unduh-crx']]
  ]) {
    const body = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
    const hash = "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
    assert.ok(csp.includes(hash), `vercel names the ${page} script`);
    for (const path of paths) {
      const block = headers.split('\n\n').find((b) => b.startsWith(`${path}\n`));
      assert.ok(block && block.includes(hash), `_headers names it for ${path}`);
    }
  }
});
