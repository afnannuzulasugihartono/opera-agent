// @last-edited: 2026-10-09 UTC+7.
// @title: landing-unduh-hub — the Steam-style hub door, and the honest enterprise CRX page.
// @state: 7 locks; the card/detection/hash pins moved to the format pages, the hero/steps/CRX-frame pins unchanged.
// @dependencies: test, assert, fs, crypto.

// The hub answers with one giant door and an also-available row, while each format
// page answers "which one is mine" with one card per browser before its own steps.
// The per-card download and detection pins moved here from the hub to the format
// pages when the hub cards were removed; the compatibility claims themselves are
// out of scope and stay pinned in landing-download.

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

test('the hub carries exactly one giant download door linking the verified archive', () => {
  // WHY the URL is cross-checked and not just repeated: the hub demands one door
  // for every reader, and a door drifting to another path would offer a build the
  // verification steps on the zip page cannot vouch for.
  const zipButton = /class="btn" href="([^"]+)"/.exec(zip)[1];
  assert.equal(ZIP, zipButton, 'the shared URL is the one the zip page verifies');
  const doors = [...hub.matchAll(/<a class="btn giant" href="([^"]+)" download>([^<]*)<\/a>/g)];
  assert.equal(doors.length, 1, 'exactly one giant door');
  assert.equal(doors[0][1], ZIP, 'the door offers the one archive');
  assert.equal(doors[0][2], 'Unduh Opera Agent', 'with the product name as its text');
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
  assert.ok(row.includes('<a href="./unduh-crx.html">Panduan CRX enterprise</a>'), 'the enterprise CRX guide');
  assert.ok(row.includes('<a href="./unduh-zip.html">Panduan arsip</a>'), 'the archive guide');
  assert.ok(row.includes('<a href="./dashboard.html">Dashboard</a>'), 'and the dashboard');
  assert.doesNotMatch(hub, /<select data-nav>/, 'no card dropdown survives beside it');
});

test('each format page carries one card per browser, each downloading its own file', () => {
  // WHY this moved off the hub: the hub cards offered the zip five times, and the
  // CRX five times nowhere. Each format page now carries its own grid, so every
  // card downloads the file its page verifies.
  const zipButton = /class="btn" href="([^"]+)"/.exec(zip)[1];
  assert.equal(ZIP, zipButton, 'the shared archive URL is the one the zip page verifies');
  for (const [page, html, url, label] of [['unduh-zip.html', zip, ZIP, 'Unduh .zip'], ['unduh-crx.html', crx, CRX, 'Unduh .crx']]) {
    const cards = [...html.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
    assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi'], `${page} names every browser once`);
    const names = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi' };
    for (const [, key, body] of cards) {
      assert.ok(body.includes(`<h3>${names[key]}</h3>`), `${page} ${key} names itself`);
      assert.ok(body.includes('<span class="glyph"'), `${page} ${key} carries a text glyph, not an image asset`);
      assert.doesNotMatch(body, /<img/, `${page} ${key} loads no image`);
      assert.ok(body.includes(`<a class="btn" href="${url}" download>${label}</a>`), `${page} ${key} offers its own file`);
      assert.ok(body.includes('<span class="badge" hidden>Browser Anda</span>'), `${page} ${key} hides its badge until detected`);
    }
  }
});

test('both format detections mark the matching card and phone nowhere', () => {
  // WHY this moved off the hub: the highlight followed the cards to the format
  // pages, and the hub keeps no script at all now. The privacy promise moves with
  // the code, so each format page is pinned separately.
  for (const [page, html] of [['unduh-zip.html', zip], ['unduh-crx.html', crx]]) {
    const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
    assert.ok(script.includes('navigator.userAgentData?.brands'), `${page} reads brands first`);
    assert.ok(script.includes('navigator.userAgent'), `${page} falls back to the UA string`);
    assert.match(script, /classList\.add\('yours'\)/, `${page} highlights the match`);
    assert.match(script, /badge\.hidden = false/, `${page} shows its badge`);
    assert.doesNotMatch(script, /fetch\s*\(/, `${page} fetches nothing`);
    assert.doesNotMatch(script, /XMLHttpRequest|sendBeacon|WebSocket/, `${page} reaches no other network either`);
  }
  assert.doesNotMatch(hub, /<script/, 'the hub itself runs no script');
});

test('the hero states the value in one sentence, and three steps follow the door', () => {
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

test('the hub needs no script hash, and the shared policy still names the format scripts', () => {
  // WHY this replaces the hub hash lock: the hub script left with the hub cards,
  // so there is no hub body to hash. The /(.*) policy is shared, so the format
  // scripts stay named on both hosts exactly as before — additive, never removed.
  assert.doesNotMatch(hub, /<script type="module">/, 'the hub carries no inline module to name');
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
    assert.ok(csp.includes(hash), `vercel still names the ${page} script`);
    for (const path of paths) {
      const block = headers.split('\n\n').find((b) => b.startsWith(`${path}\n`));
      assert.ok(block && block.includes(hash), `_headers still names it for ${path}`);
    }
  }
});
