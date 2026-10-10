// @last-edited: 2026-10-06 16:20 UTC+7.
// @title: landing-visual — the site looks finished on every screen.
// @state: red first: gibberish hero copy, nested sections, overflowing nav and code pills.
// @dependencies: test, assert, fs.

// Company grade is decided in five seconds on a phone: a hero that shows the
// product, copy without a broken sentence, and nothing spilling out of its box.
// Military grade adds validity underneath it. Measured in Chromium screenshots:
// the hero was text-only with "Sembilan dua tool", the FAQ section opened inside
// the privacy section without closing it, the seven-item nav wrapped into two
// ragged lines at 390px, a code pill crossed its card border, and unduh broke
// code mid-word with word-break:break-all.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const pages = ['beranda.html', 'akun.html', 'index.html', 'dashboard.html', 'unduh.html', 'unduh-berkas.html', 'privasi.html', 'syarat.html', '404.html', 'oauth/consent.html', 'fitur.html', 'dukungan.html'];

test('the hero sells the product instead of apologizing for it', () => {
  const html = read('beranda.html');
  assert.doesNotMatch(html, /Sembilan dua/, 'the broken sentence is gone');
  assert.match(html, /39 tool/, 'the tool count is stated as a number');
  assert.match(html, /class="eyebrow"/, 'an eyebrow names the release above the headline');
  assert.match(html, /id="demo"/, 'a product visual answers what the words claim');
  assert.match(html, /id="heroStats"/, 'numbers sit under the call to action, not in prose');
});

