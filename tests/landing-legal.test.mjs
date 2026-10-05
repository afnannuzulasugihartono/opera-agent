// @last-edited: 2026-10-05 08:41 UTC+7.
// @title: landing-legal — privacy policy and terms must exist before launch.
// @state: failing first: neither page exists yet.
// @dependencies: test, assert, fs.

// A launch-ready site answers two questions without inventing pages later: what
// happens to my data, and what are the rules. Both live as static pages sharing
// the site navigation, following the opencode.ai footer pattern.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');

test('the privacy policy states the owner-chosen data boundary', () => {
  const html = read('privasi.html');
  assert.match(html, /Hanya pergi ke endpoint model milik Anda/i, 'sentence A opens the policy');
  assert.match(html, /riwayat antrean/i, 'queue-history storage is disclosed, not hidden');
  assert.match(html, /tidak pernah dibagikan ke pihak ketiga/i, 'the third-party boundary is explicit');
  assert.match(html, /©|&copy;/, 'the policy carries the copyright notice');
});

test('the terms state the invite-only reality and the key rule', () => {
  const html = read('syarat.html');
  assert.match(html, /undangan/i, 'early access is invite-only until revenue pays otherwise');
  assert.match(html, /kunci.*milik Anda|model.*sendiri/i, 'bring-your-own-model is a term, not a suggestion');
  assert.match(html, /©|&copy;/, 'the terms carry the copyright notice');
});

test('every site page shares one navigation and one footer', () => {
  for (const name of ['index.html', 'auth.html', 'privasi.html', 'syarat.html', 'akun.html', 'dashboard.html', 'oauth/consent.html', 'unduh.html', '404.html']) {
    const html = read(name);
    assert.match(html, /class="brand"[^>]*>Opera Agent</, `${name} carries the brand`);
    assert.match(html, /privasi\.html/, `${name} links the privacy policy`);
    assert.match(html, /syarat\.html/, `${name} links the terms`);
    assert.match(html, /auth\.html/, `${name} links sign-in`);
    assert.match(html, /akun\.html/, `${name} links the account page`);
    assert.match(html, /dashboard\.html/, `${name} links the device page`);
    const nav = html.match(/<nav>[\s\S]*?<\/nav>/)[0];
    for (const entry of ['Instalasi', 'Unduh', 'Model Anda', 'Akun', 'Dashboard', 'Privasi']) {
      assert.ok(nav.includes(entry), `${name} nav offers ${entry}`);
    }
    // WHY the two targets and not the spelling of the path: the nav once pointed "Akun" at
    // the sign-in page and "Dashboard" at a file called akun.html, so the reader had to know
    // the filenames to know where they were going. The consent screen lives one directory
    // down and must therefore spell its paths root-relative; what both must agree on is the
    // page each entry leads to.
    const targetOf = (label) => {
      const entry = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>${label}</a>`).exec(nav);
      return entry ? entry[1].replace(/^\.\//, '').replace(/^\//, '') : null;
    };
    assert.equal(targetOf('Akun'), 'akun.html', `nav Akun points at the account page`);
    assert.equal(targetOf('Dashboard'), 'dashboard.html', `nav Dashboard points at the device page`);
    assert.match(nav, /<a class="brand"[^>]*>Opera Agent</, `${name} nav brand is a link home`);
  }
});

test('the two signed-in pages each mark themselves as the current nav entry', () => {
  for (const [name, target] of [['akun.html', 'akun.html'], ['dashboard.html', 'dashboard.html']]) {
    const nav = read(name).match(/<nav>[\s\S]*?<\/nav>/)[0];
    const current = nav.match(/aria-current="page"[^>]*>([^<]+)</);
    assert.ok(current, `${name} marks a current nav entry`);
    assert.match(nav, new RegExp(`href="\\./${target.replace('.', '\\.')}" aria-current="page"`), `${name} marks its own entry`);
  }
});

test('no page can scroll sideways on a 320px phone', () => {
  // WHY this is checked by rule and not by screenshot: a device id, an account id and a
  // localhost callback are unbreakable tokens with no spaces, and landing/AGENTS.md requires
  // every page to be readable at 320px. The device id sits in <code> on the page an operator
  // opens when something is already wrong.
  for (const name of ['index.html', 'auth.html', 'akun.html', 'dashboard.html', 'oauth/consent.html', 'unduh.html']) {
    const html = read(name);
    const style = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
    if (/<code[\s>]/.test(style) || /<code[\s>]/.test(html)) {
      // WHY the selector is matched loosely: the home page styles `code, .mono` together,
      // and a pattern that only matched a bare `code` would read that page as unstyled.
      const rule = new RegExp(`(?:^|[}\\n])\\s*([^{}\\n]*\\bcode\\b[^{}\\n]*)\\{([^}]*)\\}`).exec(style);
      assert.ok(rule, `${name}: code has a rule this check can read`);
      assert.match(rule[2], /overflow-wrap\s*:\s*(anywhere|break-word)/, `${name}: code must be able to wrap`);
    }
    if (/grid-template-columns\s*:[^;]*max-content/.test(style)) {
      assert.match(style, /@media \(max-width: \d+px\)/, `${name}: a max-content column must stack under a breakpoint`);
    }
    assert.doesNotMatch(style, /white-space\s*:\s*nowrap/, `${name}: nothing may refuse to wrap`);
  }
});

test('the site is deployed as static files, never as a detected framework', () => {
  const vercel = JSON.parse(fs.readFileSync(new URL('landing/vercel.json', root), 'utf8'));
  // WHY this lock: an auto-detected framework replaced the root document. The
  // deployment URL answered 200 with a dashboard while the alias answered 404,
  // and only these two fields prevent that from happening again.
  assert.equal(vercel.framework, null, 'no framework may be detected');
  assert.equal(vercel.buildCommand, null, 'there is no build step to run');
  assert.equal(vercel.outputDirectory, '.', 'the served directory is the site itself');
  const ignore = fs.readFileSync(new URL('landing/.vercelignore', root), 'utf8');
  assert.match(ignore, /AGENTS\.md/, 'the scope file never reaches the deployment');
});

test('every site page survives a reader with no JavaScript and no screen reader vision', () => {
  for (const name of ['index.html', 'auth.html', 'akun.html', 'dashboard.html', 'oauth/consent.html', 'privasi.html', 'syarat.html', 'unduh.html']) {
    const html = read(name);
    assert.match(html, /<html lang="id"/, `${name} declares its language`);
    assert.match(html, /<main/, `${name} has a main landmark`);
    assert.match(html, /<header/, `${name} has a banner landmark`);
    assert.match(html, /<footer/, `${name} has a contentinfo landmark`);
    assert.match(html, /<h1/, `${name} has exactly one kind of top heading`);
    assert.match(html, /<title>[^<]+<\/title>/, `${name} names itself in the tab`);
    assert.match(html, /name="viewport"/, `${name} is readable on a phone`);
    // Without JavaScript the page must still say what it is and offer a next step.
    const noScript = html.replace(/<script[\s\S]*?<\/script>/g, '');
    assert.match(noScript, /(Masuk|Dashboard|Privasi|Syarat|Kebijakan|Operasi)/, `${name} reads without script`);
  }
});

test('the home page answers objections before they become support tickets', () => {
  const html = read('index.html');
  for (const question of ['Berapa biayanya', 'Model apa', 'Data saya', 'Tanpa internet', 'Berhenti']) {
    assert.ok(html.includes(question), `the FAQ answers: ${question}`);
  }
});
