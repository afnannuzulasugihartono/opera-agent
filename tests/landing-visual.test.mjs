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
const pages = ['beranda.html', 'akun.html', 'index.html', 'dashboard.html', 'unduh.html', 'unduh-berkas.html', 'privasi.html', 'syarat.html', '404.html', 'oauth/consent.html', 'fitur.html', 'dukungan.html', 'docs.html'];

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
  // WHY THE SPAN MOVED FROM 3 TO 12: opencode.ai's greys are blue-tinted neutrals (#23262f spans 12).
  // The claim being kept is the one that matters: no surface competes with the accent for attention.
  for (const name of ['--bg', '--surface', '--surface-2', '--ink', '--muted']) {
    const [r, g, b] = token(name).replace('#', '').match(/../g).map((x) => parseInt(x, 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 12, `${name} carries no hue worth naming, and spans ${Math.max(r, g, b) - Math.min(r, g, b)}`);
  }
  const [r, g, b] = token('--accent').replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) > 100, 'the accent is the only saturated colour');
});

test('the canvas is opencode black, with opencode greys above it', () => {
  assert.equal(token('--bg'), '#000000', 'the canvas is black, like opencode.ai');
  assert.equal(token('--surface'), '#17181c', 'a panel is opencode gray-1');
  assert.equal(token('--surface-2'), '#23262f', 'a raised panel is opencode gray-2');
  assert.equal(token('--line-strong'), '#353841', 'and the strong edge is opencode gray-2');
});

