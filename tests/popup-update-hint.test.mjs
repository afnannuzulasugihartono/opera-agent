// @last-edited: 2026-11-11 UTC+7.
// @title: popup-update-hint - the popup says when the version it runs is behind the one the server serves.
// @state: the check the popup makes, the note it shows, and the door it opens.
// @dependencies: node:test, node:assert/strict, node:fs.

// WHY THIS GATE READS THE SOURCE.
// The popup is an extension page: it runs in the browser with chrome APIs around it, so it cannot be imported here.
// What can be proved is the text: that the popup asks the update service which version it serves, that it compares the two, and that the note has a door to the signed package.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const popup = fs.readFileSync(new URL('extension/popup.js', root), 'utf8');
const popupHtml = fs.readFileSync(new URL('extension/popup.html', root), 'utf8');

test('the popup asks the update service which version is served', () => {
  assert.match(popup, /UPDATE_BASE_URL/, 'it knows where the update service lives');
  assert.match(popup, /fetch\(`\$\{UPDATE_BASE_URL\}\//, 'and it asks that service');
  assert.match(popup, /showServedVersion\(data\.version\)/, 'the answer is compared with the version that is running');
});

test('a newer served version is shown, and the same version is not', () => {
  assert.match(popup, /newerThan/, 'the two versions are compared as numbers, not as strings');
  assert.match(popup, /line\.hidden = true/, 'and nothing is shown when the installed version is the newest');
  assert.match(popup, /line\.hidden = false/, 'while a note appears when the server serves a newer one');
  assert.match(popup, /Versi \$\{served\} sudah tersedia/, 'the note names the version that is waiting');
});

test('the note opens the signed package, because only that one updates itself', () => {
  assert.match(popup, /SITE_ORIGIN\}\/unduh\.html/, 'the link goes to the download page');
  assert.match(popupHtml, /id="updateHint"/, 'the popup carries the note');
  assert.match(popupHtml, /id="updateLink"/, 'and the door out of it');
});

test('the hint reads as a fact to act on, not as another grey hint', () => {
  const css = fs.readFileSync(new URL('extension/styles.css', root), 'utf8');
  assert.match(css, /\.updateHint\s*\{\s*color: var\(--primary\)/, 'the note has its own colour');
});
