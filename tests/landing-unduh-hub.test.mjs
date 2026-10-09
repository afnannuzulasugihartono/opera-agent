// @last-edited: 2026-10-09 UTC+7.
// @title: landing-unduh-hub — the Steam-style hub door, and the merged per-browser file cards.
// @state: 7 locks; the hub door navigates to the one merged page, whose cards each offer both files.
// @dependencies: test, assert, fs, crypto.

// The hub answers with one giant door and an also-available row, while the merged
// page answers "which one is mine" with one card per browser, each card offering
// both files side by side before the shared steps. The download URLs and the
// compatibility claims themselves are out of scope and stay pinned in
// landing-download.

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

test('the hub carries exactly one giant door opening the merged files page', () => {
  // WHY navigation and not a download: the reader picks the browser first, then the
  // file, so a door that downloaded the archive would skip the choice the merged
  // page exists to offer. Steam opens the game page; this opens the files page.
  const doors = [...hub.matchAll(/<a class="btn giant" href="([^"]+)">([^<]*)<\/a>/g)];
  assert.equal(doors.length, 1, 'exactly one giant door');
  assert.equal(doors[0][1], './unduh-berkas.html', 'the door opens the merged page');
  assert.equal(doors[0][2], 'Unduh Opera Agent', 'with the product name as its text');
  assert.doesNotMatch(hub, /class="btn giant"[^>]*download/, 'and it carries no download attribute');
  assert.doesNotMatch(hub, /<article class="browser"/, 'and no browser card competes with it');
});

test('the hub also-available row names the other doors without leaving the page', () => {
  // WHY this replaces the per-card dropdowns: five selects each naming the same
  // three doors was the old cross-link UI, and it left with the hub cards. One row
  // under the giant door now names every other door a reader could want.
  const rows = [...hub.matchAll(/<p class="also">([\s\S]*?)<\/p>/g)];
  assert.equal(rows.length, 1, 'exactly one also-available row');
  const [, row] = rows[0];
  assert.match(row, /juga tersedia/, 'the row says what it is');
  assert.ok(row.includes('<a href="./unduh-berkas.html">Panduan format</a>'), 'the one format guide');
  assert.ok(row.includes('<a href="./dashboard.html">Dashboard</a>'), 'and the dashboard');
  assert.doesNotMatch(hub, /<select data-nav>/, 'no card dropdown survives beside it');
});

test('the merged page carries one card per browser, each offering both files', () => {
  // WHY this moved off the two format pages: each page offered one file five times,
  // so every reader had to guess the right door before anything downloaded. One card
  // per browser now offers both files side by side, and each card downloads the file
  // its own page verifies.
  const zipButton = /class="btn" href="([^"]+)"/.exec(berkas)[1];
  assert.equal(ZIP, zipButton, 'the shared archive URL is the one the page verifies');
  const cards = [...berkas.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi'], 'unduh-berkas.html names every browser once');
  const names = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi' };
  for (const [, key, body] of cards) {
    assert.ok(body.includes(`<h3>${names[key]}</h3>`), `${key} names itself`);
    assert.ok(body.includes('<span class="glyph"'), `${key} carries a text glyph, not an image asset`);
    assert.doesNotMatch(body, /<img/, `${key} loads no image`);
    assert.ok(body.includes(`<a class="btn" href="${ZIP}" download>Unduh .zip</a>`), `${key} offers the archive`);
    assert.ok(body.includes(`<a class="btn" href="${CRX}" download>Unduh .crx</a>`), `${key} offers the signed file beside it`);
    assert.ok(body.includes('<span class="badge" hidden>Browser Anda</span>'), `${key} hides its badge until detected`);
  }
});

test('the merged detection marks the matching card and phones nowhere', () => {
  // WHY this moved off the hub and onto the one page: the highlight followed the
  // cards when they merged, and the hub keeps no script at all now. The privacy
  // promise moves with the code.
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(berkas)[1];
  assert.ok(script.includes('navigator.userAgentData?.brands'), 'reads brands first');
  assert.ok(script.includes('navigator.userAgent'), 'falls back to the UA string');
  assert.match(script, /classList\.add\('yours'\)/, 'highlights the match');
  assert.match(script, /badge\.hidden = false/, 'shows its badge');
  assert.doesNotMatch(script, /fetch\s*\(/, 'fetches nothing');
  assert.doesNotMatch(script, /XMLHttpRequest|sendBeacon|WebSocket/, 'reaches no other network either');
  assert.doesNotMatch(hub, /<script/, 'the hub itself runs no script');
});

test('the hero states the value in one sentence, and the steps live on the merged page', () => {
  assert.match(hub, /<h1>Pasang Opera Agent<\/h1>/, 'the hero keeps its title');
  assert.match(hub, /Gratis dan tanpa toko/, 'gratis and storeless in one sentence');
  assert.match(hub, /mesin enterprise/, 'enterprise named where the updates land');
  assert.doesNotMatch(hub.replace(/<!--[\s\S]*?-->/g, ''), /instan/i, 'no instant promise');
  assert.doesNotMatch(hub, /<ol class="steps">/, 'the hub itself keeps no steps beside the door');
  const steps = /<h2>Lima langkah memasang dari arsip<\/h2>\s*<ol class="steps">([\s\S]*?)<\/ol>/.exec(berkas)[1];
  assert.match(steps, /Ekstrak arsip/, 'first the extract');
  assert.match(steps, /mode pengembang/, 'then developer mode');
  assert.match(steps, /Load unpacked/, 'then the load');
});

test('the CRX section is framed enterprise-only, with the button untouched', () => {
  // WHY the negative pins: the page used to imply a consumer browser would accept
  // the file, which is the contradiction this reframe removes. The URL and the
  // version-carrying filename note stay exactly where they were.
  assert.match(berkas, /enterprise-managed/, 'policy installs are the audience');
  assert.match(berkas, /drag-and-drop/, 'manual installs are named as rejected');
  assert.match(berkas, /BLOCKED/, 'the unmanaged status is stated');
  assert.match(berkas, /pengguna rumahan pakai <a href="#berkas">arsip zip<\/a>/, 'home users are sent to the zip on this same page');
  assert.doesNotMatch(berkas, /mengizinkan pemasangan/, 'no sentence implies a consumer browser allows it');
  assert.ok(berkas.includes(`<a class="btn" href="${CRX}" download>Unduh berkas .crx terbaru</a>`), 'the button and its endpoint are unchanged');
  assert.match(berkas, /namanya membawa versi build/, 'the filename note stays');
});

test('the hub needs no script hash, and the shared policy still names the merged script', () => {
  // WHY this replaces the hub hash lock: the hub script left with the hub cards,
  // so there is no hub body to hash. The /(.*) policy is shared, so the merged
  // script stays named on both hosts exactly as before — additive, never removed.
  assert.doesNotMatch(hub, /<script type="module">/, 'the hub carries no inline module to name');
  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers.find((h) => h.source === '/(.*)').headers
    .find((h) => h.key === 'Content-Security-Policy').value;
  const headers = read('_headers');
  const body = /<script type="module">([\s\S]*?)<\/script>/.exec(berkas)[1];
  const hash = "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
  assert.ok(csp.includes(hash), 'vercel still names the unduh-berkas.html script');
  for (const path of ['/unduh-berkas.html', '/unduh-berkas']) {
    const block = headers.split('\n\n').find((b) => b.startsWith(`${path}\n`));
    assert.ok(block && block.includes(hash), `_headers still names it for ${path}`);
  }
});
