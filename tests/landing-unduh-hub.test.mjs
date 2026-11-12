// @last-edited: 2026-11-11 UTC+7.
// @title: landing-unduh-hub - the one download page: a card per browser, the archive filled and the rest closed, then every install path.
// @state: the cards, the walkthrough, the detection, and the script the policy names.
// @dependencies: test, assert, fs, crypto.

// The site has one download page now.
// It answers "which one is mine" with a card per browser, and each card fills the archive button and closes its other two behind a details, the shape code.visualstudio.com/download uses, before the shared steps.
// The download URLs and the compatibility claims themselves are out of scope and stay pinned in landing-download.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { siteHeaders } from './helpers/site-headers.mjs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const page = read('unduh.html');
const css = read('download.css');

const ZIP = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.zip';
const CRX = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/download/opera-agent.crx';

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the page carries one card per browser, each offering both files', () => {
  const cards = [...page.matchAll(/<article class="browser" data-browser="(\w+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map((m) => m[1]), ['chrome', 'edge', 'brave', 'opera', 'vivaldi'], 'every browser is named once');
  const names = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi' };
  for (const [, key, body] of cards) {
    assert.ok(body.includes(`<h2>${names[key]}</h2>`), `${key} names itself`);
    assert.ok(body.includes('<span class="glyph"'), `${key} carries a text glyph, not an image asset`);
    assert.doesNotMatch(body, /<img/, `${key} loads no image`);

    assert.match(body, new RegExp(`<a\\b[^>]*class="btn"[^>]*href="${escapeRe(ZIP)}\\?for=${key}"[^>]*download`), `${key} offers the archive as the button, named after the browser it belongs to`);
    assert.match(body, new RegExp(`<a\\b[^>]*href="${escapeRe(CRX)}\\?for=${key}"[^>]*download`), `${key} still offers the signed package one click away, named after the browser it belongs to`);
    assert.match(body, /<span\b[^>]*class="badge"[^>]*hidden[^>]*>Browser Anda<\/span>/, `${key} hides its badge until detected`);

    const filled = [...body.matchAll(/<a\b[^>]*class="btn"[^>]*>/g)];
    assert.equal(filled.length, 1, `${key} fills exactly one button`);
    assert.ok(filled[0][0].includes(ZIP), `${key} fills the archive, the file a reader can install today`);
    assert.match(body, /<p class="otherBuilds">/, `${key} carries its other builds inline, like the benchmark download page`);
    assert.doesNotMatch(body, /class="btn"[^>]*opera-agent\.crx/, `${key} gives the signed package no button weight`);
    assert.match(body, /update\.xml\?id=[a-p]{32}/, `${key} also offers the manifest the updater reads, pinned to this extension`);
  }
});

test('the page names no version, because a named version goes stale', () => {
  const copy = page.replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
  assert.doesNotMatch(copy, /\b\d+\.\d+\.\d+\b/,
    'no version appears in the copy a reader sees');
  assert.doesNotMatch(page, /opera-agent-\d+\.\d+\.\d+\.(zip|crx)/,
    'no download link carries a version, so no release can leave the page behind');
});

