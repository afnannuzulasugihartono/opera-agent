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
  for (const name of ['index.html', 'auth.html', 'privasi.html', 'syarat.html', 'akun.html']) {
    const html = read(name);
    assert.match(html, /class="brand"[^>]*>Opera Agent</, `${name} carries the brand`);
    assert.match(html, /privasi\.html/, `${name} links the privacy policy`);
    assert.match(html, /syarat\.html/, `${name} links the terms`);
    assert.match(html, /auth\.html/, `${name} links the account page`);
    assert.match(html, /akun\.html/, `${name} links the dashboard`);
    const nav = html.match(/<nav>[\s\S]*?<\/nav>/)[0];
    for (const entry of ['Instalasi', 'Model Anda', 'Akun', 'Dashboard', 'Privasi']) {
      assert.ok(nav.includes(entry), `${name} nav offers ${entry}`);
    }
    assert.match(nav, /<a class="brand"[^>]*>Opera Agent</, `${name} nav brand is a link home`);
  }
});

test('every page survives a reader with no JavaScript and no screen reader vision', () => {
  for (const name of ['index.html', 'auth.html', 'akun.html', 'privasi.html', 'syarat.html']) {
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
