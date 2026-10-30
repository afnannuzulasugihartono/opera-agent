// @last-edited: 2026-10-26 UTC+7.
// @title: landing-visual — the site looks finished on every screen.
// @state: 20 locks; the page is read with the stylesheets it loads, so the header, nav, the pill on the marketing pages, the squared signed-in shell and the footer are judged as rendered.
// @dependencies: test, assert, fs.

// Company grade is decided in five seconds on a phone: a hero that shows the product, copy without a broken sentence, and nothing spilling out of its box.
// Military grade adds validity underneath it.
// Measured in Chromium screenshots: the hero was text-only with "Sembilan dua tool", the FAQ section opened inside the privacy section without closing it, the seven-item nav wrapped into two ragged lines at 390px, a code pill crossed its card border, and unduh broke code mid-word with word-break:break-all.
// A page is judged on the stylesheet it loads, so the nav, the current-item rule and the footer are read from the page's own links, landing/site.css and landing/download.css together with the page.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mcpSurfaceSourceSync } from './helpers/mcp-surface-source.mjs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const cssOf = (name) => {
  const html = read(name);
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+)"/g)].map((match) => match[1]);
  return `${html}\n${links.map((file) => read(file)).join('\n')}`;
};
const pages = [
  'beranda.html',
  'akun.html',
  'index.html',
  'dashboard.html',
  'unduh.html',
  'unduh-berkas.html',
  'privasi.html',
  'syarat.html',
  '404.html',
  'oauth/consent.html',
  'fitur.html',
  'dukungan.html'
];

test('the hero sells the product instead of apologizing for it', () => {
  const html = read('beranda.html');
  assert.doesNotMatch(html, /Sembilan dua/, 'the broken sentence is gone');
  assert.match(html, /35 tool/, 'the tool count is stated as a number');
  assert.match(html, /class="eyebrow"/, 'an eyebrow names the release above the headline');
  assert.match(html, /id="demo"/, 'a product visual answers what the words claim');
  assert.match(html, /id="heroStats"/, 'numbers sit under the call to action, not in prose');
});

