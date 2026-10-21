// @last-edited: 2026-10-10 UTC+7.
// @title: landing-unduh-hub — the Steam-style hub door, and the merged per-browser file cards.
// @state: 7 locks; the hub door navigates to the one merged page, whose cards fill one button and close the rest.
// @dependencies: test, assert, fs, crypto.

// The hub answers with one giant door and an also-available row, while the merged
// page answers "which one is mine" with one card per browser. Each card fills the
// archive button and closes its other two behind a details, the shape
// code.visualstudio.com/download uses, before the shared steps. The download URLs
// and the compatibility claims themselves are out of scope and stay pinned in
// landing-download.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { mcpSurfaceSourceSync } from './helpers/mcp-surface-source.mjs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const hub = read('unduh.html');
const berkas = read('unduh-berkas.html');

const ZIP = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip';
const CRX = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.crx';

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the hub carries exactly one giant door opening the merged files page', () => {

  const doors = [...hub.matchAll(/<a\b[^>]*class="btn giant"[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)];
  assert.equal(doors.length, 1, 'exactly one giant door');
  assert.equal(doors[0][1], './unduh-berkas.html', 'the door opens the merged page');
  assert.equal(doors[0][2], 'Unduh Opera Agent', 'with the product name as its text');
  assert.doesNotMatch(hub, /class="btn giant"[^>]*download/, 'and it carries no download attribute');
  assert.doesNotMatch(hub, /<article class="browser"/, 'and no browser card competes with it');
});

test('the hub also-available row names the other doors without leaving the page', () => {

  const rows = [...hub.matchAll(/<p\b[^>]*class="also"[^>]*>([\s\S]*?)<\/p>/g)];
  assert.equal(rows.length, 1, 'exactly one also-available row');
  const [, row] = rows[0];
  assert.match(row, /juga tersedia/, 'the row says what it is');
  assert.ok(row.includes('<a href="./unduh-berkas.html">Panduan format</a>'), 'the one format guide');
  assert.ok(row.includes('<a href="./dashboard.html">Dashboard</a>'), 'and the dashboard');
  assert.doesNotMatch(hub, /<select data-nav>/, 'no card dropdown survives beside it');
});

test('the merged page carries one card per browser, each offering both files', () => {

  const zipButton = /class="btn" href="([^"]+)"/.exec(berkas)[1];
  assert.equal(ZIP, zipButton, 'the shared archive URL is the one the page verifies');
  const cards = [...berkas.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi'], 'unduh-berkas.html names every browser once');
  const names = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi' };
  for (const [, key, body] of cards) {
    assert.ok(body.includes(`<h3>${names[key]}</h3>`), `${key} names itself`);
    assert.ok(body.includes('<span class="glyph"'), `${key} carries a text glyph, not an image asset`);
    assert.doesNotMatch(body, /<img/, `${key} loads no image`);

    assert.match(body, new RegExp(`<a\\b[^>]*class="btn"[^>]*href="${escapeRe(ZIP)}"[^>]*download[^>]*>Unduh \\.zip</a>`), `${key} offers the archive`);
    assert.match(body, /<span\b[^>]*class="badge"[^>]*hidden[^>]*>Browser Anda<\/span>/, `${key} hides its badge until detected`);

    const filled = [...body.matchAll(/<a\b[^>]*class="btn"[^>]*>/g)];
    assert.equal(filled.length, 1, `${key} fills exactly one button`);
    assert.ok(filled[0][0].includes(ZIP), `${key} fills the archive, the file that installs everywhere`);
    assert.match(body, /<details class="more">/, `${key} keeps its other downloads behind a closed list`);
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

  assert.doesNotMatch(hub, /<script(?![^>]*src=)(?![^>]*type="application\/json")/, 'the hub itself runs no inline script');
  assert.ok(hub.includes('<script src="./i18n.js"></script>'), 'the hub loads the shared language file');
});

test('the hero states the value in one sentence, and the steps live on the merged page', () => {
  assert.match(hub, /<h1\b[^>]*>Pasang Opera Agent<\/h1>/, 'the hero keeps its title');
  assert.match(hub, /Gratis dan tanpa toko/, 'gratis and storeless in one sentence');
  assert.match(hub, /mesin enterprise/, 'enterprise named where the updates land');
  assert.doesNotMatch(hub.replace(/<!--[\s\S]*?-->/g, ''), /instan/i, 'no instant promise');
  assert.doesNotMatch(hub, /<ol class="steps">/, 'the hub itself keeps no steps beside the door');
  const steps = /<h2\b[^>]*>Lima langkah memasang dari arsip<\/h2>\s*<ol class="steps">([\s\S]*?)<\/ol>/.exec(berkas)[1];
  assert.match(steps, /Ekstrak arsip/, 'first the extract');
  assert.match(steps, /mode pengembang/, 'then developer mode');
  assert.match(steps, /Load unpacked/, 'then the load');
});

test('the CRX section is framed enterprise-only, with the button untouched', () => {

  assert.match(berkas, /enterprise-managed/, 'policy installs are the audience');
  assert.match(berkas, /drag-and-drop/, 'manual installs are named as rejected');
  assert.match(berkas, /BLOCKED/, 'the unmanaged status is stated');
  assert.match(berkas, /pengguna rumahan pakai <a href="#berkas">arsip zip<\/a>/, 'home users are sent to the zip on this same page');
  assert.doesNotMatch(berkas, /mengizinkan pemasangan/, 'no sentence implies a consumer browser allows it');
  assert.match(berkas, new RegExp(`<a\\b[^>]*class="btn"[^>]*href="${escapeRe(CRX)}"[^>]*download[^>]*>Unduh berkas \\.crx terbaru</a>`), 'the button and its endpoint are unchanged');
  assert.match(berkas, /namanya membawa versi build/, 'the filename note stays');
});

test('the hub needs no script hash, and the shared policy still names the merged script', () => {

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

test('the hub stats show live source counts, never stale copy', () => {

  const mcp = mcpSurfaceSourceSync();
  const tools = (mcp.match(/registerTool\("/g) || []).length;
  const proto = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  const specs = proto.slice(proto.indexOf('METHOD_SPECS = Object.freeze({'), proto.indexOf('});', proto.indexOf('METHOD_SPECS')));
  const prims = (specs.match(/^\s*'[a-z][a-z0-9_.]*': \{ timeoutMs:/gm) || []).length;
  assert.ok(tools > 30 && prims >= 28, `sanity: ${tools} tools, ${prims} primitives`);
  const stats = [...hub.matchAll(/<span class="stat-num">(\d+)<\/span>/g)].map((m) => Number(m[1]));
  assert.deepEqual(stats, [tools, prims], 'hub stats equal live source counts in order');
});
