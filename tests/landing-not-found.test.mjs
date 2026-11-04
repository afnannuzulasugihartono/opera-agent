// @last-edited: 2026-11-04 UTC+7.
// @title: landing-not-found — a lost visitor gets the site, not a host error page.
// @state: the 404 page exists, and Cloudflare serves it for unknown paths.
// @dependencies: test, assert, fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('landing/404.html', root), 'utf8');

test('a wrong path lands on the site instead of a host error page', () => {
  assert.ok(fs.existsSync(new URL('landing/404.html', root)), 'the 404 page ships');
  const paths = fs.readFileSync(new URL('landing/_headers', root), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && !/^\s/.test(l));
  assert.doesNotMatch(paths.join(' '), /\*/, 'no wildcard claims paths that do not exist');
});

test('the 404 page helps instead of apologising', () => {
  assert.match(html, /<html lang="id"/, 'the language is declared');
  assert.match(html, /<main/, 'a main landmark exists');
  assert.match(html, /<footer/, 'the footer exists');
  assert.match(html, /beranda\.html/, 'the home page is one click away');
  assert.match(html, /unduh\.html/, 'the download page is one click away');
  assert.match(html, /index\.html/, 'the sign-in page is one click away');
  assert.match(html, /akun\.html/, 'the account page is one click away');
  const noScript = html.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.ok(noScript.replace(/<[^>]+>/g, ' ').trim().length > 60, 'it says something useful without script');
});