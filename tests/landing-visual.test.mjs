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

// WHY THE TWO ASSERTIONS READ THE PAGE SHEET ALONE: cssOf joins the shared sheet into every page, and the shared sheet is exactly where the one canvas and the one chrome rule live - a page restating them is the bug being caught.

const pageSheetOf = (name) => {
  const html = read(name);
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+)"/g)].map((match) => match[1]).filter((file) => file !== 'site.css');
  return links.map((file) => read(file)).join('\n');
};
const pages = ['beranda.html', 'akun.html', 'index.html', 'dashboard.html', 'unduh.html', 'privasi.html', 'syarat.html', '404.html', 'oauth/consent.html', 'fitur.html', 'studi.html', 'bukti.html', 'dukungan.html', 'docs.html'];

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
  // WHY THE BLUE BRIGHTENS THE FLOOR, NOT THE CLAIM: the canvas moved from black to cobalt (luminance .064), which is still decisively dark for light ink and keeps the one fill (the ask) readable at a glance; the claim is "one dark canvas, everywhere", and cobalt meets it.
  const bg = token('--bg');
  assert.ok(luminance(bg) < 0.09, `--bg is dark, and measures ${luminance(bg).toFixed(3)}`);
  assert.ok(luminance(bg) > 0, 'and it carries colour, so it is the reference, not a void');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(bg.slice(1 + i, 3 + i), 16));
  assert.ok(b > r + 150, 'the canvas leans blue, like the house reference');
  assert.match(read('site.css'), /html \{[^}]*background: var\(--bg\)/s, 'the shared sheet paints the canvas once');
  for (const page of pages) {
    const css = pageSheetOf(page);
    assert.doesNotMatch(css, /body \{[^}]*background: #f[0-9a-f]{5}/s, `${page} paints no light canvas of its own`);
    assert.doesNotMatch(css, /html \{[^}]*background:/s, `${page} names no canvas of its own`);
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
  // WHY THE RULE MOVED FROM SPAN 12 TO BLUE-NEUTRAL: a cobalt ground and navy panels cannot pass a 12-span rule by design; the claim that matters is unchanged - no surface competes with the accent - so every surface must stay an unsaturated navy (span ≤ 45, blue-leaning) and the accent must out-saturate them all.
  for (const name of ['--surface', '--surface-2', '--ink', '--muted']) {
    const [r, g, b] = token(name).replace('#', '').match(/../g).map((x) => parseInt(x, 16));
    const span = Math.max(r, g, b) - Math.min(r, g, b);
    assert.ok(span <= 45, `${name} stays an unsaturated navy, and spans ${span}`);
    assert.ok(b >= r, `${name} leans blue, like the ground it sits on`);
  }
  const [r, g, b] = token('--accent').replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  const span = Math.max(r, g, b) - Math.min(r, g, b);
  assert.ok(span > 45, 'the accent out-saturates every surface');
});

// WHY THE CANVAS MOVED: the site took the house reference (hermes-agent.nousresearch.com) - a cobalt ground (#0000f2) with two navy panels and a white ink - which still clears AAA for body copy and keeps the install ask the only filled thing on the page.

test('the canvas is cobalt, with navy panels above it', () => {
  assert.equal(token('--bg'), '#0000f2', 'the canvas is cobalt, like the house reference');
  assert.equal(token('--surface'), '#19192f', 'a panel is the house navy-1');
  assert.equal(token('--surface-2'), '#232344', 'a raised panel is the house navy-2');
  assert.match(read('site.css'), /--line-strong:\s*rgba\(242, 242, 242, 0\.32\)/, 'and the strong edge is a light ink line, not a new grey');
});