test('the detection marks the matching card and phones nowhere', () => {
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(page)[1];
  assert.ok(script.includes('navigator.userAgentData?.brands'), 'reads brands first');
  assert.ok(script.includes('navigator.userAgent'), 'falls back to the UA string');
  assert.match(script, /classList\.add\('yours'\)/, 'highlights the match');
  assert.match(script, /badge\.hidden = false/, 'shows its badge');
  assert.doesNotMatch(script, /fetch\s*\(/, 'fetches nothing');
  assert.doesNotMatch(script, /XMLHttpRequest|sendBeacon|WebSocket/, 'reaches no other network either');
});

test('the install fold opens to the animated walkthrough, with the text kept underneath', () => {
  const fold = /<details class="sectionFold" open>\s*<summary><h2\b[^>]*>Cara memasang<\/h2><\/summary>\s*(?:<p class="demoNote"[^>]*>[\s\S]*?<\/p>\s*)?<div class="demo" aria-hidden="true">([\s\S]*?)<\/div>\s*<ol class="steps srOnly">([\s\S]*?)<\/ol>/.exec(page);
  assert.ok(fold, 'the install fold opens to the animated walkthrough, with the text kept underneath');
  const demo = fold[1];
  assert.equal((demo.match(/data-app="/g) || []).length, 3, 'three persistent windows: Chrome, Explorer, PowerShell');
  assert.match(demo, /data-app="chrome"/, 'the browser is one window across every page it visits');
  assert.match(demo, /class="chromePage pageExt"/, 'the extensions page lives inside that window, not beside it');
  assert.match(demo, /class="chromePage pageDash"/, 'and so does the dashboard');
  const driver = fs.readFileSync(new URL('../landing/demo.js', import.meta.url), 'utf8');
  const sequence = [
    'press(docks.chrome', 'press(pageDl.querySelector', 'press(docks.explorer',
    "goTo('.pageExt'", "picker.classList.add('is-open')", "goTo('.pageDash'",
    'openPopup(', 'press(docks.terminal'
  ];
  let at = -1;
  for (const step of sequence) {
    const next = driver.indexOf(step, at + 1);
    assert.ok(next > at, `${step} follows the step before it`);
    at = next;
  }
  assert.match(demo, /class="taskbarWin"/, 'the walkthrough runs on a desktop, the way the owner lives in it');
  assert.match(demo, /tChrome/, 'and the taskbar lights the app each beat lives in');
  assert.match(demo, /Extract all/, 'the explorer names the button the reader must find');
  assert.match(demo, /chrome:\/\/extensions/, 'and the extensions surface, named');
  assert.match(demo, /Open|Browse|folderPick/i, 'the file picker is part of the flow');
  assert.match(demo, /oaPopup/, 'and the extension popup opens under the toolbar icon');

  const steps = fold[2];
  assert.match(steps, /Unduh arsip/, 'first the archive');
  assert.match(steps, /Developer mode/i, 'then developer mode');
  assert.match(steps, /Load unpacked/, 'then the load');
  assert.match(steps, /Reload/, 'and the way a new version reaches a folder install');
});

test('the retired page leaves nothing behind', () => {
  assert.doesNotMatch(page, /enterprise-managed/, 'the page carries no enterprise framing');
  assert.doesNotMatch(page, /[Dd]rag-and-drop/, 'the page names no manual-install rejection');
  assert.doesNotMatch(page, /BLOCKED/, 'the policy console copy is gone');
  assert.doesNotMatch(page, /pengguna rumahan pakai/, 'the home-user pitch is gone');
  assert.doesNotMatch(page, /namanya membawa versi build/, 'the filename note is gone');
  assert.doesNotMatch(page, /Unduh berkas \.crx terbaru/, 'the one big .crx button is gone');
  assert.equal((page.match(new RegExp(escapeRe(CRX), 'g')) || []).length, 5, 'the version-less .crx stays one click away in every card');
  assert.doesNotMatch(css, /\.btn\.giant/, 'the giant door of the deleted page is gone with it');
  assert.doesNotMatch(css, /\.statBand/, 'and so are its numbers');
});

test('the script the page runs is named by a hash on both hosts', () => {
  const site = siteHeaders();
  const csp = site.headers.find((h) => h.source === '/unduh.html').headers
    .find((h) => h.key === 'Content-Security-Policy').value;
  const headers = read('_headers');
  const body = /<script type="module">([\s\S]*?)<\/script>/.exec(page)[1];
  const hash = "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
  assert.ok(csp.includes(hash), 'the site names the script of this page');
  for (const path of ['/unduh.html', '/unduh']) {
    const block = headers.split('\n\n').find((b) => b.startsWith(`${path}\n`));
    assert.ok(block && block.includes(hash), `_headers names it for ${path}`);
  }
});

test('the other builds sit under the button, the way the benchmark download page does it', () => {
  assert.match(css, /\.otherBuilds \{[^}]*display: flex/s, 'the other builds render as one inline row');
  assert.match(css, /\.otherBuilds a \{[^}]*color: var\(--accent\)/s, 'as quiet accent links, not another button');
});
