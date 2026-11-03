// @last-edited: 2026-11-03 UTC+7.
// @title: nav — one nav row for every page, rewritten in place.
// @state: four doors and one action, measured against opencode.ai on 2026-11-03.
// @dependencies: node:fs, node:url.

// WHY THIS SCRIPT EXISTS.
// Eleven pages carry the same nav, and eleven hand edits is how a row drifts back to seven links.
// This writes the one row the benchmark asks for, and refuses a page whose nav it cannot recognise.
// A page that carries no English dictionary gets the same row without translation keys, so no toggle promises a translation the page cannot make.

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
  'dukungan.html': 'dukungan.html'
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
  ['/dukungan.html', 'nav.support', 'Dukungan'],
  ['/harga', 'nav.price', 'Harga']
].map(([href, key, label]) => {
  const mark = translate && current && href === `/${current}` ? ' aria-current="page"' : '';
  const lang = translate ? ` data-i18n="${key}"` : '';
  return `<a href="${href}"${lang}${mark}>${label}</a>`;
}).join('\n        ');

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
  const rebuilt = `<nav>\n        ${brand}\n        ${doors(door, translate)}\n        ${lang ? `${lang}\n        ` : ''}${action}\n      </nav>`;
  writeFileSync(path, html.replace(nav, rebuilt));
  console.log(`${page}: nav rewritten${translate ? '' : ' without translation keys'}`);
}