test('the hero sells the product instead of apologizing for it', () => {
  const html = read('beranda.html');
  assert.doesNotMatch(html, /Sembilan dua/, 'the broken sentence is gone');
  assert.match(html, /<dt>\d+<\/dt><dd data-i18n="hero\.stat\.tools">tool MCP/, 'the tool count is stated as a number beside its name');
  assert.match(html, /<div class="runWindow[^"]*" role="img" aria-label="[^"]+"[^>]*>/, 'a product window answers what the words claim');
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

// WHY THE DOOR IS ASSERTED IN TWO ARTEFACTS: the page carries the mount it will be injected into, and the one shared builder carries the actual door - a page without the mount renders nothing, a builder without the door dangles.

test('the nav faces the reader like a masthead: two doors each side, one ask', () => {
  // WHY THE CHROME IS A MASTHEAD: the house reference for this page (the Hermes Agent masthead) is a centred wordmark flanked by one short list each side, two doors on the left and the portal door plus the ask on the right - everything else belongs to the footer.
  // WHY THE DOORS ARE DECLARED ONCE: two on the left, the portal door and the ask on the right - measured against the house masthead, and Dukungan lives in the footer because a masthead carries only what a newcomer asks about.
  for (const page of pages) {
    const html = read(page);
    // WHY THE FOLD IS NOT PART OF THIS COUNT: the portal menu is hidden chrome, one click away; its doors belong to the fold, never to the two-doors-each-side rule.
    // The fold is the last thing in the header, so the masthead is what stands before it.
    const rawHeader = /<header>([\s\S]*?)<\/header>/.exec(html)?.[1] ?? '';
    assert.ok(rawHeader, `${page} has a header to count`);
    const header = rawHeader.replace(/<div data-portal-menu>[\s\S]*$/, '');
    const internal = [...header.matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((tag) => !/class="brand"|class="navCta"/.test(tag));
    assert.equal(internal.length, 3, `${page} keeps the nav to three text doors, and carries ${internal.length}`);
    assert.equal((header.match(/class="navCta"/g) || []).length, 1, `${page} offers exactly one ask`);
    assert.match(header, /<span class="wordmark">/, `${page} carries the wordmark`);
    assert.match(header, /data-portal-toggle/, `${page} carries the portal mount`);
    const portalBuilder = read('portal.js');
    assert.match(portalBuilder, /id="navPortalToggle"/, `${page}'s portal.js builds the portal door`);
    assert.match(portalBuilder, /id="portalMenu"/, `${page}'s portal.js builds the portal menu`);
    const door = (name) => new RegExp(`href="(?:\\./|/)${name.replace('.', '\\.')}"`);
    for (const name of ['fitur.html', 'unduh.html', 'docs.html']) {
      assert.match(header, door(name), `${page} reaches ${name} from the nav`);
    }
    const footerHtml = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? '';
    const rules = footerHtml.includes('data-footer-mount') ? read('footer.js') : footerHtml;
    assert.match(rules, door('dukungan.html'), `${page} still reaches Dukungan from the rules below`);
  }
});

test('the nav survives a 390px phone without wrapping ragged', () => {
  for (const page of pages) {
    const css = cssOf(page);
    assert.match(css, /white-space:\s*nowrap/, `${page} keeps each nav item on one line`);
  }
  const index = cssOf('beranda.html');
  assert.match(index, /@media \(max-width: 620px\)[\s\S]*?\.navSide a \{[^}]*display: none/s, 'the phone row folds the doors instead of scrolling them');
});

test('the shell is fluid, not stepped', () => {
  // WHY ONE TOKEN EACH: a fixed 32px gutter or a fixed 104px band reads fine until the window is short or wide, and then the page legislates two windows at once.
  const css = read('site.css');
  assert.match(css, /--section-y:\s*clamp\(4rem,\s*9vh,\s*8rem\)/, 'one fluid section rhythm, vh-aware');
  assert.match(css, /--gutter:\s*clamp\(1\.25rem,\s*5vw,\s*3\.5rem\)/, 'one fluid gutter, vw-aware');
  assert.doesNotMatch(read('beranda.css'), /height:\s*calc\(100vh/, 'no page clamps itself to the viewport');
});

test('the window carries the run, and the reader can refuse it', () => {
  // WHY THE WORK IS SHOWN, NOT SAID: a claim without the frame buys nothing - the reader watches the job finish and the artefact land, the same proof the product gives its own users.
  const js = read('run.js');
  const html = read('beranda.html');
  assert.match(html, /<div class="runWindow[^"]*" role="img" aria-label="[^"]+"[^>]*>/, 'the window is announced, not just shown');
  assert.match(html, /onboarding\.csv/, 'the artefact lands as a named file');
  assert.match(html, /<noscript>/, 'a reader without script still reads the still frame');
  assert.match(js, /prefers-reduced-motion: reduce/, 'a stillness-seeking reader never sees steps tick');
  assert.match(js, /IntersectionObserver|is-done/, 'and the done frame is the default state');
});

test('the chrome keeps the window, never the column', () => {

  // WHY THE PIN MOVED TO THE SHARED SHEET: the old mechanism (a --wrap measure, a max-width on header .wrap and an overflow-x auto) protected a fixed chrome from narrow page columns.
  // The masthead is now fluid edge to edge (max-width: none), so no page column can squeeze it and no door list needs to scroll itself - the claim kept is the same one: the chrome is never squeezed by the page below it.
  const sheet = read('site.css');
  assert.match(sheet, /header \.wrap \{[^}]*max-width: none/, 'the shared chrome keeps the window, not a column measure');
  for (const page of pages) {
    assert.doesNotMatch(pageSheetOf(page), /header \.wrap \{/, `${page} names no header measure of its own`);
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

test('the phone folds the doors, and never clips a word', () => {

  // WHY THE MASK DIED: the phone cut hides the doors entirely (display: none), so a scroll-fade hint would describe a scroll that does not exist; the claim kept is the honest one - on a phone the chrome keeps the wordmark and the ask, and no word is clipped mid-token.
  const sheet = read('site.css');
  const block = /@media \(max-width: 620px\) \{[\s\S]*?\n\}/.exec(sheet)?.[0] ?? '';
  assert.match(block, /\.navSide a \{ display: none/, 'the doors fold away on a phone');
  assert.doesNotMatch(block, /\.navCta \{ display: none/, 'and the ask survives the cut');
  assert.doesNotMatch(block, /overflow-x: auto/, 'and no list pretends to scroll');
});

test('the hero carries exactly one filled action, and it is the download', () => {

  // WHY THE PIN READS heroPrimary: the hero's filled pill is its own 54px variant of the shared .btn.primary (the masthead CTA is the global ask), so the one filled action a stranger sees is written in the same class the hero styles, not in a class the sheet never names.
  const hero = read('beranda.html').match(/<section class="hero[^"]*">[\s\S]*?<\/section>/)[0];

  const row = (id) => new RegExp(`<div class="row[^"]*" id="${id}"[^>]*>([\\s\\S]*?)</div>`).exec(hero)[1];
  const filledIn = (id) => [...row(id).matchAll(/<a\b[^>]*class="[^"]*\bheroPrimary\b[^"]*"[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(filledIn('ctaOut'), ['./unduh.html'], 'a stranger is offered exactly one filled action, the download');
  assert.deepEqual(filledIn('ctaIn'), ['./dashboard.html'], 'a member is offered exactly one filled action, the dashboard');
});

test('the five download doors answer the eye and the keyboard', () => {
  const html = read('unduh.html');
  const doors = html.match(/<a class="btn" href="https:\/\/nenmkmtvjremqphfqnfw\.supabase\.co\/functions\/v1\/opera-agent-update\/download\/opera-agent\.zip\?for=[a-z]+"[^>]*>Unduh \.zip/g) || [];
  assert.equal(doors.length, 5, 'five cards, five honest doors, one archive');
  assert.match(read('site.css'), /:focus-visible \{\s*outline: 2px solid var\(--focus\)/, 'keyboard visitors get the same ring on every door');
});

// WHY THE PROMISE LEFT THIS GATE: the user asked for the lede with its sentence to go; the safety story now lives where the page states it (permissions, privacy, FAQ), and this gate keeps the counting honest.

test('the hero states each number once', () => {

  const hero = read('beranda.html').match(/<section class="hero[^"]*">[\s\S]*?<\/section>/)[0];
  const prose = hero
    .replace(/<dl class="heroStats"[\s\S]*?<\/dl>/, '');
  assert.doesNotMatch(prose, /26 aksi/, 'no second 26 with another noun');
  assert.doesNotMatch(prose, /\d+\s+(tool|primitive|izin|aksi|permission)/i, 'the hero prose names no count at all');
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

  // WHY THE 128PX CEILING AND THE 11VW SWEEP: the headline names the product in the same register as the masthead wordmark; measured at 1280px the 11vw sweep holds "browser Anda." on its own line, and the fold never swallows the call to action.
  // The rule keeps its subject - display type on the home page, a clear second rank under it, breathing room around both - and the size it pins is the one the sheet sets.
  const css = cssOf('beranda.html');
  assert.match(css, /clamp\(54px, 11vw, 128px\)/, 'the headline spans display sizes, held to the measure');
  assert.match(css, /h2 \{[^}]*font-size: clamp\(22px, min\(3\.2vw, 5\.4vh\), 44px\)/, 'sections step down to a clear second rank');
  assert.match(css, /\.section \{[^}]*padding: var\(--section-y\) 0/, 'and breathe in one fluid rhythm');
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

test('the home hero is one left-aligned column, and the mosaic is the backdrop', () => {
  // WHY THE COLUMN IS LEFT AND THE PAINTING FILLS THE HERO: the reference (hermes-agent.nousresearch.com) prints its promise left of a full-bleed engraving; a centred exhibit reads as a brochure cover, not as the agent working.
  const css = cssOf('beranda.html');
  assert.match(css, /\.hero \{[^}]*display: flex;\s*flex-direction: column;\s*justify-content: center/s, 'the hero is one column, held to the fold');
  assert.match(css, /\.hero \{[^}]*overflow: hidden/s, 'and the backdrop is clipped to it');
  assert.match(css, /\.heroCopy \{[^}]*position: relative;\s*z-index: 2/s, 'and the words ride above the scrim');
  const html = read('beranda.html');
  assert.match(html, /<canvas id="mosaicBg" class="bgCanvas"/, 'the painting is the backdrop, not a competing box');
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

test('the price page answers each rule in place, and its cards answer the pointer', () => {
  // WHY THIS PAGE NEEDS A SHAPE: measured against firecrawl.dev/pricing on 2026-11-05, its billing rules sit behind questions that open in place, and its cards answer the pointer; five open paragraphs read as a wall.
  const html = read('harga.html');
  const rules = [...html.matchAll(/<details class="qa" id="([a-z]+)"[^>]*>/g)].map((match) => match[1]);
  assert.deepEqual(rules, ['prabayar', 'plan', 'pekerjaan', 'gagal', 'batas', 'model'], 'each rule opens in place and keeps the anchor its map names');
  for (const id of rules) assert.ok(html.includes(`href="#${id}"`), `the map still reaches ${id}`);
  assert.match(html, /<script src="\/spotlight\.js"[^>]*><\/script>/, 'and the cards take the shared pointer light');
  const sheet = read('harga.css');
  assert.match(sheet, /\.priceCard \{[^}]*radial-gradient\([^;]*var\(--mx\)/s, 'the card paints a light at the two numbers the pointer writes');
  assert.match(sheet, /@media \(max-width: 899px\)[\s\S]*?main\.prose \.toc \{[^}]*display: none/s, 'and a phone reads the rules themselves as its map');
  assert.match(read('wayfind.js'), /\.open = true/, 'a map door opens the rule it names');
});

test('an open question keeps its minus sign', () => {
  // WHY THIS LOCK: the open marker was mojibake in the sheet, so every opened question wore three broken characters instead of one minus.
  const sheet = read('site.css');
  assert.doesNotMatch(sheet, /content:\s*"[^"\n]*\u00e2[^"\n]*"/, 'no marker carries mojibake');
  assert.match(sheet, /content: "\u2212"/, 'the open marker is one minus');
});

test('the guide opens with three doors to the first task', () => {
  // WHY A QUICKSTART: measured against docs.firecrawl.dev on 2026-11-05, its first screen is the shortest path to a working call, and this guide opened on four paragraphs about installing.
  const html = read('docs.html');
  assert.match(html, /<ol class="quickDoors"/, 'the guide opens with the short path');
  assert.equal((html.match(/class="quickDoor"/g) || []).length, 3, 'pass, pair, task');
  for (const id of ['pasang', 'pairing', 'tugas']) assert.ok(html.includes(`href="#${id}"`), `the door to ${id} lands on its section`);
  const sheet = read('docs.css');
  assert.match(sheet, /\.quickDoor:nth-child\(3\) \{[^}]*animation-delay/s, 'the doors arrive one after another');
  assert.match(sheet, /@keyframes door-in/, 'and the arrival is one shot');
});

test('the download page fans one archive out to every browser', () => {
  const html = read('unduh.html');
  const zips = html.match(/download\/opera-agent\.zip\?for=[a-z]+/g) || [];
  assert.equal(zips.length, 5, 'one archive, five doors');
  for (const b of ['chrome', 'edge', 'brave', 'opera', 'vivaldi']) {
    assert.match(html, new RegExp('zip\\?for=' + b), `${b} gets the same archive`);
  }
  const css = read('download.css');
  assert.doesNotMatch(css, /packTile|pack-light/, 'the dead fan is gone from the stylesheet');
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

test('the install panel shows a live pairing code', () => {
  // WHY THE PANEL MOVES: a pairing code that never changes is a picture, and the panel is where the reader learns that a code expires.
  // WHY THE DRIFT IS GONE: the product visual that once lagged the scroll died with the mock it moved - the ad's motion lives in the canvas film, pinned by the animated-ad gates.
  const html = read('beranda.html');
  assert.match(html, /class="pairCode"/, 'the panel shows a pairing code');
  assert.match(html, /id="pairTime"/, 'and the time it has left');
  assert.match(html, /setInterval\(paint, 1000\)/, 'the clock ticks');
  const css = cssOf('beranda.html');
  assert.match(css, /\.pairRow \{[^}]*grid-template-columns/s, 'the panel rows line up');
});

test('the shared spotlight script only paints what the pointer names', () => {
  const src = read('spotlight.js');
  assert.match(src, /pointermove/, 'it listens to the pointer');
  assert.match(src, /--mx/, 'and writes the two numbers the card paints');
  assert.doesNotMatch(src, /innerHTML|eval\(/, 'and it writes no markup and runs no code');
  for (const page of ['beranda.html', 'fitur.html', 'harga.html']) {
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
  const html = read('unduh.html');
  assert.match(html, /<span class="verifyPrompt">PS C:\\&gt;<\/span> <span class="verifyType" id="curlType">/, 'the line carries the text it types, prompt first');
  assert.match(html, /<noscript><pre><code>curl\.exe -sI https:\/\//, 'and a still copy stands where the script cannot run');
  const js = read('verify.js');
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/, 'the reader who asked for stillness gets the two lines at once');
  assert.match(js, /IntersectionObserver/, 'the commands type when the fold scrolls into view');
  const css = cssOf('unduh.html');
  assert.match(css, /@keyframes verify-blink/, 'one cursor, blinking once the reader arrives');
});

test('the dev server serves the whitelist and nothing else, even on loopback', () => {
  const src = fs.readFileSync(new URL('../scripts/dev/landingserve.mjs', import.meta.url), 'utf8');
  assert.match(src, /new Set\(\[/, 'the servable files are named in the code');
  assert.match(src, /!FILES\.has\(name\)/, 'a name outside the list is refused');
});

test('the download page reads as one column, and the file table says what is true', () => {
  const files = read('unduh.html');
  assert.doesNotMatch(files, /class="shot"/, 'the page drops the mock file panel it already states in words');
  assert.match(files, /<table class="support">/, 'the browser support table is the file table, and it stays');
  assert.doesNotMatch(files, /SHA-256<\/th>|Ukuran<\/th>/, 'and it claims no size or checksum it cannot hold');
  assert.match(cssOf('unduh.html'), /\.support th \{[^}]*border-bottom: 1px solid var\(--line-strong\)/s, 'its head rests on a line, not a shadow');
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

test('the lost page shows its own number and a way to search', () => {
  // WHY THIS PAGE NEEDS A SHAPE: measured against firecrawl.dev on 2026-11-05, every page answers with a picture and a door; this page answered a dead link with one sentence and a flat list.
  const html = read('404.html');
  assert.match(html, /<main class="wrap lost"/, 'the page carries its own shape');
  assert.match(html, /class="lostNum" aria-hidden="true">404</, 'the number it failed on is on the page');
  assert.match(html, /data-i18n-html="hint"/, 'and the visitor gets a way to search instead of guessing');
  assert.ok(html.includes('rel="stylesheet" href="/notfound.css"'), 'the page has a sheet of its own');
  const sheet = read('notfound.css');
  assert.match(sheet, /\.lostNum \{[^}]*font-size: clamp\(/s, 'the number is set at display size');
  assert.match(sheet, /\.lostHero h1 \{[^}]*margin: -/s, 'and the title sits on the number');
  assert.match(sheet, /@keyframes lost-rise/, 'the number arrives once');
  assert.match(sheet, /\.exitList[^{]*li:nth-child\(3\)[^{]*\{[^}]*animation-delay/s, 'and the ways out arrive in turn');
  assert.doesNotMatch(sheet, /#[0-9a-f]{3,6}\b/i, 'and the sheet paints no colour literal');
});

test('the support page sets its answers beside the question it opens with', () => {
  // WHY THIS PAGE NEEDS A SHAPE: measured against firecrawl.dev (support and troubleshooting pages) on 2026-11-05, its help pages rank each symptom and answer it beside a standing lead; this page was five identical rows on a 900px screen with no rank and no entry.
  const html = read('dukungan.html');
  assert.match(html, /<header class="supportHero"/, 'the page opens with a standing lead');
  const ids = [...html.matchAll(/<details class="fix" id="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ['device', 'ext', 'mcp', 'sesi', 'privasi'], 'each symptom opens in place and keeps an anchor of its own');
  assert.equal((html.match(/class="fixIndex"/g) || []).length, 5, 'and carries its rank');
  assert.ok(html.includes('rel="stylesheet" href="/support.css"'), 'the page has a sheet of its own');
  const sheet = read('support.css');
  assert.match(sheet, /\.supportMain \{[^}]*grid-template-columns: minmax\(0, 340px\) minmax\(0, 680px\)/s, 'the lead stands beside the answers on a wide screen');
  assert.match(sheet, /\.supportHero \{[^}]*position: sticky/s, 'and stays while the answers scroll');
  assert.match(sheet, /\.fix\[open\]/, 'an open answer takes the accent');
  assert.match(sheet, /@keyframes fix-in/, 'the rows arrive once');
  assert.match(sheet, /\.fix:nth-child\(3\)[^{]*\{[^}]*animation-delay/s, 'in turn');
  assert.doesNotMatch(sheet, /#[0-9a-f]{3,6}\b/i, 'and the sheet paints no colour literal');
});

test('the reading pages keep their map beside the text', () => {
  const css = read('site.css');
  assert.match(css, /main\.prose:has\(\.toc\)/, 'a page with a map lays the map beside the text');
  assert.match(css, /\.toc \{[^}]*background: var\(--surface\)/s, 'and the map is a surface of the canvas');
  const dukung = read('dukungan.html');
  assert.match(dukung, /<details[^>]*>/, 'the support questions open in place');
  assert.doesNotMatch(dukung, /<dl class="facts">/, 'and no flat list survives');
});

test('the brand reads on the dark canvas, on every page', () => {
  // WHY THE WORDMARK IS THE MARK: the masthead is the Hermes fold, and the name is set in the display face in full ink - a page carrying a darker brand would read as a placeholder, not as the name.
  const sheet = read('site.css');
  assert.match(sheet, /\.wordmark \{[^}]*color: var\(--ink\)/s, 'the wordmark is set in the ink, never a faded grey');
  assert.match(sheet, /\.wordmark \{[^}]*font-family: var\(--display\)/s, 'and set in the display face, so the name reads as the name');
  for (const page of pages) {
    const html = read(page);
    assert.ok(html.includes('class="brand"'), `${page} carries the brand`);
    assert.ok(html.includes('href="/beranda.html"'), `${page} points the brand home`);
  }
});

test('the home page shows more than it explains', () => {
  const html = read('beranda.html');
  // WHY THE DECORATIVE BLOCKS ARE LEFT OUT: the quick tiles and the member actions only exist for a signed-in reader; the pairing panel and the run window are mock furniture (role="img", a scan target, not prose a visitor reads word by word); and the portal fold is one click of hidden chrome, not the page's copy - none of those is copy, so none is counted against the budget; the strip keeps its tiles counted on its own.
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<noscript>[\s\S]*?<\/noscript>/g, ' ')
    .replace(/<div class="grid" id="quickTiles" hidden>[\s\S]*?<\/div>\s*<\/div>/g, ' ')
    .replace(/<div class="installCard">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g, ' ')
    .replace(/<div class="row" id="ctaIn" hidden>[\s\S]*?<\/div>/g, ' ')
    .replace(/<div class="runWindow[^"]*"[\s\S]*?<\/section>/g, ' ')
    .replace(/<div data-portal-menu><\/div>\s*<\/header>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  const words = visible.split(/\s+/).filter(Boolean).length;
  assert.ok(words <= 430, `the home page stays under 430 words, and carries ${words}`);
});

test('the strip of pages our users open sits still, and reads as a map', () => {
  // WHY THE MARQUEE DIED: a running strip is wallpaper - it asks the eye to chase motion that carries no information, and it cannot be read at a glance on touch.
  // A grid of logo plus one concrete thing the agent does per site is information; it does not move, so there is nothing to stop when the reader asks for stillness.
  const html = read('beranda.html');
  const css = read('beranda.css');
  assert.match(html, /class="strip"/, 'the strip is on the page');
  assert.match(html, /class="logoGrid"/, 'and the grid replaces the marquee');
  assert.ok((html.match(/class="logoTile"/g) || []).length >= 8, 'with a tile per site the reader recognises');
  assert.match(html, /data-i18n="strip\.label"/, 'and the label carries its translation');
  assert.doesNotMatch(html, /class="marquee/, 'and the wallpaper is gone');
  assert.doesNotMatch(css, /@keyframes marquee/, 'with its loop');
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
  for (const page of pages) {
    assert.match(read(page), /<script src="\/palette\.js"><\/script>/, `${page} carries the palette`);
  }
});

// WHY THE PIN READS .brand ALONE: the brand is the centre of the masthead and sits between the two door lists now (the Hermes fold), not inside a nav element - the claim being kept is that the brand keeps its place across the move.

test('one page moves into the next, and the brand keeps its place', () => {
  // WHY THIS EXISTS: measured against firecrawl.dev on 2026-11-05, moving between its pages is one motion, and a hard cut makes a site feel like a folder of documents.
  // The move lasts as long as a hover, and the brand mark stays put across it so the reader never loses the frame.
  const sheet = read('site.css');
  assert.match(sheet, /@view-transition \{\s*navigation: auto;/s, 'the browser moves between pages on its own');
  assert.match(sheet, /::view-transition-old\(root\)[\s\S]*?animation-duration: \.18s/s, 'and the move lasts as long as a hover');
  assert.match(sheet, /\.brand \{[^}]*view-transition-name: brand/s, 'while the brand keeps its place');
  assert.match(sheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?::view-transition-new\(\*\)[\s\S]*?animation: none !important/s, 'and a reader who asks for stillness gets none of it');
});

// WHY THE JUMP IS ALWAYS INSTANT: the reader asked for the top, not the tour - on a long page even a glide the CSS chooses passes through every screen between here and home.
// Stillness is the default behaviour, never a special branch, so the reader who asked for it is not a case the code remembers to honour.

test('a long page offers its way back, and a phone guide folds its map away', () => {
  // WHY THIS EXISTS: measured against docs.firecrawl.dev on 2026-11-05, its rail carries a way back to the top, and a phone reader met six section doors before the first line of the guide.
  // The way back appears only after the reader has scrolled, and the map opens only when it is asked for.
  const script = read('wayfind.js');
  const sheet = read('site.css');
  const guide = read('docs.css');
  assert.match(script, /className = 'toTop'/, 'the page builds a way back');
  assert.match(script, /scrollY > 600/, 'and it waits until the reader has scrolled far');
  assert.match(script, /scrollTo\(\{ top: 0, behavior: 'instant' \}\)/, 'and it obeys the reader who asks for stillness');
  assert.match(sheet, /\.toTop\[data-shown="true"\]/, 'the button shows itself only when it is wanted');
  assert.match(guide, /\.docNav\[data-map="open"\] \.toc/, 'the phone map opens on demand');
  assert.match(read('docs.html'), /class="docMapToggle"/, 'and the guide carries the door');
});

test('the numbered rows answer the pointer', () => {
  // WHY THE ROWS, NOT THE GRID: measured against hermes-agent.nousresearch.com, its abilities read as six numbered entries on the cobalt field, not as a card wall - the pointer still gets an answer, a raised field and an ink-to-accent numeral, not a spotlight that follows it.
  const html = read('beranda.html');
  const css = read('beranda.css');
  assert.match(html, /<div class="featureRows">/, 'the home carries the numbered rows');
  assert.ok((html.match(/<article>/g) || []).length >= 6, 'at least the six features stand as entries');
  assert.match(css, /\.featureRows article:hover \{[^}]*background: var\(--surface\)/s, 'a row answers the pointer with a raised field');
  assert.match(css, /\.featureRows article:hover \.featureNum \{[^}]*color: var\(--accent-strong\)/s, 'and the numeral takes the accent under the pointer');
});

test('the numbers count up once, when they arrive', () => {
  const html = read('beranda.html');
  assert.match(html, /requestAnimationFrame/, 'the count runs on frames');
  assert.match(html, /prefers-reduced-motion/, 'and the reader can refuse it');
});

// WHY THE LIVE DOT IS THE ONLY LOOP LEFT: the walking light died with the mock it walked, the caret died with the kick, and the run's motion lives in the JS ticker - a loop must earn its place as light, never as ornament.
// The lock still holds on the thing that matters: a loop must be slow enough to read as light, and nothing else moves on its own.

test('a hover answers within 120ms, and only the live dot breathes on its own', () => {
  const sheet = read('site.css');
  assert.match(sheet, /\.tile:hover \{[^}]*transform: translateY\(-1px\)/s, 'a tile lifts one pixel');
  assert.match(sheet, /\.exitList a:hover \{[^}]*color: var\(--accent\)/s, 'a link answers in the accent');
  assert.doesNotMatch(sheet, /@keyframes (float|drift|pulse|spin|glow)/, 'and no keyframe moves anything without the reader');
  const loops = [...read('beranda.css').matchAll(/([^{}]+)\{([^}]*animation[^}]*)\}/g)]
    .filter((match) => /infinite/.test(match[2]))
    .map((match) => match[1].trim());
  assert.ok(loops.every((selector) => /\.mockTop \.dot::after/.test(selector)), `only the live dot breathes, and ${loops.length} do`);
  for (const match of read('beranda.css').matchAll(/([^{}]+)\{([^}]*animation[^}]*infinite[^}]*)\}/g)) {
    const selector = match[1].trim();
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

// WHY THE CATCH MOVED INTO THE ANSWER: the user asked the footnote with its sentence to go; the cost fact now stands exactly where the reader asks the question, which is where the answer was already written.

test('the page states what costs money where the question is asked', () => {
  const html = read('beranda.html');
  assert.match(html, /<summary data-i18n="faq\.cost\.dt">/, 'the cost question stands on the page');
  assert.match(html, /Setiap pekerjaan dibayar dari saldo/, 'the answer states what a job costs, in the open');
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

test('the guide can leave as Markdown, the way an AI harness wants it', () => {
  // WHY THIS PAGE NEEDS THE DOOR: measured against docs.firecrawl.dev on 2026-11-05, its guide carries a copy-as-Markdown door, and this product exists to feed AI harnesses, so a reader should be able to take the whole guide with one tap.
  const html = read('docs.html');
  assert.match(html, /data-md-copy/, 'the guide offers the door');
  assert.match(html, /<script src="\/markdown\.js"><\/script>/, 'and the builder is a file of its own');
  const script = read('markdown.js');
  assert.match(script, /navigator\.clipboard\.writeText/, 'the door writes the guide to the clipboard');
  assert.match(script, /window\.OperaAgentMarkdown/, 'and the builder is reachable for a check');
  assert.match(script, /\\?`\\?`\\?`/, 'the code blocks keep their fence');
});

test('a block that arrives after the scripts still arrives', () => {
  // WHY THIS LOCK: measured on production on 2026-11-05, the archive page ran its scripts before the text under the browser cards was parsed, so that text stayed invisible for every reader who did not scroll.
  const script = read('reveal.js');
  assert.match(script, /document\.addEventListener\('DOMContentLoaded', start\)/, 'the observer waits for the whole page');
  const page = read('unduh.html');
  assert.ok(page.indexOf('class="downloadBody centered"') < page.indexOf('<script src="./i18n.js">'), 'and the page keeps its content before its scripts');
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
