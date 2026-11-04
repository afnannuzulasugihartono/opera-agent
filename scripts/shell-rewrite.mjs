// @last-edited: 2026-11-05 UTC+7.
// @title: shell - the chrome every page carries: one nav row, the search door beside it, and the script that opens the palette.
// @state: a writer, not a build; it rewrites the pages in place and refuses a page whose nav it cannot recognise.
// @dependencies: node:fs, node:url, node:path.

// WHY THIS SCRIPT EXISTS.
// Thirteen pages carry the same nav, and thirteen hand edits is how a row drifts back to seven links.
// This writes the one row every page shares, the search door beside it, and the palette script that answers the door.
// A page that carries no English dictionary gets the same row without translation keys, so no toggle promises a translation the page cannot make.
// WHY THE SEARCH DOOR IS WRITTEN HERE AND NOT IN THE PAGES: a door that exists on one page and not another is a door nobody can find.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../landing/', import.meta.url));
const pages = readdirSync(root).filter((name) => name.endsWith('.html')).concat(['oauth/consent.html']);

// WHY EACH PAGE SAYS WHICH DOOR IT IS: a nav marks the door that leads to the page being read, and a page with no door of its own marks the brand, which is where it sits.
// WHY THE MARK SITS LAST ON THE BRAND: class and href stay first, so a reader and a test both find the link by its href before they find the mark.

const markBrand = (brand) =>
  brand
    .replace(/ aria-current="page"/g, '')
    .replace(/^<a class="brand"([^>]*)>/, '<a class="brand"$1 aria-current="page">');

// WHY THE ACTION IS NEVER MARKED: aria-current names navigation, not a button that leaves the site for the sign-in page.

const DOOR_OF = {
  'fitur.html': 'fitur.html',
  'unduh.html': 'unduh.html',
  'unduh-berkas.html': 'unduh.html',
  'dukungan.html': 'dukungan.html',
  'docs.html': 'docs.html'
};

// WHY THE BRAND IS MARKED ONCE AND ROOTED: a rerun reads a brand that already carries the mark, markBrand clears it before it writes it back, and every door beside it is root-relative, so the brand is too.

const brandOf = (nav, door) => {
  const brand = /<a class="brand"[^>]*>[\s\S]*?<\/a>/.exec(nav)?.[0] ?? '';
  const rooted = brand.replace(/href="(?:\.\/)?beranda\.html"/, 'href="/beranda.html"');
  return door === null ? markBrand(rooted) : rooted;
};

const doors = (current, translate) => [
  ['/fitur.html', 'nav.features', 'Fitur'],
  ['/unduh.html', 'nav.download', 'Unduh'],
  ['/harga', 'nav.price', 'Harga'],
  ['/dukungan.html', 'nav.support', 'Dukungan'],
  ['/docs.html', 'nav.docs', 'Docs']
].map(([href, key, label]) => {
  const mark = translate && current && href === `/${current}` ? ' aria-current="page"' : '';
  const lang = translate ? ` data-i18n="${key}"` : '';
  return `<a href="${href}"${lang}${mark}>${label}</a>`;
}).join('\n        ');

// WHY THE DOOR NAMES ITS KEY IN ITS LABEL: the visible text says Ctrl K, and an accessible name that leaves that text out reads as a different control from the one on the screen.

const SEARCH = '<button class="navSearch" type="button" aria-label="Cari halaman Ctrl K" aria-keyshortcuts="Control+K Meta+K"><svg class="navSearchIcon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M10.6 10.6 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg><kbd class="navSearchKey">Ctrl K</kbd></button>';

// WHY THE SCRIPT FOLLOWS THE WAYFINDER: both are shell scripts that answer a reader, and the wayfinder is the last external script every page already loads.

const withPaletteScript = (html) => {
  if (html.includes('<script src="/palette.js"></script>')) return html;
  const anchor = /^([ \t]*)<script src="\/wayfind\.js"><\/script>/m;
  if (anchor.test(html)) return html.replace(anchor, (line, space) => `${line}\n${space}<script src="/palette.js"></script>`);
  return html.replace('</body>', '  <script src="/palette.js"></script>\n</body>');
};

// WHY THE HEADER LIST NAMES THE SCRIPT: a page that loads a file it does not name is a page whose header lies about what it needs.

const withPaletteDependency = (html) => {
  const header = /<!-- @dependencies: ([^>]*?) -->/.exec(html);
  if (!header || header[1].includes('palette.js')) return html;
  const list = header[1].replace(/\.\s*$/, '');
  return html.replace(header[0], `<!-- @dependencies: ${list}, palette.js. -->`);
};

for (const page of pages) {
  const path = join(root, page);
  const html = readFileSync(path, 'utf8');
  const nav = /<nav>[\s\S]*?<\/nav>/.exec(html)?.[0];
  if (!nav) {
    console.log(`${page}: no nav, skipped`);
    continue;
  }

  const translate = html.includes('id="i18n-dict"');
  const door = DOOR_OF[page] ?? null;
  const cta = /<a class="navCta"[^>]*>[\s\S]*?<\/a>/.exec(nav)?.[0] ?? '';
  const lang = /<span class="lang"[\s\S]*?<\/span>/.exec(nav)?.[0] ?? '';
  const brand = brandOf(nav, door);
  if (!brand || !cta) {
    console.log(`${page}: nav without a brand or a call to action, skipped`);
    continue;
  }

  const action = translate
    ? cta.replace(/ href="[^"]*"/, ' href="/"').replace(' aria-current="page"', '')
    : '<a class="navCta" href="/">Masuk</a>';
  const rebuilt = `<nav>\n        ${brand}\n        ${doors(door, translate)}\n        ${lang ? `${lang}\n        ` : ''}${SEARCH}\n        ${action}\n      </nav>`;
  const rewritten = withPaletteDependency(withPaletteScript(html.replace(nav, rebuilt)));
  writeFileSync(path, rewritten);
  console.log(`${page}: shell rewritten${translate ? '' : ' without translation keys'}`);
}
