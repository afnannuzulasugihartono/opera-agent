// @last-edited: 2026-10-26 UTC+7.
// @title: landing-claims — every number the site states is checked against the code.
// @state: every number the site states is checked against the code.
// @dependencies: node:test, node:assert, node:fs, extension-source.

// The site's copy must never claim what the runtime cannot do.
// The numbers drift silently otherwise: bump the manifest version or the tool count and the site keeps advertising the old figure until a reader notices it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extensionSource } from '../helpers/extension-source.mjs';

const root = new URL('../../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

const siteFiles = ['landing/beranda.html', 'landing/index.html', 'landing/akun.html', 'landing/privasi.html', 'landing/syarat.html', 'landing/harga.html', 'landing/unduh.html', 'landing/404.html', 'landing/fitur.html', 'landing/studi.html', 'landing/bukti.html', 'landing/dukungan.html', 'landing/docs.html', 'landing/dashboard.html', 'landing/oauth/consent.html'];
const sitePages = siteFiles.map(read);
const site = sitePages.join('\n');

// WHY THE CONSOLE IS NOT IN THE MONEY-OWNER LOCK: the dashboard is the app a signed-in customer uses, and it reads the price from the server at open time.
// The public pages are what repeat a number by hand.

const publicFiles = siteFiles.filter((file) => !file.includes('dashboard') && !file.includes('consent'));

const manifest = JSON.parse(read('extension/manifest.json'));
const tools = fs.readFileSync(new URL('../../local/tools.ts', import.meta.url), 'utf8');
const content = read('extension/content.js');
const background = await extensionSource();

test('no page states a version, because a stated version is a promise nothing keeps', () => {

  const copy = site.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/Opera Agent\s*\d+\.\d+\.\d+/g, 'Opera Agent VERSION')
    .replace(/opera-agent-\d+\.\d+\.\d+/g, 'opera-agent-VERSION');
  assert.doesNotMatch(copy, /Opera Agent VERSION|opera-agent-VERSION/,
    'no page names a build next to the product');

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'and the manifest carries a version to check against');
});

test('the tool count on the site equals the tools the local driver registers', () => {
  const registered = (tools.match(/\bname: '[a-z_]+'/g) || []).length;
  assert.ok(registered > 0, 'the local driver must register tools for this to mean anything');
  assert.match(site, new RegExp(`\\b${registered} tool`), `the site must state ${registered} tools`);
});

test('the primitive count on the site equals the allowlist the extension enforces', () => {
  const protocol = read('extension/lib/protocol.js');
  assert.match(protocol, /export const ALLOWED_METHODS = Object\.freeze\(Object\.keys\(METHOD_SPECS\)\)/, 'the allowlist is derived from the specs');
  const declared = (protocol.match(/'([a-z]+\.[a-z_]+)':\s*\{/g) || []).length;
  assert.ok(declared > 0, 'the allowlist must name primitives');
  assert.match(site, new RegExp(`\\b${declared} primitive`), `the site must state ${declared} primitives`);
});

test('the site names the permission count it asks the reader to accept', () => {
  const count = manifest.permissions.length;
  const words = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh'];
  assert.ok(count > 0 && count < words.length, 'the manifest declares a count this test can spell');
  assert.match(site, new RegExp(`\\b(${count}|${words[count]})\\s+izin`, 'i'),
    `the permission count is stated as ${count} or ${words[count]}`);
  assert.doesNotMatch(site, /\blima izin\b/i, 'and no page still says five when the manifest declares six');
  assert.match(read('landing/unduh.html'), /debugger/, 'the heaviest permission is named and justified');
});

test('the site promises no speed the runtime has not measured', () => {

  const MODEL_IDS = ['llama-3.1-8b-instant'];
  let text = site;
  for (const id of MODEL_IDS) text = text.split(id).join('');
  assert.doesNotMatch(text, /dalam (1|2|3) detik|instant|milliseconds|milidetik/i, 'no unsourced speed promise');
});

test('the site does not claim a store listing that does not exist', () => {
  assert.doesNotMatch(site, /tersedia di Chrome Web Store|available (in|on) the Chrome Web Store/i, 'the listing is still pending review');
  assert.match(read('landing/unduh.html'), /review/i, 'and the page says so');
});

test('the refusals the site advertises are the refusals the runtime enforces', () => {

  const guards = [
    ['password', content, /type === 'password'/],
    ['kode sekali pakai', content, /one-time-code/],
    ['pembayaran', content, /cvv|cvc/],
    ['private', background, /tab\.incognito/],
  ];
  for (const [phrase, source, guard] of guards) {
    assert.ok(site.includes(phrase), `the site must state the ${phrase} refusal`);
    assert.match(source, guard, `the runtime must enforce the ${phrase} refusal`);
  }
});

test('the shared-key rule is stated as a refusal, not as a promise', () => {

  assert.match(site, /tidak pernah menerbitkan kunci bersama/, 'the terms refuse a shared key');
  assert.doesNotMatch(site, /kunci API kami|api key kami|shared (model )?key/i, 'no page offers a key of ours');
});

test('the pricing page states only what the wallet enforces', () => {
  const page = read('landing/harga.html');
  const sql = read('hosted/migrations/20261104120000_opera_wallet.sql');
  const wallet = read('hosted/functions/_shared/wallet.ts');
  assert.match(page, /Rp10\.000/, 'the smallest top-up is stated');
  assert.match(sql, /1000000, 'IDR'/, 'and the migration prices it at Rp10.000 in cents');
  assert.match(page, /dikembalikan penuh/, 'a failed job is refunded in full');
  assert.match(sql, /'refund'/, 'and the ledger has a refund row for it');
  assert.match(page, /10 aksi/, 'the ten-action cap is stated');
  assert.match(wallet, /ACTION_CAP = 10/, 'and the code caps one job at ten actions');
  assert.doesNotMatch(page, /langganan bulanan|per menit|per token|per langkah/i, 'no subscription or per-unit meter is advertised');
});

// WHY THE GUIDE IS NAMED ON THE PAGE A READER LANDS ON.
// A reader on the guide asks how to call Opera Agent, and the answer lives in one file in the repository.
// A page that sends nobody there leaves the answer where nobody looks.

test('the docs page points at the guide that names every road', () => {
  const page = read('landing/docs.html');
  assert.match(page, /agent-call\.md/, 'the docs page names the call guide');
  assert.ok(fs.existsSync(new URL('docs/agent-call.md', root)), 'and the guide it names is in the repository');
});

test('no page calls the product free while every job is prepaid', () => {
  assert.doesNotMatch(site, /Gratis dipakai/i, 'a prepaid job is not free');
  assert.doesNotMatch(site, /Opera Agent gratis/i, 'the extension installs free; the job is not free');
  assert.match(site, /harga tetap/i, 'and the site says what a job costs');
});

test('the money facts live on one page', () => {
  const facts = {
    'the smallest top-up': /Rp10\.000/,
    'the action cap': /10 aksi/,
    'the thirty-minute hold': /30 menit/,
  };
  for (const [name, re] of Object.entries(facts)) {
    const owners = publicFiles.filter((file) => re.test(read(file)));
    assert.deepEqual(owners, ['landing/harga.html'], `${name} is stated once, on the price page`);
  }
});