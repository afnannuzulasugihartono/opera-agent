// @last-edited: 2026-10-10 UTC+7.
// @title: landing-consent — the OAuth permission screen, and the two defects it removes.
// @state: 8 locks green; the separate deployment it replaced is still on disk until the production site URL moves.
// @dependencies: node:test, node:assert, node:fs.

// The consent screen is the page where a person decides whether an application may drive
// their browser. Two things were wrong with the version it replaced, and both are the
// kind that only show up when someone reads the screen carefully:
//   1. it imported supabase-js from esm.sh, adding a second origin and a third party to
//      the one page whose job is asking for browser control;
//   2. it hardcoded the application name as "ChatGPT", so every person was told the
//      wrong application was asking, no matter which one it was.
// It also asked for a password of ours, which this site never does anywhere else.
//
// It lives on the site now rather than as its own deployment, because GoTrue validates
// the origin of every consent call against its configured site URL: a screen on another
// host can render, but it can never approve anything.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const html = read('landing/oauth/consent.html');
const code = html
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(line))
  .join('\n');

test('the consent screen names no application it did not read from the server', () => {

  assert.doesNotMatch(code, /ChatGPT/, 'no application name is written into the page');
  assert.doesNotMatch(code, /OpenCode|opencode|Claude|Gemini/i, 'and no other name is either');
  assert.match(html, /details\.client\?\.name\?\.trim\(\) \|\| ''/, 'the name comes from the authorization details');
  assert.match(html, /Nama aplikasi tidak diberikan/, 'a missing name is stated, not guessed');
});

test('the consent screen loads nothing from another origin', () => {
  assert.doesNotMatch(code, /esm\.sh|unpkg|jsdelivr|cdn\./i, 'no library from a CDN');
  assert.doesNotMatch(code, /<(script|img|link)[^>]+(src|href)="https?:/i, 'no tag points at a remote origin');
  assert.match(html, /oauth\/authorizations\/\$\{encodeURIComponent\(authorizationId\)\}/, 'it calls the authorization endpoint directly');
  assert.match(html, /JSON\.stringify\(\{ action \}\)/, 'and posts its decision directly');
  assert.match(html, /\/oauth\/authorizations\/\$\{encodeURIComponent\(authorizationId\)\}\/consent/, 'to the consent endpoint');
});

test('the consent screen asks for no password, like every other page here', () => {
  assert.doesNotMatch(html, /type="password"/i, 'there is no password field');
  assert.doesNotMatch(code, /signInWithPassword/, 'and no password grant');
  assert.match(html, /`\/index\.html\?next=/, 'it sends the person to the provider sign-in page');
});

test('a person who is not signed in keeps their request', () => {

  assert.match(html, /authorization_id=\$\{authorizationId \|\| ''\}/, 'the id is carried through the sign-in return path');
  assert.match(read('landing/index.html'), /location\.replace\(returnTo\(\)\)/, 'and the sign-in page returns the person to it');
});

test('the screen shows what a person needs to judge, and answers every action', () => {
  for (const id of ['factClient', 'factRedirect', 'redirectNote', 'scopeList', 'factUser', 'consentsCard', 'consentList']) {
    assert.ok(html.includes(`id="${id}"`), `the screen names ${id}`);
  }
  assert.match(html, /id="approveButton"/, 'there is a visible approve control');
  assert.match(html, /id="denyButton"/, 'and a visible deny control');
  assert.match(html, /role="status"/, 'and a status line every action answers through');
  assert.match(html, /say\(error\)/, 'failures are translated, not shown raw');
  assert.match(html, /tetap memblokir password, kode sekali pakai, data pembayaran/, 'the screen repeats what never leaves the device');
});

test('an authorization that is already decided is followed, not re-asked', () => {

  assert.match(html, /if \(details\.redirect_url\) \{[\s\S]*location\.assign\(details\.redirect_url\)/, 'a decided request is followed');
  assert.match(html, /data\.redirect_url/, 'and so is the redirect after approve or deny');
});

test('the consent page is served at the path GoTrue actually asks for', () => {

  const config = read('supabase/config.toml');
  assert.match(config, /authorization_path = "\/oauth\/consent"/, 'the path GoTrue uses');
  assert.ok(fs.existsSync(new URL('landing/oauth/consent.html', root)), 'the page is at that path on disk');
  const vercel = JSON.parse(read('landing/vercel.json'));
  const sources = vercel.headers.map((h) => h.source);
  assert.ok(sources.includes('/oauth/consent'), 'and the CSP covers it on Vercel');
  assert.doesNotMatch(sources.join(' '), /^\/consent$/m, 'no stale entry for the path nothing requested');
  const headers = read('landing/_headers');
  assert.match(headers, /^\/oauth\/consent$/m, 'and on Cloudflare, one path per block');
  assert.match(headers, /^\/oauth\/consent\.html$/m, 'both spellings of it');
  assert.match(html, /`\/index\.html\?next=/, 'the sign-in return path is root-relative, so it survives the subdirectory');
});

test('every page link resolves, including on the page that lives in a subdirectory', () => {

  const pages = ['beranda.html', 'index.html', 'akun.html', 'dashboard.html', 'privasi.html', 'syarat.html', 'unduh.html', 'oauth/consent.html'];
  const exists = (path) => {
    try {
      return fs.statSync(new URL(`landing/${path}`, root)).isFile();
    } catch {
      return false;
    }
  };
  for (const page of pages) {
    const dir = page.includes('/') ? page.slice(0, page.lastIndexOf('/') + 1) : '';
    const html = read(`landing/${page}`);
    const links = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]);
    assert.ok(links.length > 0, `${page} has links to resolve`);
    for (const link of links) {
      if (/^(https?:|mailto:|tel:|data:)/.test(link)) continue;

      const clean = link.split(/[?#]/)[0];
      const target = clean.startsWith('/')
        ? clean.slice(1)
        : path.posix.normalize(dir + clean);
      if (dir) assert.ok(clean.startsWith('/'), `${page} links to ${link}, which resolves against ${dir}`);
      assert.ok(exists(target), `${page} links to ${link}, which resolves to ${target} and does not exist`);
    }
  }
});

test('the consent screen carries the same navigation as every other page', () => {

  const entries = (page) => [...read(`landing/${page}`).match(/<nav>[\s\S]*?<\/nav>/)[0].matchAll(/>([^<>]+)<\/a>/g)].map((m) => m[1].trim());
  const shared = entries('beranda.html');
  for (const page of ['akun.html', 'dashboard.html', 'index.html', 'privasi.html', 'syarat.html', 'unduh.html', 'oauth/consent.html']) {
    assert.deepEqual(entries(page), shared, `${page} offers the same nav entries`);
  }
});

test('nothing the runtime reads still points at the separate consent deployment', () => {
  for (const file of ['supabase/config.toml', 'supabase/functions/opera-agent-auth/index.ts', 'supabase/functions/_shared/cors.js', 'tests/edge-cors.test.mjs', 'extension/lib/endpoints.js']) {
    assert.doesNotMatch(read(file), /oauth-consent-three/, `${file} no longer names the separate deployment`);
  }

  assert.ok(!fs.existsSync(new URL('oauth-consent/', root)), 'the separate consent deployment is gone from the tree');
});