// @last-edited: 2026-10-09 UTC+7.
// @title: landing-unduh-hub — the VS-Code-style download hub and the honest enterprise CRX page.
// @state: 6 locks, all additive; the matrix values and the endpoint URLs stay pinned where they were.
// @dependencies: test, assert, fs, crypto.

// The hub answers "which one is mine" with one card per browser before any prose,
// and the CRX page says plainly that manual installs are rejected on unmanaged
// machines. The compatibility claims themselves are out of scope and stay pinned
// in landing-download.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const hub = read('unduh.html');
const crx = read('unduh-crx.html');

const ZIP = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip';
const CRX = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.crx';

test('the hub carries one card per browser, all offering the same archive', () => {
  // WHY the URL is cross-checked and not just repeated: the brief demands one file
  // for every card, and a card drifting to another path would offer a build the
  // verification steps on the zip page cannot vouch for.
  const zipButton = /class="btn" href="([^"]+)"/.exec(read('unduh-zip.html'))[1];
  assert.equal(ZIP, zipButton, 'the shared URL is the one the zip page verifies');
  const cards = [...hub.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi']);
  const names = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi' };
  for (const [, key, body] of cards) {
    assert.ok(body.includes(`<h3>${names[key]}</h3>`), `${key} names itself`);
    assert.ok(body.includes('<span class="glyph"'), `${key} carries a text glyph, not an image asset`);
    assert.doesNotMatch(body, /<img/, `${key} loads no image`);
    assert.ok(body.includes(`<a class="btn" href="${ZIP}" download>Unduh .zip</a>`), `${key} offers the one archive`);
    assert.ok(body.includes('Butuh mode developer + Load unpacked'), `${key} states the requirement`);
    assert.ok(body.includes('<span class="badge" hidden>Browser Anda</span>'), `${key} hides its badge until detected`);
  }
});

test('every card lists the same other downloads', () => {
  const selects = [...hub.matchAll(/<select data-nav>([\s\S]*?)<\/select>/g)];
  assert.equal(selects.length, 5, 'one select per card');
  for (const [, body] of selects) {
    assert.ok(body.includes(`<option value="${ZIP}">Arsip .zip</option>`), 'the same archive again');
    assert.ok(body.includes('<option value="./unduh-crx.html">Panduan CRX enterprise</option>'), 'the enterprise CRX guide');
    assert.ok(body.includes('<option value="./unduh-zip.html">Panduan zip</option>'), 'and the zip guide');
  }
});

test('the detection marks the matching card and phones nowhere', () => {
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(hub)[1];
  assert.ok(script.includes('navigator.userAgentData?.brands'), 'brands are read first');
  assert.ok(script.includes('navigator.userAgent'), 'the UA string is the fallback');
  assert.match(script, /classList\.add\('yours'\)/, 'the match is highlighted');
  assert.match(script, /badge\.hidden = false/, 'and its badge is shown');
  assert.doesNotMatch(script, /fetch\s*\(/, 'no fetch');
  assert.doesNotMatch(script, /XMLHttpRequest|sendBeacon|WebSocket/, 'no other network either');
});

test('the hero states the value in one sentence, and three steps follow the cards', () => {
  assert.match(hub, /<h1>Pasang Opera Agent<\/h1>/, 'the hero keeps its title');
  assert.match(hub, /Gratis dan tanpa toko/, 'gratis and storeless in one sentence');
  assert.match(hub, /mesin enterprise/, 'enterprise named where the updates land');
  assert.doesNotMatch(hub.replace(/<!--[\s\S]*?-->/g, ''), /instan/i, 'no instant promise');
  const steps = /<h2>Tiga langkah memasang<\/h2>\s*<ol class="steps">([\s\S]*?)<\/ol>/.exec(hub)[1];
  assert.match(steps, /Ekstrak zip/, 'first the extract');
  assert.match(steps, /mode developer/, 'then developer mode');
  assert.match(steps, /Load unpacked/, 'then the load');
});

test('the CRX page is framed enterprise-only, with the button untouched', () => {
  // WHY the negative pins: the page used to imply a consumer browser would accept
  // the file, which is the contradiction this reframe removes. The URL and the
  // version-carrying filename note stay exactly where they were.
  assert.match(crx, /enterprise-managed/, 'policy installs are the audience');
  assert.match(crx, /drag-and-drop/, 'manual installs are named as rejected');
  assert.match(crx, /BLOCKED/, 'the unmanaged status is stated');
  assert.match(crx, /pengguna rumahan pakai <a href="\.\/unduh\.html">arsip zip<\/a>/, 'home users are sent to the zip');
  assert.doesNotMatch(crx, /mengizinkan pemasangan/, 'no sentence implies a consumer browser allows it');
  assert.ok(crx.includes(`<a class="btn" href="${CRX}" download>Unduh berkas .crx terbaru</a>`), 'the button and its endpoint are unchanged');
  assert.match(crx, /namanya membawa versi build/, 'the filename note stays');
});

test('the hub script is named by a hash on both hosts', () => {
  // WHY this mirrors the hosting lock additively: the /(.*) policy is shared, so
  // a hub script without a hash would go silent in the browser while every other
  // page stayed green.
  const body = /<script type="module">([\s\S]*?)<\/script>/.exec(hub)[1];
  const hash = "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers.find((h) => h.source === '/(.*)').headers
    .find((h) => h.key === 'Content-Security-Policy').value;
  assert.ok(csp.includes(hash), 'vercel names the hub script');
  const headers = read('_headers');
  for (const path of ['/unduh.html', '/unduh']) {
    const block = headers.split('\n\n').find((b) => b.startsWith(`${path}\n`));
    assert.ok(block && block.includes(hash), `_headers names it for ${path}`);
  }
});
