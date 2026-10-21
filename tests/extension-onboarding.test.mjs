// @last-edited: 2026-10-06 09:58 UTC+7.
// @title: extension-onboarding — orang asing selesai pairing tanpa membaca docs.
// @state: red first: popup dan options masih berbahasa Inggris.
// @dependencies: test, assert, fs.

// The site promises Indonesian copy, and the download page ends with "tempel di popup extension".
// The popup is where that promise is kept or broken: it was English, and its pairing hint named no place to get a code.
// A stranger stalls there.
// These locks read the same sources the browser runs, because popup.js needs chrome.* and cannot be imported in node.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { userErrorMessage } from '../extension/lib/error-messages.js';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`extension/${name}`, root), 'utf8');

test('the popup speaks Indonesian and names where the code comes from', () => {
  const html = read('popup.html');
  assert.match(html, /<html lang="id"/, 'the document language is declared Indonesian');
  assert.match(html, /Sambungkan device/, 'the pairing section says what it does');
  assert.match(html, /Masukkan kode pairing/, 'the field says what to type');

  assert.match(html, /dashboard\.html#pairing/, 'the hint links the exact section that makes the code');
});

test('the popup status answers in Indonesian, every state of it', () => {
  const script = read('popup.js');
  for (const label of ['Terhubung', 'Menghubungkan', 'Menyambung ulang', 'Memulai', 'Belum dipairing']) {
    assert.ok(script.includes(`'${label}'`), `the status names ${label}`);
  }
  assert.match(script, /'Diizinkan'/, 'an allowed tab says so');
  assert.match(script, /'Diblokir \(privat\)'/, 'a private tab says why it is blocked');

  assert.match(script, /SITE_ORIGIN/, 'the dashboard link follows the single source of truth');
});

test('the options page speaks Indonesian too', () => {
  const html = read('options.html');
  assert.match(html, /<html lang="id"/, 'the document language is declared Indonesian');
  assert.match(html, /<h2[^>]*>Koneksi<\/h2>/, 'the connection section is named');
  assert.match(html, /Model AI/, 'the model section is named');
});

test('every user-facing error is Indonesian, never a raw internal', () => {

  for (const source of [
    'Pairing failed.',
    'Invalid pairing code.',
    'Invalid bridge URL.',
    'Unable to update tab privacy.'
  ]) {
    const shown = userErrorMessage(source);
    assert.doesNotMatch(shown, /Check the code|Could not|invalid/i, `${source} is not shown in English`);
    assert.match(shown, /coba lagi|muat ulang|periksa/i, `${source} tells the reader what to do next`);
  }
  assert.match(userErrorMessage('something nobody mapped'), /uji mandiri/i,
    'the fallback still points at the self-test, in Indonesian');
});
