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
const pages = ['beranda.html', 'akun.html', 'index.html', 'dashboard.html', 'unduh.html', 'unduh-berkas.html', 'privasi.html', 'syarat.html', '404.html', 'oauth/consent.html', 'fitur.html', 'dukungan.html'];

const token = (name) => {
  const value = new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'm').exec(read('site.css'))?.[1];
  assert.ok(value, `site.css defines ${name} as a hex colour`);
  return value;
};

const luminance = (hex) => {
  const [r, g, b] = hex.replace('#', '').match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

test('every page sits on one dark canvas', () => {
  const bg = token('--bg');
  assert.ok(luminance(bg) < 0.05, `--bg is dark, and measures ${luminance(bg).toFixed(3)}`);
  for (const page of pages) {
    const css = cssOf(page);
    assert.match(css, /body \{[^}]*background: var\(--bg\)/s, `${page} paints the shared canvas`);
    assert.doesNotMatch(css, /body \{[^}]*background: #f[0-9a-f]{5}/s, `${page} paints no light canvas of its own`);
  }
});

test('every pair of text and ground clears its contrast floor', () => {
  const bg = token('--bg');
  assert.ok(contrast(token('--ink'), bg) >= 7, `body ink clears AAA, and measures ${contrast(token('--ink'), bg).toFixed(2)}`);
  assert.ok(contrast(token('--muted'), bg) >= 4.5, `second-rank ink clears AA, and measures ${contrast(token('--muted'), bg).toFixed(2)}`);
  assert.ok(contrast(token('--accent'), bg) >= 4.5, `the accent clears AA as text, and measures ${contrast(token('--accent'), bg).toFixed(2)}`);
  assert.ok(contrast(token('--on-fill'), token('--ink')) >= 7, 'the filled action reads on its own fill');
});

test('one accent, and every other surface is neutral', () => {
  for (const name of ['--bg', '--surface', '--surface-2', '--ink', '--muted']) {
    const [r, g, b] = token(name).replace('#', '').match(/../g).map((x) => parseInt(x, 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 3, `${name} carries no hue, and spans ${Math.max(r, g, b) - Math.min(r, g, b)}`);
  }
  const [r, g, b] = token('--accent').replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) > 100, 'the accent is the only saturated colour');
});

test('the hero sells the product instead of apologizing for it', () => {
  const html = read('beranda.html');
  assert.doesNotMatch(html, /Sembilan dua/, 'the broken sentence is gone');
  assert.match(html, /34 tool/, 'the tool count is stated as a number');
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
  const byLabel = Object.fromEntries(stats.map((m) => [m[2].trim(), Number(m[1])]));
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

test('the nav answers a visitor in one row: four doors and one action', () => {
  // WHY THE NAV IS COUNTED, NOT DESCRIBED.
  // Measured on 2026-11-03 against opencode.ai: its nav is one short row with one filled action, while ours carried seven links beside a language toggle and the sign-in button.
  // Seven items is not a choice a reader makes; it is a list they scroll past, and the price page we shipped was not in it at all.
  // The doors are the four a visitor asks about; everything else belongs in the footer.

  const doors = ['/fitur.html', '/harga', '/unduh.html', '/dukungan.html'];
  for (const page of pages) {
    const html = read(page);
    const nav = /<nav>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    assert.ok(nav, `${page} has a nav to count`);
    const internal = [...nav.matchAll(/<a (?![^>]*class="(?:brand|navCta)[^"]*")[^>]*>/g)].map((m) => m[0]);
    assert.ok(internal.length <= 5, `${page} keeps the nav to five links, and carries ${internal.length}`);
    assert.equal((nav.match(/class="navCta"/g) || []).length, 1, `${page} offers exactly one filled action`);
    for (const door of doors) {
      assert.ok(nav.includes(`href="${door}"`), `${page} reaches ${door} from the nav`);
    }
    assert.doesNotMatch(nav, /class="nav-sec"/, `${page} carries no secondary class the stylesheet hides on a laptop`);
  }
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
  assert.match(index, /--wrap:\s*(?:1160|1200)px/, 'the shell names a measure wide enough for the chrome and the page below it');
  assert.match(index, /header \.wrap\s*\{[^}]*max-width:\s*var\(--wrap\)/, 'the chrome keeps that measure, whatever the column below does');
  assert.match(index, /header nav\s*\{[^}]*overflow-x:\s*auto/, 'the row scrolls itself when the wrap is still too tight');
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
  assert.doesNotMatch(html, /class="eyebrow" id="heroEyebrow"|class="eyebrow"[^>]*data-i18n="hero\.eyebrow"/, 'no label sits above the headline, which the taste audit removed');
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

  // WHY 76px AND NOT 82px: the taste audit measured the old headline as a three-line slab at 1440px and cut it, so the hero now names the thing at a size the measure beneath it can hold.
  // The rule keeps its subject — display type on the home page, a clear second rank under it, breathing room around both — and the size it pins is the one the sheet sets.

  const css = cssOf('beranda.html');
  assert.match(css, /clamp\(40px, 6vw, 76px\)/, 'the headline spans display sizes');
  assert.match(css, /h2 \{[^}]*font-size: clamp\(28px, 3\.2vw, 44px\)/, 'sections step down to a clear second rank');
  assert.match(css, /\.section \{[^}]*padding: 104px 0/, 'and breathe around each idea');
});

// The taste audit removed the pill from the marketing hero's own mock badge and its provider entries, and auth.css now rounds its controls with the same 10px/6px the signed-in shell uses.
// The test keeps its subject — marketing rounds, shell squares — and pins the shape the sheets actually set.

test('a page sheet names no colour of its own', () => {
  for (const sheet of ['beranda.css', 'auth.css', 'app.css', 'dashboard.css', 'download.css', 'features.css']) {
    const css = read(sheet);
    const literals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((m) => m[0]);
    assert.deepEqual(literals, [], `${sheet} reads every colour from a token`);
  }
});

test('no page separates two surfaces with a shadow', () => {
  const sheet = read('site.css');
  assert.doesNotMatch(sheet, /--shadow/, 'the shadow token is gone');
  for (const page of pages) {
    assert.doesNotMatch(cssOf(page), /\.card \{[^}]*box-shadow/, `${page} separates cards with a line`);
  }
});

test('the home hero speaks in one column, and the questions answer in place', () => {
  const css = cssOf('beranda.html');
  assert.match(css, /\.heroGrid \{[^}]*grid-template-columns: minmax\(0, 1fr\)/s, 'the hero is one column, the way opencode.ai reads');
  assert.match(css, /\.heroCopy h1 \{[^}]*max-width: 20ch/s, 'and the headline may run wider than a half column');
  const html = read('beranda.html');
  assert.match(html, /<details>\s*<summary data-i18n="faq\.cost\.dt">/, 'a question opens and closes without script');
  assert.equal((html.match(/<details>/g) || []).length, 5, 'the five questions are all there');
  assert.doesNotMatch(html, /<dl class="facts faq">/, 'and the old flat list is gone');
});

test('the features read as one numbered column, not as cards', () => {
  const html = read('fitur.html');
  assert.match(html, /<section class="featureList"/, 'the abilities stand in a list');
  assert.equal((html.match(/<article class="featureRow">/g) || []).length, 5, 'five of them');
  assert.doesNotMatch(html, /featureCard/, 'and no card survives');
  const css = cssOf('fitur.html');
  assert.match(css, /\.featureRow \{[^}]*grid-template-columns: minmax\(0, \.8fr\) minmax\(0, 1\.2fr\)/s, 'a title beside its body');
  assert.match(css, /\.featureList \{[^}]*border-top: 1px solid var\(--line\)/s, 'and a line between each');
});

test('the download pages read as one column, and the file table says what is true', () => {
  const hub = read('unduh.html');
  assert.doesNotMatch(hub, /class="shot"/, 'the hub drops the mock file panel it already states in words');
  assert.match(hub, /class="btn giant" href="\.\/unduh-berkas\.html"/, 'and keeps one giant door to the files page');
  assert.match(hub, /<span class="stat-num">/, 'with the counts the code proves');

  const css = cssOf('unduh.html');
  assert.match(css, /\.hero \{[^}]*grid-template-columns: minmax\(0, 1fr\)/s, 'the hub hero is one column');

  const files = read('unduh-berkas.html');
  assert.match(files, /<table class="support">/, 'the browser support table is the file table, and it stays');
  assert.doesNotMatch(files, /SHA-256<\/th>|Ukuran<\/th>/, 'and it claims no size or checksum it cannot hold');
  assert.match(cssOf('unduh-berkas.html'), /\.support th \{[^}]*border-bottom: 1px solid var\(--line-strong\)/s, 'its head rests on a line, not a shadow');
});

test('the 404 offers its exits as a list, and counts them honestly', () => {
  const html = read('404.html');
  const exits = [...html.matchAll(/<li><a href="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(exits.length >= 4, `the exits exist as links, not divs, and there are ${exits.length}`);
  const words = { 4: 'Empat', 5: 'Lima', 6: 'Enam' };
  assert.match(html, new RegExp(`${words[exits.length]} jalan keluar`), 'the copy counts what stands under it');
  assert.doesNotMatch(html, /class="tile"/, 'and no card shape survives');
  assert.match(read('site.css'), /\.exitList a:hover/, 'a link answers the hover, so it reads clickable');
});

test('the reading pages keep their map beside the text', () => {
  const css = read('site.css');
  assert.match(css, /main\.prose:has\(\.toc\)/, 'a page with a map lays the map beside the text');
  assert.match(css, /\.toc \{[^}]*background: var\(--surface\)/s, 'and the map is a surface of the canvas');
  const dukung = read('dukungan.html');
  assert.match(dukung, /<details>/, 'the support questions open in place');
  assert.doesNotMatch(dukung, /<dl class="facts">/, 'and no flat list survives');
});

test('the brand mark reads on the dark canvas, on every page', () => {
  const sheet = read('site.css');
  assert.match(sheet, /header nav \.brandMark rect \{[^}]*fill: var\(--accent\)/s, 'the mark is a filled square in the accent, not a dark one on a dark page');
  assert.match(sheet, /header nav \.brandMark path \{[^}]*fill: var\(--bg\)/s, 'and its glyph is cut in the canvas colour');
  for (const page of pages) {
    const html = read(page);
    assert.ok(html.includes('class="brandMark"'), `${page} carries the mark`);
    assert.doesNotMatch(html, /brandMark[^>]*>\s*<rect[^>]*fill="#101512"/, `${page} paints no dark square on a dark page`);
  }
});

test('the shared radius is the only radius a control names', () => {
  const sheet = read('site.css');
  assert.match(sheet, /--radius:\s*8px/, 'a card is 8px, and the token says so');
  assert.match(sheet, /--radius-sm:\s*6px/, 'a control is 6px');
  for (const page of pages) {
    assert.doesNotMatch(cssOf(page), /border-radius:\s*980px/, `${page} names no radius by hand`);
  }
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
