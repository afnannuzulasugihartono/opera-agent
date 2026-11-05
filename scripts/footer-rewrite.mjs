// @last-edited: 2026-11-05 UTC+7.
// @title: footer — one column footer for every page, rewritten in place.
// @state: four columns, one rights line and one source door, measured against firecrawl.dev on 2026-11-04.
// @dependencies: node:fs, node:url, node:path.

// WHY THIS SCRIPT EXISTS.
// Fourteen pages carry the same footer, and fourteen hand edits are how the doors drift apart.
// This writes the one column footer the benchmark asks for, and refuses a page whose footer it cannot recognise.
// A page that carries no English dictionary gets the same columns without translation keys, so no toggle promises a translation the page cannot make.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../landing/', import.meta.url));
const pages = readdirSync(root).filter((name) => name.endsWith('.html')).concat(['oauth/consent.html']);

// WHY THE COLUMNS HOLD THESE DOORS: a reader arrives with one of four questions — what is this, what does it do, how do I get in, and what does it cost me in trust.
// One column per question answers all four without a sentence.
// WHY THE ORDER NEVER CHANGES: every page ends the same way, and a reader who lands on the support page sees the same map as a reader who lands on the home page.

const COLUMNS = [
  {
    title: { id: 'Produk', key: 'footer.product', en: 'Product' },
    doors: [
      { href: 'beranda.html', key: 'footer.home', id: 'Beranda', en: 'Home' },
      { href: 'fitur.html', key: 'footer.features', id: 'Fitur', en: 'Features' },
      { href: 'unduh.html', key: 'footer.download', id: 'Unduh', en: 'Download' },
      { href: 'docs.html', key: 'footer.docs', id: 'Docs', en: 'Docs' }
    ]
  },
  {
    title: { id: 'Akun', key: 'footer.account', en: 'Account' },
    doors: [
      { href: 'index.html', key: 'footer.signin', id: 'Masuk', en: 'Sign in' },
      { href: 'akun.html', key: 'footer.account', id: 'Akun', en: 'Account' },
      { href: 'dashboard.html', key: null, id: 'Dashboard', en: 'Dashboard' }
    ]
  },
  {
    title: { id: 'Legal', key: 'footer.legal', en: 'Legal' },
    doors: [
      { href: 'privasi.html', key: 'footer.privacy', id: 'Privasi', en: 'Privacy' },
      { href: 'syarat.html', key: 'footer.terms', id: 'Syarat', en: 'Terms' },
      { href: 'dukungan.html', key: 'footer.support', id: 'Dukungan', en: 'Support' }
    ]
  }
];

const RIGHTS = { id: '© 2026 Opera Agent. Hak cipta dilindungi.', key: 'footer.rights', en: '© 2026 Opera Agent. All rights reserved.' };

// WHY THE SOURCE STANDS UNDER THE BRAND: the site asks for six browser permissions, so the reader is owed the place where the code is read.

const SOURCE = { href: 'https://github.com/afnannuzulasugihartono/opera-agent', key: 'footer.source', id: 'Kode sumber', en: 'Source code' };

// WHY THE CONSENT PAGE KEEPS ROOT-RELATIVE DOORS: it lives one folder down, and a relative door there would point at a file that does not exist.

const prefix = (page, href) => (page === 'oauth/consent.html' ? `/${href}` : `./${href}`);

const door = (page, item, translate) => {
  const lang = translate && item.key ? ` data-i18n="${item.key}"` : '';
  return `<a href="${prefix(page, item.href)}"${lang}>${item.id}</a>`;
};

const column = (page, spec, translate) => {
  const title = translate
    ? `<h3 data-i18n="${spec.title.key}">${spec.title.id}</h3>`
    : `<h3>${spec.title.id}</h3>`;
  const doors = spec.doors.map((item) => door(page, item, translate)).join('\n          ');
  return `      <div class="footCol">
        ${title}
        <span class="doors">
          ${doors}
        </span>
      </div>`;
};

const build = (page, translate) => {
  const rights = translate
    ? `<span class="footNote" data-i18n="${RIGHTS.key}">${RIGHTS.id}</span>`
    : `<span class="footNote">${RIGHTS.id}</span>`;
  const source = translate
    ? `<span class="doors"><a href="${SOURCE.href}" data-i18n="${SOURCE.key}">${SOURCE.id}</a></span>`
    : `<span class="doors"><a href="${SOURCE.href}">${SOURCE.id}</a></span>`;
  const columns = COLUMNS.map((spec) => column(page, spec, translate)).join('\n');
  return `    <footer>
    <div class="wrap footGrid">
      <div class="footCol">
        <span class="footBrand">Opera Agent</span>
        ${rights}
        ${source}
      </div>
${columns}
    </div>
  </footer>`;
};

// WHY THE DICT IS PATCHED TEXTUALLY: the dictionary is a JSON block a person reads in the page source, and reserialising it would rewrite every line of every page.

const addKeys = (html, translate) => {
  if (!translate) return html;
  const wanted = new Map();
  for (const spec of COLUMNS) {
    wanted.set(spec.title.key, spec.title.en);
    for (const item of spec.doors) if (item.key) wanted.set(item.key, item.en);
  }
  wanted.set(RIGHTS.key, RIGHTS.en);
  wanted.set(SOURCE.key, SOURCE.en);

  const block = /<script type="application\/json" id="i18n-dict">([\s\S]*?)<\/script>/.exec(html);
  if (!block) return html;
  let body = block[1];
  for (const [key, en] of wanted) {
    if (new RegExp(`"${key.replace('.', '\\.')}"\\s*:`).test(body)) continue;
    body = body.replace(/("en"\s*:\s*\{)/, `$1\n      "${key}": "${en.replace(/"/g, '\\"')}",`);
  }
  return html.replace(block[0], `<script type="application/json" id="i18n-dict">${body}</script>`);
};

for (const page of pages) {
  const path = join(root, page);
  const html = readFileSync(path, 'utf8');
  const footer = /^[ \t]*<footer>[\s\S]*?<\/footer>/m.exec(html)?.[0];
  if (!footer) {
    console.log(`${page}: no footer, skipped`);
    continue;
  }

  const translate = html.includes('id="i18n-dict"');
  const rebuilt = addKeys(html.replace(footer, build(page, translate)), translate);
  writeFileSync(path, rebuilt);
  console.log(`${page}: footer rewritten${translate ? '' : ' without translation keys'}`);
}
