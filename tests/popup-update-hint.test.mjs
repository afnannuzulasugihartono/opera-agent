// @last-edited: 2026-11-11 UTC+7.
// @title: popup-update-hint - the popup says when the version it runs is behind the one the server serves, and offers the door that fixes it.
// @state: the check the popup makes, the note it shows, the button it offers, and the doors the menu carries.
// @dependencies: node:test, node:assert/strict, node:fs.

// WHY THIS GATE READS THE SOURCE.
// The popup is an extension page: it runs in the browser with chrome APIs around it, so it cannot be imported here.
// What can be proved is the text: that the popup asks the update service which version it serves, that it compares the two, that the button it offers does the work a browser cannot do from here, and that the doors out of the popup exist.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const popup = fs.readFileSync(new URL('extension/popup.js', root), 'utf8');
const popupHtml = fs.readFileSync(new URL('extension/popup.html', root), 'utf8');
const css = fs.readFileSync(new URL('extension/styles.css', root), 'utf8');

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

test('the button does the work a browser cannot do from here', () => {
  assert.match(popup, /chrome\.downloads\.download\(/, 'it fetches the signed package into the downloads folder');
  assert.match(popup, /download\/opera-agent\.crx/, 'and it is the signed package, the one that updates itself');
  assert.match(popup, /chrome\.tabs\.create\(\{ url: 'chrome:\/\/extensions' \}\)/, 'then it opens the page where the package is dropped in');
  assert.match(popupHtml, /id="updateButton"/, 'the popup carries that button');
  assert.match(popupHtml, /id="updateText"/, 'and the line that names the version');
});

test('the popup has the doors out of it, the dashboard among them', () => {
  assert.match(popupHtml, /id="dashboardButton"/, 'the dashboard door exists');
  assert.match(popup, /dashboardButton.*dashboard\.html/s, 'and it opens the dashboard');
  assert.match(popupHtml, /id="docsButton"/, 'the documentation door exists');
  assert.match(popupHtml, /id="downloadButton"/, 'and the package door exists');
});

test('the status is one firm line, and the popup is a dark surface', () => {
  assert.match(popupHtml, /id="statusLine"/, 'the status is one line');
  assert.match(css, /body\.popup \.statusLine\.ready/, 'the connected state has its own colour');
  assert.match(css, /body\.popup\s*\{[\s\S]*--pop-bg/, 'the popup carries its own dark surface');
  assert.match(css, /body\.popup \.menuItem/, 'and the menu rows are styled as rows');
});
