// @last-edited: 2026-10-10 UTC+7.
// @title: landing-not-found — a lost visitor gets the site, not a host error page.
// @state: failing first: no 404 page exists, and Vercel answers with its own.
// @dependencies: test, assert, fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('landing/404.html', root), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('landing/vercel.json', root), 'utf8'));

test('a wrong path lands on the site instead of a host error page', () => {
  const rewrites = vercel.rewrites || [];
  assert.ok(rewrites.length, 'the site needs a rewrite so unknown paths serve its own 404');
  const catchAll = rewrites.find((r) => r.source === '/(.*)' && r.destination === '/404.html');
  assert.ok(catchAll, 'every unknown path rewrites to the site 404');

  assert.deepEqual(rewrites, [{ source: '/(.*)', destination: '/404.html' }], 'exactly one catch-all rewrite, nothing before it');
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