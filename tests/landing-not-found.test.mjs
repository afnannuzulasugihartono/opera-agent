// @last-edited: 2026-10-10 UTC+7.
// @title: landing-not-found — a lost visitor gets the site, not a host error page.
// @state: failing first: no 404 page exists, and the host answers with its own.
// @dependencies: test, assert, fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('landing/404.html', root), 'utf8');
const worker = fs.readFileSync(new URL('landing/_worker.js', root), 'utf8');

test('a wrong path lands on the site instead of a host error page', () => {
  assert.ok(fs.existsSync(new URL('landing/404.html', root)), 'the site keeps its own 404 at the root, where the host looks for it');
  assert.match(worker, /env\.ASSETS\.fetch\(request\)/, 'and every other path is served as an asset');
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