test('the hero stats equal live source counts, never stale copy', () => {
  // WHY recomputed: the stat once read 37 while the prose beside it read 39,
  // because only the prose was pinned. Both numbers now derive from the same
  // sources of truth the unduh hub test uses.
  const html = read('beranda.html');
  const mcp = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  const tools = (mcp.match(/registerTool\("/g) || []).length;
  const proto = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  const specs = proto.slice(proto.indexOf('METHOD_SPECS = Object.freeze({'), proto.indexOf('});', proto.indexOf('METHOD_SPECS')));
  const prims = (specs.match(/^\s*'[a-z][a-z0-9_.]*': \{ timeoutMs:/gm) || []).length;
  assert.ok(tools > 30 && prims >= 28, `sanity: ${tools} tools, ${prims} primitives`);
  const block = /<dl class="heroStats" id="heroStats">([\s\S]*?)<\/dl>/.exec(html)[1];

  // WHY tag and content separately: each label carries a data-i18n attribute,
  // so a verbatim whole-tag match would break on the attribute rather than on
  // a lost number or a lost label.
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

test('the nav survives a 390px phone without wrapping ragged', () => {
  for (const page of pages) {
    const css = read(page);
    assert.match(css, /white-space:\s*nowrap/, `${page} keeps each nav item on one line`);
  }
  const index = read('beranda.html');
  assert.match(index, /overflow-x:\s*auto/, 'the row scrolls instead of wrapping');
});

test('a code pill never crosses its card border or breaks mid-word', () => {
  for (const page of pages) {
    assert.doesNotMatch(read(page), /word-break:\s*break-all/, `${page} breaks at word bounds, not mid-token`);
  }
  assert.match(read('beranda.html'), /box-decoration-break:\s*clone/, 'a wrapped pill keeps both halves boxed');
});

test('the marked nav item is visible, not metadata only', () => {
  for (const page of ['beranda.html', 'akun.html', 'dashboard.html', 'unduh.html', 'privasi.html', '404.html']) {
    assert.match(read(page), /a\[aria-current="page"\]/, `${page} styles the current item`);
  }
});

test('the phone nav hints that it scrolls instead of clipping mid-word', () => {
  // WHY this lock: at 390px the seventh item rendered as a cut-off "I" with no
  // affordance, so the last door looked broken rather than scrollable. A fade on
  // the trailing edge says there is more row to the right.
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /mask-image:\s*linear-gradient\(to right/, `${page} fades the nav edge on a phone`);
  }
});

test('the hero carries exactly one filled action, and it is the download', () => {
  // WHY this lock exists: the filled hero button used to be "Instalasi", pointing at
  // #install, which duplicated the "Unduh" button one line below. The duplicate was
  // cut — correctly — and the cut took the fill with it, because "Unduh" was a ghost
  // button. The hero was left with two ghost actions and no filled one, and the whole
  // suite stayed green, because nothing had ever asserted that a hero HAS a filled
  // action. A screenshot caught it; a measurement should have.
  //
  // Cohere's rule in gates.lock: the hero carries THE action, and it is the filled
  // one. So the claim is pinned — exactly one filled action in the hero, and it opens
  // the download.
  const hero = read('beranda.html').match(/<section class="hero[^"]*">[\s\S]*?<\/section>/)[0];

  // WHY the row and not the hero: the hero carries BOTH cta rows — #ctaOut for a
  // stranger and #ctaIn for a signed-in reader — and only one of them is ever
  // shown. Scoping the count to the hero would read the hidden member row as a
  // second filled action and fail on correct markup. The claim is per row: each
  // row offers one filled action, because a row of two equal ghosts is not an
  // action at all.

  const row = (id) => new RegExp(`<div class="row" id="${id}"[^>]*>([\\s\\S]*?)</div>`).exec(hero)[1];
  const filledIn = (id) => [...row(id).matchAll(/<a\b[^>]*class="btn primary"[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(filledIn('ctaOut'), ['./unduh.html'], 'a stranger is offered exactly one filled action, the download');
  assert.deepEqual(filledIn('ctaIn'), ['./dashboard.html'], 'a member is offered exactly one filled action, the dashboard');
});

test('the hero states each number once', () => {
  // WHY this lock: the paragraph said "26 aksi yang diizinkan" and the next line
  // said "26 primitive" — the same number for two nouns, so neither meant
  // anything. Prose stays qualitative; numbers live in the stats row alone.
  // WHY it is now an absence lock and not a presence lock: the hero carried a
  // 31-word paragraph restating 39, 28 and five, directly above the stats row that
  // prints all three. Pinning "the count lives in one line" would have kept both
  // copies alive forever. The stronger claim is that the hero's PROSE names no count
  // at all — the stats row is then the only place the hero prints a number, and the
  // sibling lock below proves those numbers equal the source.
  // WHY the open class: the marketing hero carries a second, opt-in class for the
  // full-height treatment in site.css, and this lock is about what the hero SAYS —
  // the numbers appear once — not about the class list that styles it.
  const hero = read('beranda.html').match(/<section class="hero[^"]*">[\s\S]*?<\/section>/)[0];
  const prose = hero
    .replace(/<dl class="heroStats"[\s\S]*?<\/dl>/, '')
    .replace(/<div class="demo"[\s\S]*?<\/div>\s*<\/div>/, '');
  assert.doesNotMatch(prose, /26 aksi/, 'no second 26 with another noun');
  assert.doesNotMatch(prose, /\d+\s+(tool|primitive|izin|aksi|permission)/i, 'the hero prose names no count at all');
  assert.match(hero, /tanpa eksekusi skrip sembarangan/, 'the prose keeps its promise');
});

test('no script renames a link that is not there', () => {
  // WHY this lock: a script retitled the header Masuk link with a dot for signed-in
  // readers, but the header nav holds no Masuk link — it guards on null and does
  // nothing. Dead code that describes a behavior is a lie waiting to be believed.
  assert.doesNotMatch(read('beranda.html'), /Akun ●/, 'the dead rename is gone');
});

test('the provider buttons show their marks, not bare text', () => {
  const html = read('index.html');
  assert.match(html, /id="googleButton"[^>]*>[\s\S]*?<svg/, 'Google carries its mark inside the button');
  assert.match(html, /id="githubButton"[^>]*>[\s\S]*?<svg/, 'GitHub carries its mark inside the button');
});

test('the 404 exits are real doors, counted honestly', () => {
  // WHY this lock: the page promises ways out, and a tile that looks like a card
  // but goes nowhere is the one lie a lost visitor cannot forgive. Counted too:
  // the copy said four while five tiles stood under it.
  const html = read('404.html');
  const tiles = [...html.matchAll(/<a class="tile" href="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(tiles.length >= 4, 'the exits exist as links, not divs');
  const words = { 4: 'Empat', 5: 'Lima', 6: 'Enam' };
  assert.match(html, new RegExp(`${words[tiles.length]} jalan keluar`), 'the copy counts what stands under it');
  assert.match(html, /\.tile:hover/, 'a tile answers the hover, so it reads clickable');
});

test('the legal pages open with a map, not a wall', () => {
  // WHY this lock: five h2s with no way to jump is a wall of text. A three-line
  // table of contents costs nothing and a company policy page always has one.
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
  // WHY this lock: a signed-in reader landing on home got the same acquisition
  // hero — install buttons for an installed product — because the page could not
  // tell them apart without phoning home, and phoning home is forbidden on the
  // page where the model key is typed. localStorage presence is enough to swap
  // the actions; the name is not shown because it is not known without network,
  // and an invented greeting would be the lie this file exists to prevent.
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
  // WHY this lock: the storefront headline set at the same size as section
  // titles reads as another settings page. One display scale, used once, says
  // which page sells and which pages work.
  // WHY this lock: the storefront headline set at the same size as section
  // titles reads as another settings page. One display scale, used once, says
  // which page sells and which pages work. Re-scaled on 2026-10-06 to the
  // apple.com grade -- 84px ceiling on desktop, sections at a 44px ceiling and
  // 96px of air -- while the 40px floor stays, because at 320px the longest
  // word in the headline ("mengemudikan") measures 280px and a taller floor
  // pushes the page 24px past the screen. Measured in Chromium at 320px.
  const html = read('beranda.html');
  assert.match(html, /clamp\(40px, 7\.5vw, 84px\)/, 'the headline spans display sizes');
  assert.match(html, /h2 \{[^}]*font-size: clamp\(30px, 4vw, 44px\)/, 'sections step down to a clear second rank');
  assert.match(html, /section \{[^}]*padding: 96px 0/, 'and breathe around each idea');
});

test('buttons are pills on every surface that has them', () => {
  // WHY pills and not slightly rounder rectangles: a half-measure reads as an
  // accident. One radius on every control is the standard; the number is
  // deliberately larger than any button so the shape never depends on height.
  for (const page of ['beranda.html', 'akun.html', 'dashboard.html', 'unduh.html', 'oauth/consent.html']) {
    const html = read(page);
    assert.match(html, /\.btn \{[^}]*border-radius: 980px/, `${page} pills its buttons`);
  }
  const auth = read('index.html');
  assert.match(auth, /\.provider \{[^}]*border-radius: 980px/, 'provider entries match');
  assert.match(auth, /button \{[^}]*border-radius: 980px/, 'and so does the submit');
});

test('the hero carries its footnote instead of hiding the catch', () => {
  // WHY this lock: "Gratis dipakai" in the eyebrow without the model-cost
  // sentence beside the button reads as free-everything. Apple prints the
  // asterisk; this prints the one line, in 12.5px muted, where the click is.
  const html = read('beranda.html');
  assert.match(html, /class="footnote"/, 'the line has an element');
  assert.match(html, /Model ditagih penyedia Anda/, 'stating the only money that moves');
});

test('motion is an enhancement, never the content', () => {
  // WHY this lock: hiding sections until scroll means no-JS, slow-JS, and
  // reduced-motion readers get a blank page that tests still call green. The
  // gate class goes on <html> first, so every reveal rule requires it, and the
  // media query deletes the motion for those who asked.
  const html = read('beranda.html');
  assert.match(html, /documentElement\.classList\.add\('js'\)/, 'JS announces itself before anything hides');
  assert.match(html, /html\.js \.reveal/, 'hiding requires that announcement');
  assert.match(html, /prefers-reduced-motion/, 'and the motion bows out when asked');
  assert.match(html, /IntersectionObserver/, 'one observer per page, not per pixel');

  // WHY this second half: nothing scrolls a print preview, so every section below
  // the first printed blank, and a page that hides itself from being printed is
  // not motion worth having. Measured in Chromium with print media emulated:
  // all five sections read `opacity: 0` until this rule existed.
  assert.match(html, /@media print\s*{[^}]*\.reveal[^}]*opacity:\s*1/s,
    'print shows every section, or the motion has hidden the page from being read');
});

test('nothing spills out of a 320px screen', () => {
  // WHY 320 and not 390: the area rules promise readable at 320px, and 390 is
  // where this was last measured. Measured overflow at 320 before these fixes:
  // the footer ran 32px past the screen on all eight pages, because the six
  // doors are written with no whitespace between their tags and an inline row
  // of anchors has no break opportunity; and unduh ran 662px past it, because
  // `pre` is white-space: pre and outranks the wrap on the code inside it.
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /\.doors\s*{[^}]*flex-wrap:\s*wrap/s, `${page}: the footer row wraps`);
    assert.doesNotMatch(html, /footer a \{[^}]*margin-right/s, `${page}: no margin, which cannot wrap`);
  }
  const unduh = read('unduh.html');
  assert.match(unduh, /pre\s*{[^}]*white-space:\s*pre-wrap/s,
    'the checksum command wraps inside its box instead of off the screen');
});