test('the hero stats equal live source counts, never stale copy', () => {
  const html = read('beranda.html');
  const mcp = mcpSurfaceSourceSync();
  const tools = (mcp.match(/registerTool\("/g) || []).length;
  const proto = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  const specs = proto.slice(proto.indexOf('METHOD_SPECS = Object.freeze({'), proto.indexOf('});', proto.indexOf('METHOD_SPECS')));
  const prims = (specs.match(/^\s*'[a-z][a-z0-9_.]*': \{ timeoutMs:/gm) || []).length;
  assert.ok(tools > 30 && prims >= 28, `sanity: ${tools} tools, ${prims} primitives`);
  const block = /<dl class="heroStats" id="heroStats">([\s\S]*?)<\/dl>/.exec(html)[1];

  const stats = [...block.matchAll(/<div\b[^>]*><dt\b[^>]*>(\d+)<\/dt><dd\b[^>]*>([^<]+)<\/dd><\/div>/g)];
  const byLabel = Object.fromEntries(stats.map((m) => [
    m[2].trim(),
    Number(m[1])
  ]));
  assert.equal(byLabel['tool MCP'], tools, 'tool stat matches the registered count');
  assert.equal(byLabel['primitive browser'], prims, 'primitive stat matches the allowlist');
});

test('every section closes before the next one opens', () => {
  for (const page of pages) {
    const html = read(page);
    const opens = (html.match(/<section/g) || []).length;
    const closes = (html.match(/<\/section>/g) || []).length;
    assert.equal(opens, closes, `${page} balances its sections`);
  }
  const index = read('beranda.html');
  assert.match(index, /<\/section>\s*<section id="faq"[^>]*>/, 'the FAQ stands beside privacy, not inside it');
});

test('the nav survives a 390px phone without wrapping ragged', () => {
  for (const page of pages) {
    const css = cssOf(page);
    assert.match(css, /white-space:\s*nowrap/, `${page} keeps each nav item on one line`);
  }
  const index = cssOf('beranda.html');
  assert.match(index, /overflow-x:\s*auto/, 'the row scrolls instead of wrapping');
});

test('the header is never squeezed by a page that keeps a narrow column', () => {

  // WHY THE HEADER HAS ITS OWN WIDTH.
  // Measured live on 2026-10-26: index.html sets .wrap to 560px, and the header shares that wrap, so at a 912px window the last nav item ended at 936px and the document scrolled sideways by 24px.
  // The nav row measures 747px, and the wrap spends 40px of padding inside the viewport margin, so the row needs 835px; the old 800px rule counted only the margin and left 801-835 overflowing.
  // The header therefore keeps the widest content measure on the site, and the nav scrolls itself whenever even that is too tight.

  const index = cssOf('index.html');
  assert.match(index, /--wrap:\s*1200px/, 'the shell names a measure wide enough for the chrome and the page below it');
  assert.match(index, /header \.wrap\s*\{[^}]*max-width:\s*var\(--wrap\)/, 'the chrome keeps that measure, whatever the column below does');
  assert.match(index, /header nav\s*\{[^}]*overflow-x:\s*auto/, 'the row scrolls itself when the wrap is still too tight');
  assert.match(index, /@media \(max-width: 980px\)[\s\S]*?header nav a\.nav-sec \{ display: none; \}/,
    'and it sheds the secondary items before a laptop runs out of room');
  for (const page of pages) {
    assert.match(cssOf(page), /header \.wrap\s*\{[^}]*max-width:\s*var\(--wrap\)/, `${page} gives the shared header the same rule`);
  }
});

test('a code pill never crosses its card border or breaks mid-word', () => {
  for (const page of pages) {
    assert.doesNotMatch(read(page), /word-break:\s*break-all/, `${page} breaks at word bounds, not mid-token`);
  }
  assert.match(cssOf('beranda.html'), /box-decoration-break:\s*clone/, 'a wrapped pill keeps both halves boxed');
});

test('the marked nav item is visible, not metadata only', () => {
  for (const page of ['beranda.html', 'akun.html', 'dashboard.html', 'unduh.html', 'privasi.html', '404.html']) {
    assert.match(cssOf(page), /a\[aria-current="page"\]/, `${page} styles the current item`);
  }
});

test('the phone nav hints that it scrolls instead of clipping mid-word', () => {
  for (const page of pages) {
    const html = cssOf(page);
    assert.match(html, /mask-image:\s*linear-gradient\(to right/, `${page} fades the nav edge on a phone`);
  }
});

test('the hero carries exactly one filled action, and it is the download', () => {
  const hero = read('beranda.html').match(/<section class="hero[^"]*">[\s\S]*?<\/section>/)[0];

  const row = (id) => new RegExp(`<div class="row" id="${id}"[^>]*>([\\s\\S]*?)</div>`).exec(hero)[1];
  const filledIn = (id) => [...row(id).matchAll(/<a\b[^>]*class="btn primary"[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(filledIn('ctaOut'), ['./unduh.html'], 'a stranger is offered exactly one filled action, the download');
  assert.deepEqual(filledIn('ctaIn'), ['./dashboard.html'], 'a member is offered exactly one filled action, the dashboard');
});

test('the hero states each number once', () => {
  const hero = read('beranda.html').match(/<section class="hero[^"]*">[\s\S]*?<\/section>/)[0];
  const prose = hero
    .replace(/<dl class="heroStats"[\s\S]*?<\/dl>/, '')
    .replace(/<div class="demo"[\s\S]*?<\/div>\s*<\/div>/, '');
  assert.doesNotMatch(prose, /26 aksi/, 'no second 26 with another noun');
  assert.doesNotMatch(prose, /\d+\s+(tool|primitive|izin|aksi|permission)/i, 'the hero prose names no count at all');
  assert.match(hero, /tanpa eksekusi skrip sembarangan/, 'the prose keeps its promise');
});

test('no script renames a link that is not there', () => {
  assert.doesNotMatch(read('beranda.html'), /Akun ●/, 'the dead rename is gone');
});

test('the provider buttons show their marks, not bare text', () => {
  const html = read('index.html');
  assert.match(html, /id="googleButton"[^>]*>[\s\S]*?<svg/, 'Google carries its mark inside the button');
  assert.match(html, /id="githubButton"[^>]*>[\s\S]*?<svg/, 'GitHub carries its mark inside the button');
});

test('the 404 exits are real doors, counted honestly', () => {
  const html = read('404.html');
  const tiles = [...html.matchAll(/<a class="tile" href="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(tiles.length >= 4, 'the exits exist as links, not divs');
  const words = {
    4: 'Empat',
    5: 'Lima',
    6: 'Enam'
  };
  assert.match(html, new RegExp(`${words[tiles.length]} jalan keluar`), 'the copy counts what stands under it');
  assert.match(read('site.css'), /\.tile:hover/, 'a tile answers the hover, so it reads clickable');
});

test('the legal pages open with a map, not a wall', () => {
  for (const page of ['privasi.html', 'syarat.html']) {
    const html = read(page);
    const ids = [...html.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]);
    assert.ok(ids.length >= 4, `${page} names its sections`);
    for (const id of ids) {
      assert.ok(html.includes(`href="#${id}"`), `${page} links to #${id} from its map`);
    }
  }
});

test('home after sign-in is a console door, not the sales pitch again', () => {
  const html = read('beranda.html');
  assert.match(html, /id="heroEyebrow"/, 'the eyebrow is addressable');
  assert.match(html, /id="ctaOut"/, 'the acquisition actions have an element');
  assert.match(html, /id="ctaIn" hidden/, 'the member actions start hidden');
  assert.match(html, /id="quickTiles" hidden/, 'and so do the inward tiles');
  assert.match(html, /href="\.\/dashboard\.html#device"/, 'a tile reaches devices');
  assert.match(html, /href="\.\/dashboard\.html#pairing"/, 'a tile reaches pairing');
  assert.match(html, /classList\.add\('signed-in'\)/, 'the swap marks the body');
  assert.match(html, /localStorage\?\.\getItem\('opera-agent-access-token'\)/, 'decided by a stored session, never a request');
  assert.doesNotMatch(html, /Halo,|Selamat datang kembali/, 'and no greeting invents an identity');
});

test('display type sets the page apart from its own dashboard', () => {
  const css = cssOf('beranda.html');
  assert.match(css, /clamp\(44px, 6vw, 82px\)/, 'the headline spans display sizes');
  assert.match(css, /h2 \{[^}]*font-size: clamp\(28px, 3\.2vw, 44px\)/, 'sections step down to a clear second rank');
  assert.match(css, /\.section \{[^}]*padding: 104px 0/, 'and breathe around each idea');
});

test('buttons are pills on the marketing surfaces, and square on the signed-in shell', () => {
  for (const page of ['beranda.html', 'unduh.html', 'oauth/consent.html']) {
    const html = cssOf(page);
    assert.match(html, /\.btn \{[^}]*border-radius: 980px/, `${page} pills its buttons`);
  }
  for (const page of ['akun.html', 'dashboard.html']) {
    const html = cssOf(page);
    assert.match(html, /body\.app-dark \.btn \{[^}]*border-radius: var\(--radius-sm\)/, `${page} squares its buttons to the radius the benchmarks measure`);
  }
  const auth = cssOf('index.html');
  assert.match(auth, /--pill:\s*980px/, 'one pill token, not a radius per control');
  assert.match(auth, /\.provider \{[^}]*border-radius: var\(--pill\)/, 'provider entries match');
  assert.match(auth, /\.gateCard form button\[type="submit"\] \{[^}]*border-radius: var\(--pill\)/, 'and so does the submit');
});

test('the hero carries its footnote instead of hiding the catch', () => {
  const html = read('beranda.html');
  assert.match(html, /class="footnote"/, 'the line has an element');
  assert.match(html, /Model ditagih penyedia Anda/, 'stating the only money that moves');
});

test('motion is an enhancement, never the content', () => {
  const page = read('beranda.html');
  const css = cssOf('beranda.html');
  assert.match(page, /documentElement\.classList\.add\('js'\)/, 'JS announces itself before anything hides');
  assert.match(css, /html\.js \.reveal/, 'hiding requires that announcement');
  assert.match(css, /prefers-reduced-motion/, 'and the motion bows out when asked');
  assert.match(page, /IntersectionObserver/, 'one observer per page, not per pixel');

  assert.match(css, /@media print\s*{[^}]*\.reveal[^}]*opacity:\s*1/s,
    'print shows every section, or the motion has hidden the page from being read');
});

test('nothing spills out of a 320px screen', () => {
  for (const page of pages) {
    const html = cssOf(page);
    assert.match(html, /\.doors\s*{[^}]*flex-wrap:\s*wrap/s, `${page}: the footer row wraps`);
    assert.doesNotMatch(html, /footer a \{[^}]*margin-right/s, `${page}: no margin, which cannot wrap`);
  }
  const unduh = cssOf('unduh.html');
  assert.match(unduh, /pre\s*{[^}]*white-space:\s*pre-wrap/s,
    'the checksum command wraps inside its box instead of off the screen');
});
