// @last-edited: 2026-10-10 UTC+7.
// @title: landing-company — the site reads as a real company site.
// @state: red first: no favicon, mismatched footer, no crawler files, stale invite-only copy.
// @dependencies: test, assert, fs.

// A company site is trusted before it is read: every tab shows its mark, every footer offers the same doors, crawlers are told what exists, shared links carry a title, and the legal pages match the live product.
// This site failed all five: nine heads with no icon, unduh's footer missing two links, no robots.txt or sitemap, no share tags, and three pages claiming invite-only access while Auth answers disable_signup:false.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const pages = ['beranda.html', 'akun.html', 'index.html', 'dashboard.html', 'unduh.html', 'unduh-berkas.html', 'privasi.html', 'syarat.html', '404.html', 'fitur.html', 'dukungan.html'];

test('every head carries the mark, so no tab looks unfinished', () => {
  for (const page of pages) {
    const html = read(`landing/${page}`);
    assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/, `${page} embeds its own icon`);
  }
  const icons = new Set(pages.map((page) => read(`landing/${page}`).match(/<link rel="icon" href="([^"]+)"/)[1]));
  assert.equal(icons.size, 1, 'one mark everywhere, not nine variations');
});

test('every footer offers the same doors', () => {
  const links = (page) => [...read(`landing/${page}`).match(/<footer[\s\S]*?<\/footer>/)[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const shared = links('beranda.html');
  for (const page of pages) {
    assert.deepEqual(links(page), shared, `${page} ends like every other page`);
  }
  for (const door of ['./akun.html', './dashboard.html', './privasi.html', './syarat.html']) {
    assert.ok(shared.includes(door), `the footer reaches ${door}`);
  }
});

test('crawlers are told what exists', () => {
  const robots = read('landing/robots.txt');
  assert.match(robots, /^User-agent: \*/m, 'robots speaks to every crawler');
  assert.match(robots, /Sitemap: https:\/\/opera-agent\.pages\.dev\/sitemap\.xml/, 'and names the map');
  const map = read('landing/sitemap.xml');
  for (const path of ['', '/akun', '/beranda', '/dashboard', '/unduh', '/unduh-berkas', '/privasi', '/syarat', '/fitur', '/dukungan', '/oauth/consent']) {
    assert.ok(map.includes(`https://opera-agent.pages.dev${path}`), `the map lists ${path || '/'}`);
  }
  assert.doesNotMatch(map, /404/, 'and not the not-found page');
});

test('a shared link carries a title, not a bare URL', () => {
  for (const page of pages) {
    const html = read(`landing/${page}`);
    assert.match(html, /<meta property="og:type" content="website"/, `${page} names its share type`);
    assert.match(html, /<meta property="og:title" content="[^"]+"/, `${page} shares a titled card`);
    assert.match(html, /<meta property="og:site_name" content="Opera Agent"/, `${page} cards carry the brand`);
    assert.match(html, /<meta property="og:locale" content="id_ID"/, `${page} shares in its own language`);

    assert.match(html, /<meta property="og:url" content="https:\/\/opera-agent\.pages\.dev\/[^"]*"/, `${page} names the address the card points at`);
  }
});

test('every page renders in standards mode with its own theme color', () => {

  const raw = (page) => fs.readFileSync(new URL(`landing/${page}`, root), 'utf8');
  for (const page of [...pages, 'oauth/consent.html']) {
    const full = raw(page);
    const head = full.slice(0, full.toLowerCase().indexOf('<!doctype html>')).replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(head, /\S/, `${page} has no text before the doctype`);
    assert.match(full, /<meta name="theme-color" content="#0b0d10"/, `${page} tints the browser chrome`);
  }
});

test('every nav marks the page being read', () => {

  const marked = {
    'beranda.html': './beranda.html',
    'akun.html': './akun.html',
    'dashboard.html': './dashboard.html',
    'unduh.html': './unduh.html',
    'unduh-berkas.html': './unduh.html',
    'privasi.html': './privasi.html',
    '404.html': './beranda.html',
    'fitur.html': './fitur.html',
    'dukungan.html': './dukungan.html'
  };
  for (const [page, self] of Object.entries(marked)) {
    const nav = read(`landing/${page}`).match(/<nav>[\s\S]*?<\/nav>/)[0];
    assert.ok(nav.includes(`href="${self}" aria-current="page"`), `${page} marks ${self} current`);
  }
});

test('no page claims invite-only access while sign-up stands open', () => {

  const copy = (page) => read(`landing/${page}`).replace(/<!--[\s\S]*?-->/g, '');
  for (const page of ['index.html', 'syarat.html', 'beranda.html']) {
    assert.doesNotMatch(copy(page), /undangan/i, `${page} no longer rations access that is open`);
  }
  assert.match(copy('index.html'), /Daftar terbuka/, 'the sign-in page says what is true');
  assert.match(copy('syarat.html'), /Akses terbuka/, 'and so do the terms');
});

test('no page points at support that does not exist', () => {

  const index = read('landing/beranda.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(index, /bertanya ke dukungan/, 'the FAQ does not promise a help desk');
  assert.doesNotMatch(index, /lewat kontak/, 'and the exit row does not point at one either');
  const privasi = read('landing/privasi.html');
  assert.match(privasi, /<h2[^>]*>Kontak<\/h2>/, 'the privacy contact section stays');
  assert.doesNotMatch(privasi, /balas dari akun/, 'but it no longer invents a reply channel');
  assert.match(privasi, /\.\/akun\.html/, 'it points at the self-service that exists');
});

test('no page sells billing that does not exist', () => {

  const index = read('landing/beranda.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(index, /bayar per hasil/i, 'no per-result billing is promised');
  assert.match(index, /penyedia model Anda|penyedia Anda/, 'the reader pays their provider, nobody else');
});
