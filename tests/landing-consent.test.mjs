// @last-edited: 2026-10-05 18:15 UTC+7.
// @title: landing-consent — the OAuth permission screen, and the two defects it removes.
// @state: 7 locks, green; the separate deployment it replaced is gone from the tree.
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

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const html = read('landing/consent.html');
const code = html
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(line))
  .join('\n');

test('the consent screen names no application it did not read from the server', () => {
  // WHY this is the first lock: the old screen hardcoded "ChatGPT". A person granting
  // control of their browser to what the page claims is asking is the whole decision.
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
  assert.match(html, /\.\/auth\.html\?next=/, 'it sends the person to the provider sign-in page');
});

test('a person who is not signed in keeps their request', () => {
  // WHY the id must survive the round trip: the consent page lives on the site, and a
  // person without a session is sent to /auth. Losing authorization_id there means the
  // permission screen silently becomes "no request found".
  assert.match(html, /authorization_id=\$\{authorizationId \|\| ''\}/, 'the id is carried through the sign-in return path');
  assert.match(read('landing/auth.html'), /location\.replace\(returnTo\(\)\)/, 'and /auth returns the person to it');
});

test('the screen shows what a person needs to judge, and answers every action', () => {
  for (const id of ['factClient', 'factRedirect', 'factScope', 'factUser']) {
    assert.ok(html.includes(`id="${id}"`), `the screen names ${id}`);
  }
  assert.match(html, /id="approveButton"/, 'there is a visible approve control');
  assert.match(html, /id="denyButton"/, 'and a visible deny control');
  assert.match(html, /role="status"/, 'and a status line every action answers through');
  assert.match(html, /say\(error\)/, 'failures are translated, not shown raw');
  assert.match(html, /tetap memblokir password, kode sekali pakai, data pembayaran/, 'the screen repeats what never leaves the device');
});

test('an authorization that is already decided is followed, not re-asked', () => {
  // WHY: Supabase auto-approves a request when the same client already holds consent
  // covering the requested scopes, and returns the redirect instead of details. Asking
  // again would show a person a decision that was already made for them.
  assert.match(html, /if \(details\.redirect_url\) \{[\s\S]*location\.assign\(details\.redirect_url\)/, 'a decided request is followed');
  assert.match(html, /data\.redirect_url/, 'and so is the redirect after approve or deny');
});

test('nothing the runtime reads still points at the separate consent deployment', () => {
  for (const file of ['supabase/config.toml', 'supabase/functions/opera-agent-auth/index.ts', 'supabase/functions/_shared/cors.js', 'tests/edge-cors.test.mjs', 'extension/lib/endpoints.js']) {
    assert.doesNotMatch(read(file), /oauth-consent-three/, `${file} no longer names the separate deployment`);
  }
  // WHY the old directory still exists: Supabase's site URL is a production setting, and
  // it still points at the separate deployment. Deleting the files before that setting
  // changes would leave the permission screen with nowhere to load, which is a worse
  // state than two copies of one page. It goes in the same commit that moves the
  // production site URL, and this assertion changes to its absence on that day.
  assert.ok(fs.existsSync(new URL('oauth-consent/index.html', root)), 'the superseded screen is still present until the production switch');
  assert.match(read('oauth-consent/index.html'), /memberi ChatGPT akses/, 'and the superseded screen still carries the wrong name, which is why it is not served');
});