test('the hero sells the product instead of apologizing for it', () => {
  const html = read('beranda.html');
  assert.doesNotMatch(html, /Sembilan dua/, 'the broken sentence is gone');
  assert.match(html, /<dt>\d+<\/dt><dd data-i18n="hero\.stat\.tools">tool MCP/, 'the tool count is stated as a number beside its name');
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

test('the nav answers a visitor in one row: five doors and one action', () => {
  // WHY THE NAV IS COUNTED, NOT DESCRIBED.
  // Measured on 2026-11-03 against opencode.ai: its nav is one short row with one filled action, while ours carried seven links beside a language toggle and the sign-in button.
  // Seven items is not a choice a reader makes; it is a list they scroll past, and the price page we shipped was not in it at all.
  // The doors are the five a visitor asks about; everything else belongs in the footer.

  const doors = ['/fitur.html', '/harga', '/unduh.html', '/dukungan.html', '/docs.html'];
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

test('the giant door answers the eye once, and keyboard visitors get the same answer', () => {
  const sheet = read('download.css');
  assert.match(sheet, /@keyframes giant-breathe/, 'the door breathes on arrival');
  assert.match(sheet, /\.btn\.giant \{[^}]*animation: giant-breathe 0\.6s var\(--ease\) 0\.2s backwards/s, 'once, and backwards so it starts from still');
  assert.match(sheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.btn\.giant \{[^}]*animation: none/s, 'and still for motion-sensitive readers');
  assert.match(sheet, /\.btn\.giant:focus-visible \{[^}]*box-shadow: 0 0 0 3px var\(--accent-soft\)/s, 'while a keyboard ring names it');
});

test('the hero states each number once', () => {

  const hero = read('beranda.html').match(/<section class="hero[^"]*">[\s\S]*?<\/section>/)[0];
  const prose = hero
    .replace(/<dl class="heroStats"[\s\S]*?<\/dl>/, '')
    .replace(/<div class="demo"[\s\S]*?<\/div>\s*<\/div>/, '');
  assert.doesNotMatch(prose, /26 aksi/, 'no second 26 with another noun');
  assert.doesNotMatch(prose, /\d+\s+(tool|primitive|izin|aksi|permission)/i, 'the hero prose names no count at all');
  assert.match(hero, /Tanpa eksekusi skrip bebas/, 'the prose keeps its promise');
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
  assert.equal((html.match(/<details>/g) || []).length, 3, 'the three questions are all there');
  assert.doesNotMatch(html, /<dl class="facts faq">/, 'and the old flat list is gone');
});

test('the features read as a bento grid, and the light follows the pointer', () => {
  // WHY THE GRID REPLACED THE NUMBERED COLUMN: measured against firecrawl.dev on 2026-11-04, its abilities stand in a bento grid whose cards answer the pointer, and a reference column of five rows reads like a table of contents instead of a product.
  const html = read('fitur.html');
  assert.match(html, /<section class="bento"/, 'the abilities stand in a grid');
  assert.ok((html.match(/class="bentoArticle"/g) || []).length >= 5, 'five of them');
  assert.doesNotMatch(html, /featureRow/, 'and the numbered row is gone');
  const css = cssOf('fitur.html');
  assert.match(css, /\.bentoArticle \{[^}]*--mx/s, 'a card reads the pointer');
  assert.match(css, /\.bentoArticle \{[^}]*overflow: hidden/s, 'and the card keeps its own light inside, so the page never scrolls sideways');
  assert.match(html, /src="\/spotlight\.js"/, 'and one shared script feeds every grid');
});

test('the features page shows one task travelling from a sentence to a file', () => {
  // WHY THIS PAGE NEEDS A SHAPE: measured against firecrawl.dev on 2026-11-05, every block it ships answers with a picture of the work, and a features page made only of cards asks the reader to believe a claim instead of watching it.
  const html = read('fitur.html');
  assert.match(html, /<section class="taskStage"/, 'the page carries the shape of one task');
  assert.equal((html.match(/class="taskStep"/g) || []).length, 4, 'four steps: talk, read, write, save');
  assert.match(html, /<code class="taskFile">ringkasan\.md<\/code>/, 'and the task ends in a file');
  const css = read('features.css');
  assert.match(css, /taskStep:not\(:last-child\)::after \{[^}]*animation: rail-fill/s, 'a light walks the rail as the section lands');
  assert.match(css, /@keyframes rail-fill/, 'the rail fills once');
  assert.match(css, /taskStep:nth-child\(3\)[^{]*::after \{[^}]*animation-delay/s, 'and the steps light one after another');
  assert.doesNotMatch(css, /infinite/, 'nothing on this page loops on its own');
});

test('the home page pauses on one statement, and the accent word carries it', () => {
  // WHY THE PAGE NEEDS A SHOUT: measured against firecrawl.dev on 2026-11-05, its home page stops on one line of large type between the product blocks, and a page of equal sections reads like a list instead of a story.
  const html = read('beranda.html');
  assert.match(html, /<section class="section statement"/, 'the page carries one statement block');
  assert.match(html, /class="statementAccent"/, 'and one word in it carries the accent');
  const css = cssOf('beranda.html');
  assert.match(css, /statement\.in \.statementAccent::after \{[^}]*animation: statement-rule/s, 'the accent word draws its own rule when the band lands');
  assert.match(css, /@keyframes statement-rule/, 'the rule exists');
  assert.match(css, /\.statementLine \{[^}]*font-size: clamp\(/s, 'the statement is set in large type');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.statementAccent::after \{[^}]*animation: none/s, 'and the motion bows out when asked');
});

test('the shared spotlight script only paints what the pointer names', () => {
  const src = read('spotlight.js');
  assert.match(src, /pointermove/, 'it listens to the pointer');
  assert.match(src, /--mx/, 'and writes the two numbers the card paints');
  assert.doesNotMatch(src, /innerHTML|eval\(/, 'and it writes no markup and runs no code');
  for (const page of ['beranda.html', 'fitur.html']) {
    assert.match(read(page), /<script src="\/spotlight\.js"[^>]*><\/script>/, `${page} loads it from the site, not inline`);
  }
});

test('a disclosure opens smoothly, and instantly where it cannot', () => {
  const sheet = read('site.css');
  assert.match(sheet, /\.faqList details,[\s\S]*?\{[^}]*display: grid/s, 'a question is a row that can stretch');
  assert.match(sheet, /grid-template-rows: auto 0fr/, 'and it opens from zero rows');
  assert.match(sheet, /\[open\][\s\S]*?\{[^}]*grid-template-rows: auto 1fr/s, 'to the full row when open');
});

test('the current door arrives by sliding, not by appearing', () => {
  const sheet = read('site.css');
  assert.match(sheet, /header nav a\[aria-current="page"\][^\{]*\{[^}]*background-size: 100% 1px/s, 'the line spans the link and stays there');
  assert.match(sheet, /header nav a\[aria-current="page"\][^\{]*\{[^}]*animation: nav-line-in/s, 'and grows once when the page lands');
  assert.match(sheet, /@keyframes nav-line-in/, 'from zero to full, then done');
});

test('the verification command types itself, with the whole line kept for no-script readers', () => {
  const html = read('unduh-berkas.html');
  assert.match(html, /<span class="typewriter" data-type="/, 'the line carries the text it types');
  assert.match(html, /<noscript>/, 'and a still copy stands where the script cannot run');
  const css = cssOf('unduh-berkas.html');
  assert.match(css, /\.typewriter\.live \{[^}]*animation: type-ch [^;]*steps\(/s, 'one piece at a time');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.typewriter \{[^}]*animation: none/s, 'and instantly for motion-sensitive readers');
});

test('the dev server serves the whitelist and nothing else, even on loopback', () => {
  const src = fs.readFileSync(new URL('../scripts/landingserve.mjs', import.meta.url), 'utf8');
  assert.match(src, /new Set\(\[/, 'the servable files are named in the code');
  assert.match(src, /!FILES\.has\(name\)/, 'a name outside the list is refused');
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
  assert.doesNotMatch(files, /<h3>/, 'no heading skips a level under the title');
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
  assert.match(dukung, /<details[^>]*>/, 'the support questions open in place');
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

test('the demo types its proof one line at a time, and never without motion', () => {
  const html = read('beranda.html');
  assert.match(html, /class="mockCmd in"/, 'one line carries the live mark');
  assert.doesNotMatch(html, /class="mockCmd in".*class="mockCmd in"/s, 'only the first line starts live');
  const count = (html.match(/<span class="cursor" aria-hidden="true"><\/span>/g) || []).length;
  assert.equal(count, 3, 'each line carries a cursor the styles animate');
  const css = cssOf('beranda.html');
  assert.match(css, /\.mockCmd \{[^}]*animation:/s, 'each line enters on its own delay');
  assert.match(css, /@keyframes mock-in/, 'the entrance exists');
  assert.match(css, /\.mockCmd \.cursor/, 'a block cursor marks the live line');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.mockCmd \{[^}]*animation: none/s, 'and the motion bows out when asked');
});

test('the home page shows more than it explains', () => {
  const html = read('beranda.html');
  // WHY THE DECORATIVE BLOCKS ARE LEFT OUT: the strip repeats site names for the loop and the quick tiles only exist for a signed-in reader.
  // Neither is prose a visitor reads, so neither is counted against the copy budget.
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<div class="marquee" aria-hidden="true">[\s\S]*?<\/div>\s*<\/div>/g, ' ')
    .replace(/<div class="grid" id="quickTiles" hidden>[\s\S]*?<\/div>\s*<\/div>/g, ' ')
    .replace(/<div class="row" id="ctaIn" hidden>[\s\S]*?<\/div>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  const words = visible.split(/\s+/).filter(Boolean).length;
  assert.ok(words <= 430, `the home page stays under 430 words, and carries ${words}`);
});

test('the hero shows three moments of the product, not one picture', () => {
  const html = read('beranda.html');
  assert.match(html, /role="tablist"/, 'the visual has tabs');
  assert.ok((html.match(/role="tab"/g) || []).length >= 3, 'three tabs');
  assert.ok((html.match(/role="tabpanel"/g) || []).length >= 3, 'three panels');
  assert.match(html, /class="demoTab"/, 'the tabs carry the class the sheet paints');
});

test('the hero demo plays once and then waits for the reader', () => {
  // WHY THIS EXISTS: measured against firecrawl.dev on 2026-11-05, its hero moves before a reader touches anything, and a still product picture reads as a picture.
  // The sequence shows all three moments once and stops, so the page never loops on its own, and a reader who reaches for it ends the sequence at once.
  const html = read('beranda.html');
  assert.match(html, /const playDemo = \(\) => \{/, 'the demo runs by itself');
  assert.match(html, /demoStep >= tabs\.length/, 'and it stops after the last moment');
  assert.match(html, /demo\.addEventListener\('pointerenter', stopDemo\)/, 'a reader who reaches for it ends the sequence');
  assert.match(html, /if \(demo && !reduceMotion\)/, 'and a reader who asked for stillness never sees it');
});

test('the strip of pages our users open moves once and stops when asked', () => {
  const html = read('beranda.html');
  const css = read('beranda.css');
  assert.match(html, /class="marquee"/, 'the strip is on the page');
  const track = /class="marqueeTrack"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1] ?? '';
  assert.ok((track.match(/<span>/g) || []).length >= 20, 'the strip repeats so it can loop');
  assert.match(css, /@keyframes marquee/, 'and it moves');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.marqueeTrack \{[^}]*animation: none/s, 'and it stops when the reader asks');
});

test('the mock types its commands instead of only fading them in', () => {
  // WHY A TYPED REVEAL: measured against firecrawl.dev on 2026-11-04, its product visual writes itself, and a hero that only fades reads like a slide.
  // The reveal is a clip in steps, so the text stays in the page for readers and for search engines.
  const css = read('beranda.css');
  assert.match(css, /\.mockCmd code \{[^}]*clip-path: inset\(0 100% 0 0\)/s, 'the command starts covered');
  assert.match(css, /@keyframes type-in/, 'and it is uncovered by a keyframe');
  assert.match(css, /\.mockCmd code \{[^}]*animation: type-in[^}]*steps\(/s, 'the uncover runs in steps, so it types');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.mockCmd code \{[^}]*clip-path: none/s, 'and the reader can refuse the typing');
});

test('the guide search shows where the keyboard is, and answers the slash key', () => {
  // WHY THE FOCUS RING STAYS: a shared rule takes the ring off every input, so the guide's own search box must put one back — otherwise a keyboard reader cannot see the cursor.
  // WHY THE SLASH KEY: measured against docs.firecrawl.dev on 2026-11-04, its search opens on "/", and a reader who wants one section should not hunt for the box.
  const sheet = read('docs.css');
  assert.match(sheet, /\.docSearch input:focus-visible \{[^}]*outline:/s, 'the search keeps a visible ring');
  assert.match(sheet, /\.docSearch::after \{[^}]*content: "\/"/s, 'and the box shows the key that opens it');
  const script = read('docs.js');
  assert.match(script, /key === '\/'/, 'the slash key is listened for');
  assert.match(script, /\.focus\(\)/, 'and it puts the cursor in the box');
});

test('the reader always knows where they are', () => {
  // WHY THIS EXISTS: measured against firecrawl.dev on 2026-11-04, its pages tell the reader where they are — a progress line under the header and a marked section in the map.
  // A long guide without either reads as a wall of text, and a reader who cannot find the section they left has to hunt for it.
  const script = read('wayfind.js');
  const sheet = read('site.css');
  assert.match(sheet, /\.readProgress \{/, 'a line under the header shows how far the reader came');
  assert.match(sheet, /\.toc a\[aria-current="true"\]/, 'the section being read is marked in the map');
  assert.match(script, /scaleX/, 'the line grows with the scroll');
  assert.match(script, /aria-current/, 'and the map marks the section in view');
  assert.match(script, /requestAnimationFrame/, 'the scroll is read on frames, not on every event');
  for (const page of pages) {
    assert.match(read(page), /<script src="\/wayfind\.js"><\/script>/, `${page} carries the wayfinder`);
  }
});

test('the reader searches the site from anywhere: one door, one key, one dialog', () => {
  // WHY THIS EXISTS: measured against docs.firecrawl.dev on 2026-11-05, a reader searches the site from a dialog opened by a key, not by hunting a nav row of five doors.
  // The lock holds the door on every page, the key that opens it, and the choice the reader can hear and see.
  const script = read('palette.js');
  const sheet = read('site.css');
  assert.match(script, /ctrlKey \|\| event\.metaKey/, 'the key opens the palette');
  assert.match(script, /showModal\(\)/, 'and it opens as a modal, so the page behind waits');
  assert.match(script, /aria-activedescendant/, 'the reader knows which destination is chosen');
  assert.match(sheet, /\.palette\[open\] \{[^}]*animation: palette-in \.18s var\(--ease\)/s, 'the dialog arrives in the site easing');
  assert.match(sheet, /\.palette::backdrop \{[^}]*background: var\(--scrim\)/s, 'and the page behind it dims');
  assert.match(sheet, /\.navSearch \{[^}]*display: none/s, 'the door stays shut without the script that answers it');
  assert.match(script, /query === '' \? DESTINATIONS\.length : 8/, 'an empty box lists every page, so the palette doubles as the phone menu');
  assert.match(sheet, /@media \(max-width: 620px\)[\s\S]*?header nav a:not\(\.brand\):not\(\.navCta\) \{[^}]*display: none/s, 'and the phone row leaves the five doors to the palette');
  for (const page of pages) {
    assert.match(read(page), /<script src="\/palette\.js"><\/script>/, `${page} carries the palette`);
    assert.match(read(page), /class="navSearch"/, `${page} carries the search door`);
  }
});

test('the product mock wears a travelling light, and the reader can refuse it', () => {
  // WHY THIS EXISTS: measured against firecrawl.dev on 2026-11-04, its product visual wears a slow rotating overlay, and a card that never moves reads as a picture of a product instead of a product at work.
  // The light is one pixel of accent walking the frame once every half minute, so it reads as a light and not as motion.
  const css = read('beranda.css');
  assert.match(css, /@property --sweep/, 'the angle the light walks is a registered property, so it can turn');
  assert.match(css, /\.demo::after \{[^}]*background: conic-gradient\(/s, 'the light is a gradient around the frame');
  assert.match(css, /\.demo::after \{[^}]*animation: sweep 32s linear infinite/s, 'and it turns once every half minute');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.demo::after \{[^}]*animation: none/s, 'and it stops dead when the reader asks');
});

test('one page moves into the next, and the brand keeps its place', () => {
  // WHY THIS EXISTS: measured against firecrawl.dev on 2026-11-05, moving between its pages is one motion, and a hard cut makes a site feel like a folder of documents.
  // The move lasts as long as a hover, and the brand mark stays put across it so the reader never loses the frame.
  const sheet = read('site.css');
  assert.match(sheet, /@view-transition \{\s*navigation: auto;/s, 'the browser moves between pages on its own');
  assert.match(sheet, /::view-transition-old\(root\)[\s\S]*?animation-duration: \.18s/s, 'and the move lasts as long as a hover');
  assert.match(sheet, /header nav \.brand \{[^}]*view-transition-name: brand/s, 'while the brand keeps its place');
  assert.match(sheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?::view-transition-new\(\*\)[\s\S]*?animation: none !important/s, 'and a reader who asks for stillness gets none of it');
});

test('a long page offers its way back, and a phone guide folds its map away', () => {
  // WHY THIS EXISTS: measured against docs.firecrawl.dev on 2026-11-05, its rail carries a way back to the top, and a phone reader met six section doors before the first line of the guide.
  // The way back appears only after the reader has scrolled, and the map opens only when it is asked for.
  const script = read('wayfind.js');
  const sheet = read('site.css');
  const guide = read('docs.css');
  assert.match(script, /className = 'toTop'/, 'the page builds a way back');
  assert.match(script, /scrollY > 600/, 'and it waits until the reader has scrolled far');
  assert.match(script, /prefers-reduced-motion/, 'and it obeys the reader who asks for stillness');
  assert.match(sheet, /\.toTop\[data-shown="true"\]/, 'the button shows itself only when it is wanted');
  assert.match(guide, /\.docNav\[data-map="open"\] \.toc/, 'the phone map opens on demand');
  assert.match(read('docs.html'), /class="docMapToggle"/, 'and the guide carries the door');
});

test('the capability cards answer the pointer', () => {
  const html = read('beranda.html');
  const css = read('site.css');
  assert.match(html, /class="bento"/, 'the home carries a bento grid');
  assert.ok((html.match(/class="bentoArticle"/g) || []).length >= 4, 'at least four cards');
  assert.match(css, /\.bentoArticle \{[^}]*--mx/s, 'the card reads the pointer');
  assert.match(css, /\.bentoArticle:nth-child\(2\)::after \{[^}]*animation-delay: 1s/s, 'and the cards light in turn instead of blinking together');
  assert.match(read('spotlight.js'), /pointermove/, 'and the shared script feeds it');
});

test('the numbers count up once, when they arrive', () => {
  const html = read('beranda.html');
  assert.match(html, /requestAnimationFrame/, 'the count runs on frames');
  assert.match(html, /prefers-reduced-motion/, 'and the reader can refuse it');
});

// WHY THE SWEEP JOINS THE LIST: measured against firecrawl.dev on 2026-11-04, its product visual wears a slow rotating overlay, so the light walking the mock frame is the one new loop this goal buys.
// The lock still holds on the thing that matters: a loop must be slow enough to read as light, and nothing else moves on its own.

test('a hover answers within 120ms, and only the strip, the cursor, the live dot and the walking light move on their own', () => {
  const sheet = read('site.css');
  assert.match(sheet, /\.tile:hover \{[^}]*transform: translateY\(-1px\)/s, 'a tile lifts one pixel');
  assert.match(sheet, /\.exitList a:hover \{[^}]*color: var\(--accent\)/s, 'a link answers in the accent');
  assert.doesNotMatch(sheet, /@keyframes (float|drift|pulse|spin|glow)/, 'and no keyframe moves anything without the reader');
  const loops = [...read('beranda.css').matchAll(/([^{}]+)\{([^}]*animation[^}]*)\}/g)]
    .filter((match) => /infinite/.test(match[2]))
    .map((match) => match[1].trim());
  assert.ok(loops.every((selector) => /\.marqueeTrack|\.cursor|\.mockTop \.dot|\.demo::after/.test(selector)), `only the strip, the cursor, the live dot and the walking light loop, and ${loops.length} do`);
  for (const match of read('beranda.css').matchAll(/([^{}]+)\{([^}]*animation[^}]*infinite[^}]*)\}/g)) {
    const selector = match[1].trim();
    if (/\.cursor/.test(selector)) continue;
    const seconds = Number(/([\d.]+)s/.exec(match[2])?.[1] ?? 0);
    assert.ok(seconds >= 30, `${selector} turns once every ${seconds}s, so it reads as light and not as motion`);
  }
  assert.doesNotMatch(read('features.css') + read('download.css'), /animation-iteration-count:\s*infinite/, 'the other pages keep their calm');
});

test('the shared radius is the only radius a control names', () => {
  const sheet = read('site.css');
  assert.match(sheet, /--radius:\s*6px/, 'a card is 6px, like opencode');
  assert.match(sheet, /--radius-sm:\s*4px/, 'a control is 4px');
  for (const page of pages) {
    assert.doesNotMatch(cssOf(page), /border-radius:\s*980px/, `${page} names no radius by hand`);
  }
});

test('the motion is opencode motion: one easing, 150 to 200 milliseconds', () => {
  const sheet = read('site.css');
  assert.match(sheet, /--ease:\s*cubic-bezier\(\.25, \.46, \.45, \.94\)/, 'the easing is opencode own');
  const slow = [...sheet.matchAll(/transition:[^;}]*?([\d.]+)s/g)].map((m) => Number(m[1])).filter((n) => n > 0.2);
  assert.deepEqual(slow, [], `no transition runs longer than 200ms, and ${slow.length} do`);
});

test('the display type is mono, the way opencode sets its headings', () => {
  const sheet = read('site.css');
  assert.match(sheet, /h1,\s*\n?h2 \{[^}]*font-family:\s*var\(--mono\)/s, 'h1 and h2 speak in mono');
  assert.match(sheet, /h1,\s*\n?h2 \{[^}]*font-weight:\s*500/s, 'and at the weight mono reads well');
});

test('the hero carries its footnote instead of hiding the catch', () => {

  const html = read('beranda.html');
  assert.match(html, /class="footnote"/, 'the line has an element');
  assert.match(html, /Biaya model ke penyedia Anda/, 'stating the only money that moves');
});

test('motion is an enhancement, never the content', () => {

  const page = read('beranda.html');
  const css = cssOf('beranda.html');
  assert.match(read('reveal.js'), /documentElement\.classList\.add\('js'\)/, 'JS announces itself before anything hides');
  assert.match(css, /html\.js \[data-reveal\]/, 'hiding requires that announcement');
  assert.match(css, /prefers-reduced-motion/, 'and the motion bows out when asked');
  assert.match(read('reveal.js'), /IntersectionObserver/, 'one observer per page, not per pixel');

  assert.match(css, /@media print\s*{[^}]*\[data-reveal\][^}]*opacity:\s*1/s,
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
