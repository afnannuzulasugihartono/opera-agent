// @last-edited: 2026-10-06 10:24 UTC+7.
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

  // WHY this origin: the page rewrites redirect_to from its own location at runtime, so
  // the value baked into the markup is only the fallback for a browser with no script.
  // It still has to name the host the site is served from, or that fallback strands the
  // visitor on the old site URL.
  assert.match(html, /redirect_to=https:\/\/opera-agent\.pages\.dev\/auth/, 'both buttons must carry the way home, or login strands the visitor on the old site URL');
});

test('the auth page takes no password, only a magic link', () => {
  assert.doesNotMatch(html, /type="password"/i, 'there is no password of ours to steal');
  assert.match(html, /type="email"/i, 'the fallback is an email field');
  assert.ok(html.includes('https://nenmkmtvjremqphfqnfw.supabase.co/auth/v1'), 'the one-time code request goes to the project Auth host');
  assert.match(html, /\/otp/, 'the email field sends a one-time code request');
});

test('the landing page itself stays network-free while auth may reach only Supabase', () => {
  // WHY order matters: Vercel applies every matching source with later entries
  // winning, so the catch-all must come first or it buries the auth policy.
  assert.deepEqual(
    vercel.headers.map((h) => h.source),
    ['/(.*)', '/auth', '/auth/:path*', '/auth.html', '/akun', '/akun/:path*', '/akun.html', '/dashboard', '/dashboard/:path*', '/dashboard.html', '/oauth/consent', '/oauth/consent.html', '/robots.txt', '/sitemap.xml'],
    'the catch-all stays first and the page entries follow'
  );
  const bySource = Object.fromEntries(vercel.headers.map((h) => [h.source, h.headers]));
  const rootCsp = bySource['/(.*)'].find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(rootCsp, /connect-src 'none'/, 'the marketing page still connects nowhere');

  // WHY three entries per page: neither "/auth" nor "/auth/:path*" alone matched the
  // served path on Vercel, so the auth page received the root CSP and its Supabase
  // fetch died in the browser. All three carry the same single-origin policy.
  const authSources = ['/auth', '/auth/:path*', '/auth.html', '/oauth/consent', '/oauth/consent.html'];
  for (const source of authSources) {
    const entry = bySource[source];
    assert.ok(entry, `vercel.json must define a header entry for ${source}`);
    const csp = entry.find((h) => h.key === 'Content-Security-Policy').value;
    assert.match(csp, /connect-src https:\/\/\*\.supabase\.co/, `${source} may reach only Supabase`);
    assert.doesNotMatch(csp, /connect-src[^;]*https?:\/\/(?!\*\.supabase\.co)/, 'no second origin rides along');
  }
  assert.doesNotMatch(html, /src="https?:/, 'even the auth page loads no external script');
});

test('the sign-in page can return a person to where they came from, and nowhere else', () => {
  // WHY this lock: the OAuth consent screen lives on the site, so a person who follows
  // a permission request and is not signed in has to come back to that screen with its
  // authorization_id intact. But this is the one page an attacker can send a stranger to
  // with a query string, so ?next must never become an open redirect.
  assert.match(html, /const RETURNABLE = \/\^\\\.\\\//, 'only a same-site relative path is accepted');
  assert.match(html, /returnTo\(\) !== '\.\/index\.html'/, 'the return path changes what the page offers');
  assert.match(html, /redirect_to.*encodeURIComponent\(target\)/, 'the provider buttons carry the return path to Supabase');
  assert.match(html, /id="continueButton"/, 'a signed-in visitor is offered the return path explicitly');
  // WHY the provider buttons matter most: they leave the site entirely and come back
  // through Supabase, so a hardcoded redirect_to loses the request on that hop.
  for (const id of ['googleButton', 'githubButton']) {
    assert.ok(html.includes(`'${id}'`), `${id} is rewired to carry the return path`);
  }
});

test('the two pages navigate both ways as one site', () => {
  const index = fs.readFileSync(new URL('landing/index.html', root), 'utf8');
  assert.match(index, /href="[^"]*auth\.html"/, 'landing links to the account page');
  assert.match(html, /href="[^"]*index\.html/, 'the account page links back home');
  assert.match(html, /index\.html#(install|model|privacy)/, 'the account page shares the landing sections');
  assert.match(index, /Opera Agent/, 'both pages carry the same brand');
  assert.match(html, /Opera Agent/, 'both pages carry the same brand');
});

test('the auth page says sign-up is open, because it is', () => {
  // WHY this lock replaced the invite-only one: the live Auth settings answer
  // "disable_signup":false with google and email enabled, so the old copy —
  // "Akses awal lewat undangan sampai sign-up terbuka" — was a false statement
  // on the page a stranger reads before creating an account.
  assert.match(html, /Daftar terbuka/i, 'open sign-up is stated, not rationed');
  assert.doesNotMatch(html, /undangan/i, 'no invitation wording remains');
});

test('a returning login completes on the page instead of stranding the visitor', () => {
  // WHY this lock exists: provider and magic-link logins return to this page with
  // tokens in the URL fragment. A page that ignores them leaves a layperson staring
  // at a login form while already logged in.
  assert.match(html, /access_token/, 'the page reads the returning session from the URL');
  assert.ok(html.includes('https://nenmkmtvjremqphfqnfw.supabase.co/auth/v1'), 'the session is proven against the project Auth host');
  assert.match(html, /\$\{AUTH_HOST\}\/user/, 'the page proves the session through the user endpoint');
  assert.match(html, /Keluar/, 'a signed-in visitor can sign out again');
  assert.match(html, /location\.replace\(returnTo\(\)\)/, 'a fresh login hands the visitor back to wherever they came from');
  assert.match(html, /proveStoredSession/, 'a returning visitor sees their own state, not a stranger login form');
  assert.match(html, /localStorage/, 'the session survives across tabs like every other site');
  assert.doesNotMatch(html, /sessionStorage/, 'no tab-only storage remains to force a second login');
  assert.match(html, /pageTitle'\)\.textContent = 'Akun'/, 'the signed-in view is titled account, not login');
});

test('every auth control has an accessible name', () => {
  for (const [, id] of html.matchAll(/<input\b[^>]*\bid="([^"]+)"/gi)) {
    assert.ok(new RegExp(`<label[^>]*for="${id}"`).test(html), `input #${id} has a label`);
  }
  // WHY the label escape: the language toggle reads ID/EN, two-letter codes no
  // prose can stretch past two characters. A button carrying a non-empty
  // aria-label names itself that way; without one, its own text must do it.
  for (const [, attrs, text] of html.matchAll(/<button\b([^>]*)>([^<]*)<\//gi)) {
    const labelled = /aria-label="([^"]+)"/.exec(attrs);

    if (labelled && labelled[1].trim() !== '') continue;

    assert.ok(text.trim().length > 2, 'each button names itself in its own text');
  }
  for (const [, text] of html.matchAll(/<a\b[^>]*class="provider"[^>]*>([^<]{2,})</gi)) {
    assert.ok(text.trim().length > 2, 'each provider link names itself in its own text');
  }
});

test('the gate splits brand from form, and stacks on a narrow screen', () => {
  // WHY this shape: the Facebook login page puts the brand panel left and the
  // form card right, which is what a stranger recognises as a login page. The
  // mark, the headline, and the three value lines stay house style throughout.
  assert.match(html, /<div class="split">/, 'brand and gate share one row');
  assert.match(html, /<div class="brand">/, 'the brand panel stands on the left');
  const mark = 'M5.2 2.2v10.2l2.5-2.3 1.5 3.6 1.9-.8-1.6-3.6h3.1L5.2 2.2Z';
  assert.ok(html.includes(`<path d="${mark}"`), 'the panel mark reuses the favicon path inline');
  assert.ok(html.includes(`d='${mark}'`), 'which is the path the favicon carries');
  assert.match(html, /grid-template-columns: 1fr 1\.1fr/, 'two columns on a wide screen');
  assert.match(html, /@media \(max-width: 860px\)/, 'stacked below 860px');
  assert.doesNotMatch(html, /#1877f2|#0866ff/i, 'no Facebook blue rides along');
});

test('the register tab swaps copy only, never the endpoint', () => {
  // WHY copy only: Auth creates the account for a new address on the same
  // one-time-code request, so a second form would be a second way to break.
  assert.match(html, /role="tablist"/, 'the tabs announce themselves as tabs');
  assert.match(html, /id="loginTab"[^>]*aria-selected="true"/, 'Masuk starts selected');
  assert.match(html, /id="registerTab"[^>]*aria-selected="false"/, 'Daftar starts idle');
  assert.ok(html.includes('Buat akun'), 'the register tab names its own action');
  assert.match(html, /selectTab/, 'one function flips the tab pair');
  assert.equal((html.match(/<form\b/g) || []).length, 1, 'a single form serves both tabs');
  assert.equal((html.match(/type="email"/g) || []).length, 1, 'a single email field serves both tabs');
  assert.equal((html.match(/\$\{AUTH_HOST\}\/otp/g) || []).length, 1, 'a single OTP call serves both tabs');
  assert.doesNotMatch(html, /type="password"/i, 'the register tab adds no password either');
});

test('the resend line resubmits the same form instead of growing an endpoint', () => {
  // WHY a form attribute and not a link: the resend is the same magic-link
  // request a second time, so it submits the existing form from outside it.
  assert.match(html, /Tidak menerima email\? Kirim ulang/, 'the centered line names the retry');
  assert.match(html, /<button[^>]*form="magicForm"/, 'it submits the existing form');
  assert.doesNotMatch(html, /\/(signup|register|resend|invite)/i, 'no second auth endpoint exists to call');
});

test('the language footer reuses the shared choice without inventing a control', () => {
  // WHY buttons and not links: the mechanism wires button[data-lang], so the
  // footer names each language in itself and writes oa-lang through it.
  assert.match(html, />Bahasa Indonesia<\/button>/, 'Indonesian names itself');
  assert.match(html, />English<\/button>/, 'English names itself');
  assert.match(html, /<p class="langlist">[\s\S]*data-lang="id"[\s\S]*data-lang="en"[\s\S]*<\/p>/, 'both write through the shared mechanism');
});

test('the provider entries keep their addresses and their marks', () => {
  // WHY byte-exact: the restyle moves the buttons under the form, and a moved
  // button is where a rewritten href hides.
  for (const provider of ['google', 'github']) {
    assert.ok(
      html.includes(`https://nenmkmtvjremqphfqnfw.supabase.co/auth/v1/authorize?provider=${provider}&redirect_to=https://opera-agent.pages.dev/auth`),
      `${provider} keeps its address`
    );
  }
  assert.equal((html.match(/class="provider"/g) || []).length, 2, 'two provider entries, no more');
});

test('the signed-in view keeps its elements and its ids', () => {
  // WHY every id: the restyle reorders the signed-out card, and the skip-login
  // behavior finds its cards by id, so a renamed card is a silent login.
  for (const id of ['pageTitle', 'pageSub', 'signedOut', 'signedIn', 'returning', 'continueButton', 'whoami', 'sessionStatus', 'signOutButton']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} survives the restyle`);
  }
});
