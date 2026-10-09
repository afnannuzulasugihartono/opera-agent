// @last-edited: 2026-10-05 02:16 UTC+7.
// @title: landing — the public site must stay honest about where a key goes.
// @state: locked on the extension id, the no-network promise, the install steps and the copyright.
// @dependencies: test, assert, crypto, fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EXTERNAL_CONFIG_ORIGINS, originAllowed } from '../extension/lib/external-origins.js';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('landing/index.html', root), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));

// The landing page is where a user types their API key, so its promises are
// load-bearing rather than marketing copy. Each one below is asserted instead of
// trusted: a page that says the key never leaves will eventually grow a fetch.

test('the page names the extension it configures, and it is the pinned one', () => {
  const digest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
  const expected = [...digest].map((byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`).join('');
  const named = html.match(/EXTENSION_ID\s*=\s*'([a-p]{32})'/);
  assert.ok(named, 'the page must name the extension id it sends to');
  assert.equal(named[1], expected, 'the page and the manifest key must resolve to the same extension id');
});

test('the key is never sent to a network origin', () => {
  // WHY the whole promise in one assertion: the only allowed recipient is the
  // extension. Any fetch, XHR or form post in this file would make the copy a lie.
  assert.doesNotMatch(html, /\bfetch\s*\(/, 'the landing page must not fetch anything');
  assert.doesNotMatch(html, /XMLHttpRequest/, 'the landing page must not open an XHR');
  assert.doesNotMatch(html, /<form[^>]+action=/i, 'the form must not post anywhere');
  assert.doesNotMatch(html, /navigator\.sendBeacon/, 'the landing page must not beacon');
});

test('the page sends the model config to the extension and nowhere else', () => {
  assert.match(html, /chrome\.runtime\.sendMessage\(EXTENSION_ID/, 'the handoff must be one message to the extension');
  for (const field of ['modelEndpoint', 'modelName', 'modelKey']) {
    assert.ok(html.includes(field), `${field} must be part of the handoff`);
  }
  assert.match(html, /type:\s*'applyModelConfig'/, 'the message type must match what the extension listens for');
});

test('the extension only accepts the handoff from an origin it was granted', () => {
  const external = manifest.externally_connectable;
  assert.ok(external?.matches?.length, 'externally_connectable must list the pages allowed to configure');
  assert.deepEqual([...external.matches].sort(), [
    'http://localhost/*',
    'https://localhost/*',
    'https://opera-agent.pages.dev/*'
  ].sort(), 'only localhost and the official site may configure');
  for (const pattern of external.matches) {
    assert.doesNotMatch(pattern, /\*:\/\/\*\//, 'a match-all origin would be a grant to every site on the internet');
  }
  assert.ok(!external.ids || !external.ids.includes('*'), 'extensions must not all be able to configure this one');
});

test('the origin check admits the official site and localhost, and nothing else', () => {

  // WHY these exact cases: sender.origin for an https page is the bare origin,
  // so a plain prefix match would admit evil subdomains. Each line below is one
  // row of the contract the background handler enforces.

  assert.deepEqual([...EXTERNAL_CONFIG_ORIGINS], ['http://localhost:', 'https://localhost:', 'https://opera-agent.pages.dev']);
  assert.equal(originAllowed('https://opera-agent.pages.dev'), true, 'the official site origin is accepted');
  assert.equal(originAllowed('https://opera-agent.pages.dev/model'), true, 'the sender.url form with a path is accepted');
  assert.equal(originAllowed('http://localhost:8000'), true, 'localhost over http is accepted');
  assert.equal(originAllowed('https://localhost:3000/'), true, 'localhost over https is accepted');
  assert.equal(originAllowed('https://opera-agent.pages.dev.evil.com'), false, 'a subdomain of the site is rejected');
  assert.equal(originAllowed('https://evil.com'), false, 'a foreign origin is rejected');
  assert.equal(originAllowed(''), false, 'an empty sender is rejected');
});

test('the provider picker names the providers, and the NVIDIA pair plus the Groq trio exactly', () => {
  for (const id of ['nvidia', 'groq', 'ollama', 'lmstudio', 'custom']) {
    // WHY tag and value separately: an option may carry a data-i18n attribute,
    // so a verbatim whole-tag match would break on the attribute rather than on
    // a lost provider.
    assert.match(html, new RegExp(`<option\\b[^>]*value="${id}"[^>]*>`), `the provider picker offers ${id}`);
  }
  assert.ok(html.includes('https://integrate.api.nvidia.com/v1/chat/completions'), 'the NVIDIA endpoint is exact');
  assert.ok(html.includes('meta/llama-3.2-11b-vision-instruct'), 'the fast NVIDIA model is exact');
  assert.ok(html.includes('meta/llama-3.2-90b-vision-instruct'), 'the thorough NVIDIA model is exact');
  assert.ok(html.includes('https://api.groq.com/openai/v1/chat/completions'), 'the Groq endpoint is exact');
  assert.ok(html.includes('llama-3.1-8b-instant'), 'the fast Groq model is exact');
  assert.ok(html.includes('llama-3.3-70b-versatile'), 'the thorough Groq model is exact');
  assert.ok(html.includes('qwen/qwen3.8-27b'), 'the preview Groq model is exact');
  assert.ok(html.includes('http://127.0.0.1:11434/v1/chat/completions'), 'the Ollama endpoint is exact');
  assert.ok(html.includes('http://127.0.0.1:1234/v1/chat/completions'), 'the LM Studio endpoint is exact');
});

test('the key field is only ever cleared, never filled in by the page', () => {
  // WHY this lock: the key is typed by the person and read by collect(); a page that
  // writes anything but the post-send reset into it is autofilling a secret.
  const writes = [...html.matchAll(/\$\('modelKey'\)\.value\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(writes.length >= 1, 'the post-send reset exists');
  for (const written of writes) {
    assert.equal(written, `''`, 'the only write to the key field is clearing it');
  }
});

test('the page tells a person how to install, sign in, and where data goes', () => {
  assert.match(html, /<h1[^>]*>[\s\S]{10,}<\/h1>/, 'the page needs a real headline');
  assert.match(html, /id="install"/, 'installation instructions must be on the page');
  assert.match(html, /opera:\/\/extensions/, 'the install steps must name the real browser surface');
  assert.match(html, /id="signin"/, 'sign-in must be on the page');
  assert.match(html, /id="privacy"/, 'the page must state what leaves the machine');
  assert.match(html, /©|&copy;/, 'the copyright line must be present');
  assert.match(html, /Hak cipta dilindungi/, 'the copyright must be a real notice, not a symbol alone');
});

test('every form control on the page has an accessible name', () => {
  const controls = [...html.matchAll(/<(input|select)\b[^>]*>/gi)].map((m) => m[0]);
  assert.ok(controls.length >= 4, `expected the model form, found ${controls.length} controls`);
  for (const control of controls) {
    const id = control.match(/\bid="([^"]+)"/);
    const labelled = id && new RegExp(`<label[^>]*for="${id[1]}"`).test(html);
    assert.ok(labelled, `control has a label: ${control.slice(0, 60)}`);
  }
});

test('the privacy section discloses the relay instead of denying it', () => {
  // WHY this lock exists: the page once claimed page content never touches the
  // bridge, while command results are stored as queue history in the project
  // database. A privacy section that denies the relay is a lie the lock must catch.
  assert.doesNotMatch(html, /Nothing is uploaded/, 'the page must not claim nothing leaves the machine');
  assert.doesNotMatch(html, /Never to the .*bridge/, 'the page must not deny the relay');
  assert.match(html, /riwayat antrean/, 'the page must disclose queue-history storage');
  assert.match(html, /tidak pernah dibagikan ke pihak ketiga/, 'the page must state the third-party boundary');
});

test('the site has no build step and no external origin', () => {
  const vercel = JSON.parse(fs.readFileSync(new URL('landing/vercel.json', root), 'utf8'));
  const rootEntry = vercel.headers.find((h) => h.source === '/(.*)');
  const csp = rootEntry.headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /connect-src 'none'/, 'the page must be forbidden from connecting anywhere');
  assert.doesNotMatch(html, /src="https?:/, 'no external script or stylesheet');
  assert.doesNotMatch(html, /<link[^>]+href="https?:/, 'no external stylesheet');
});