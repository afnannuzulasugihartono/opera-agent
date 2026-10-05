// @last-edited: 2026-10-05 08:41 UTC+7.
// @title: landing-auth — the sign-in page must offer providers, never a password.
// @state: failing first: the auth page does not exist yet.
// @dependencies: test, assert, fs.

// The marketing page carries no network promise; the auth page is the one place a
// key-adjacent action happens. It follows the opencode pattern both sides agreed on:
// provider buttons and a magic link, no password of ours anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('landing/auth.html', root), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('landing/vercel.json', root), 'utf8'));

const AUTH_HOST = 'https://nenmkmtvjremqphfqnfw.supabase.co/auth/v1';

test('the auth page offers Google and GitHub through the project Auth, not through us', () => {
  assert.match(html, /provider=google/, 'a Masuk dengan Google button must point at the provider');
  assert.match(html, /provider=github/, 'a Masuk dengan GitHub button must point at the provider');
  assert.ok(html.includes(AUTH_HOST), 'both buttons must go to the project Auth host, never a middleman');
  assert.match(html, /redirect_to=https:\/\/opera-agent\.vercel\.app\/auth/, 'both buttons must carry the way home, or login strands the visitor on the old site URL');
});

test('the auth page takes no password, only a magic link', () => {
  assert.doesNotMatch(html, /type="password"/i, 'there is no password of ours to steal');
  assert.match(html, /type="email"/i, 'the fallback is an email field');
  assert.ok(html.includes('https://nenmkmtvjremqphfqnfw.supabase.co/auth/v1'), 'the one-time code request goes to the project Auth host');
  assert.match(html, /\/otp/, 'the email field sends a one-time code request');
});

test('the landing page itself stays network-free while auth may reach only Supabase', () => {
  const bySource = Object.fromEntries(vercel.headers.map((h) => [h.source, h.headers]));
  const rootCsp = bySource['/(.*)'].find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(rootCsp, /connect-src 'none'/, 'the marketing page still connects nowhere');
  const authCsp = bySource['/auth'].find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(authCsp, /connect-src https:\/\/\*\.supabase\.co/, 'the auth page may reach only Supabase');
  assert.doesNotMatch(authCsp, /connect-src[^;]*https?:\/\/(?!\*\.supabase\.co)/, 'no second origin rides along');
  assert.doesNotMatch(html, /src="https?:/, 'even the auth page loads no external script');
});

test('the two pages navigate both ways as one site', () => {
  const index = fs.readFileSync(new URL('landing/index.html', root), 'utf8');
  assert.match(index, /href="[^"]*auth\.html"/, 'landing links to the account page');
  assert.match(html, /href="[^"]*index\.html/, 'the account page links back home');
  assert.match(html, /index\.html#(install|model|privacy)/, 'the account page shares the landing sections');
  assert.match(index, /Opera Agent/, 'both pages carry the same brand');
  assert.match(html, /Opera Agent/, 'both pages carry the same brand');
});

test('the auth page says access is invite-only while sign-up stays closed', () => {
  assert.match(html, /undangan/i, 'early access is by invitation until revenue pays for open sign-up');
});

test('a returning login completes on the page instead of stranding the visitor', () => {
  // WHY this lock exists: provider and magic-link logins return to this page with
  // tokens in the URL fragment. A page that ignores them leaves a layperson staring
  // at a login form while already logged in.
  assert.match(html, /access_token/, 'the page reads the returning session from the URL');
  assert.ok(html.includes('https://nenmkmtvjremqphfqnfw.supabase.co/auth/v1'), 'the session is proven against the project Auth host');
  assert.match(html, /\$\{AUTH_HOST\}\/user/, 'the page proves the session through the user endpoint');
  assert.match(html, /Keluar/, 'a signed-in visitor can sign out again');
});

test('every auth control has an accessible name', () => {
  for (const [, id] of html.matchAll(/<input\b[^>]*\bid="([^"]+)"/gi)) {
    assert.ok(new RegExp(`<label[^>]*for="${id}"`).test(html), `input #${id} has a label`);
  }
  for (const [, text] of html.matchAll(/<button\b[^>]*>([^<]{2,})<\//gi)) {
    assert.ok(text.trim().length > 2, 'each button names itself in its own text');
  }
  for (const [, text] of html.matchAll(/<a\b[^>]*class="provider"[^>]*>([^<]{2,})</gi)) {
    assert.ok(text.trim().length > 2, 'each provider link names itself in its own text');
  }
});
