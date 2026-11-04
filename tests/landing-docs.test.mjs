// @last-edited: 2026-11-04 UTC+7.
// @title: landing-docs — the docs page says what the product does, and the code proves every number on it.
// @state: six sections, one map, and counts read from the source rather than typed.
// @dependencies: node:test, node:assert, node:fs, mcp surface, extension protocol.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mcpSurfaceSourceSync } from './helpers/mcp-surface-source.mjs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

test('the docs page carries six sections and one map', () => {
  const html = read('landing/docs.html');
  for (const id of ['pasang', 'pairing', 'tugas', 'saldo', 'mcp', 'batas']) {
    assert.match(html, new RegExp(`<h2 id="${id}"`), `${id} has a section`);
    assert.ok(html.includes(`href="#${id}"`), `${id} is reachable from the map`);
  }
  assert.match(html, /<ul class="toc"/, 'the map is a list');
});

test('the docs page states the counts the code proves', () => {
  const html = read('landing/docs.html');
  const mcp = mcpSurfaceSourceSync();
  const tools = (mcp.match(/registerTool\("/g) || []).length;
  assert.match(html, new RegExp(`\\b${tools} tool`), `the page states ${tools} tools`);

  const protocol = read('extension/lib/protocol.js');
  const specs = /METHOD_SPECS\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(protocol)?.[1] ?? '';
  const primitives = [...specs.matchAll(/^\s{2}'([a-z_]+\.[a-z_]+)':/gm)].length;
  assert.match(html, new RegExp(`\\b${primitives} primitive`), `the page states ${primitives} primitives`);

  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.permissions.length, 6);
  assert.match(html, /enam izin/i, 'the page states six permissions');
});

test('the docs page leaves the money to the price page, and the code proves that page', () => {
  const html = read('landing/docs.html');
  const price = read('landing/harga.html');
  const wallet = read('supabase/functions/_shared/wallet.js');
  assert.ok(html.includes('href="/harga"'), 'the docs page points at the price page');
  for (const money of [/Rp10\.000/, /10 aksi/, /30 menit/, /dikembalikan penuh/]) {
    assert.doesNotMatch(html, money, 'the docs page repeats no money fact');
  }
  assert.match(wallet, /ACTION_CAP = 10/, 'the code caps a job at ten actions');
  assert.match(price, /10 aksi/, 'and the price page says so');
  assert.match(wallet, /HOLD_MS = 30 \* 60 \* 1000/, 'the hold lasts thirty minutes');
  assert.match(price, /30 menit/, 'and the price page says so');
  assert.match(price, /dikembalikan penuh/, 'a failed job is refunded in full, on the price page');
});

test('the price page shows its ways to buy as cards and its facts in one glance', () => {
  // WHY THE CARDS: measured against firecrawl.dev/pricing on 2026-11-04, the reader sees the choices as cards and the rules as a single glance list.
  // A reader who only skims still learns how to buy, and a reader who wants the rules finds every number in one list.
  const html = read('landing/harga.html');
  assert.ok((html.match(/class="priceCard"/g) || []).length >= 3, 'the ways to buy stand as cards');
  assert.match(html, /class="glance"/, 'the facts stand in one glance list');
  assert.match(html, /<dl class="glance"/, 'and the glance list is a definition list');
  const sheet = read('landing/harga.css');
  assert.match(sheet, /\.priceCards \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/s, 'three cards on a wide screen');
  assert.match(sheet, /@media \(max-width: 860px\)[\s\S]*?\.priceCards \{[^}]*grid-template-columns: 1fr/s, 'and one column on a phone');
});

test('the docs page reads like a manual: a sidebar, a search box, and the text', () => {
  // WHY THE SIDEBAR: measured against docs.firecrawl.dev on 2026-11-04, the guide stands in a left column of sections beside the text, and a search box answers a question without scrolling.
  const html = read('landing/docs.html');
  assert.match(html, /<nav class="docNav"/, 'the guide has a section column');
  assert.match(html, /class="docSearch"/, 'and a search box');
  assert.match(html, /src="\/docs\.js"/, 'and the search runs from a shared file, not inline');
  const sheet = read('landing/docs.css');
  assert.match(sheet, /\.docNav \{[^}]*position: sticky/s, 'the column stays while the text scrolls');
});

test('the footer maps the site in columns, not in one long row', () => {
  for (const page of ['beranda.html', 'fitur.html', 'harga.html', 'docs.html', 'unduh.html', 'dukungan.html', 'privasi.html', 'syarat.html', '404.html', 'index.html', 'unduh-berkas.html']) {
    const html = read(`landing/${page}`);
    assert.match(html, /<footer>[\s\S]*?class="[^"]*\bfootGrid\b/, `${page} carries the column footer`);
    assert.ok((html.match(/class="footCol"/g) || []).length >= 3, `${page} groups its doors into columns`);
  }
  const css = read('landing/site.css');
  assert.match(css, /\.footGrid \{[^}]*display: grid/s, 'the footer is a grid');
  assert.match(css, /\.footGrid \{[^}]*grid-template-columns: repeat\(\d+, minmax\(0, 1fr\)\)/s, 'with columns that share the width');
});

test('the guide keeps its code inside the phone screen', () => {
  // WHY THIS LOCK: measured at 390px on 2026-11-04, the guide's grid track took its width from the longest JSON line and the page scrolled 1237px sideways.
  // A track of minmax(0, 1fr) cannot grow past the screen, so the code block scrolls inside its own box.
  const sheet = read('landing/docs.css');
  assert.match(sheet, /@media \(max-width: 900px\)[\s\S]*?\.docLayout \{[^}]*grid-template-columns: minmax\(0, 1fr\)/s, 'the phone track cannot grow past the screen');
  assert.match(read('landing/site.css'), /pre \{[^}]*overflow-x: auto/s, 'and a long line scrolls inside its own box');
});

test('the ambient motion breathes slowly, and bows out when the reader asks', () => {
  // WHY THE AMBIENT LOOP: firecrawl.dev breathes with slow loops on 2026-11-04, and a site that only answers a hover feels dead on arrival.
  // The loop is slow enough to read as light rather than movement, and reduced motion stops it dead.
  const css = read('landing/beranda.css');
  assert.match(css, /@keyframes spin-slow/, 'the hero carries a slow spin');
  assert.match(css, /animation: spin-slow 32s linear infinite/, 'and it turns once every half minute');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/s, 'and it stops when the reader asks');
});

test('the docs page links to the doors a reader needs', () => {
  const html = read('landing/docs.html');
  for (const href of ['./unduh.html', './dashboard.html', '/harga', './dukungan.html']) {
    assert.ok(html.includes(`href="${href}"`), `the page reaches ${href}`);
  }
});
