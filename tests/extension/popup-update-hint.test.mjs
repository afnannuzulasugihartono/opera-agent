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

const root = new URL('../../', import.meta.url);
const popup = fs.readFileSync(new URL('extension/popup.js', root), 'utf8');
const popupHtml = fs.readFileSync(new URL('extension/popup.html', root), 'utf8');
const css = fs.readFileSync(new URL('extension/styles.css', root), 'utf8');

test('the popup asks the update service which version is served', () => {
  assert.match(popup, /import \{ servedVersion, newerThan \} from '\.\/lib\/self-update\.js'/, 'it asks, through the one served-version check the product owns');
  assert.match(popup, /UPDATE_BASE_URL/, 'and it knows where the update service lives');
  assert.match(popup, /showServedVersion\(String\(reply\.version\)\)/, 'the answer is compared with the version that is running');
});

test('the one served-version check asks the archive, not the legacy health page', () => {
  const lib = fs.readFileSync(new URL('extension/lib/self-update.js', root), 'utf8');
  assert.match(lib, /method: 'HEAD'/, 'the version is asked cheaply, carrying nothing');
  assert.match(lib, /download\/opera-agent\.zip/, 'from the archive this extension is updated from');
  assert.match(lib, /x-opera-version/, 'and the answer is the version the build carries');
  assert.doesNotMatch(lib, /fetch\([^)]*health/, 'not the health page, which answers for another extension by design');
});

test('a newer served version is shown, and the same version is not', () => {
  assert.match(popup, /newerThan/, 'the two versions are compared as numbers, not as strings');
  assert.match(popup, /line\.hidden = true/, 'and nothing is shown when the installed version is the newest');
  assert.match(popup, /line\.hidden = false/, 'while a note appears when the server serves a newer one');
  assert.match(popup, /t\('update\.available', \{ v: served \}\)/, 'the note names the version that is waiting, in the reader\'s language');
});

test('the button does the work a browser cannot do from here', () => {
  assert.match(popup, /chrome\.downloads\.download\(/, 'it fetches the new build into the downloads folder');
  assert.match(popup, /download\/opera-agent\.zip/, 'and it is the archive, because Chromium refuses a hand-installed package the Web Store did not sign');
  assert.match(popup, /chrome\.tabs\.create\(\{ url: 'chrome:\/\/extensions' \}\)/, 'then it opens the page where the reload button lives');
  assert.match(popup, /chrome\.runtime\.reload\(\)/, 'and the extension can restart itself, which is the last click of the update');
  assert.match(popupHtml, /id="updateButton"/, 'the popup carries that button');
  assert.match(popupHtml, /id="reloadButton"/, 'and the reload that finishes it');
  assert.match(popupHtml, /id="updateText"/, 'and the line that names the version');
  assert.doesNotMatch(popupHtml, /id="updateHow"/, 'the explanation line is gone; the amber row itself says what will happen');
});

test('the popup has the doors out of it, the dashboard among them', () => {
  assert.match(popupHtml, /id="dashboardButton"/, 'the dashboard door exists');
  assert.match(popup, /dashboardButton.*dashboard\.html/s, 'and it opens the dashboard');
  assert.match(popupHtml, /id="docsButton"/, 'the documentation door exists');
  assert.match(popupHtml, /id="pairToggleButton"/, 'and the pairing door exists');
});

test('the status is one firm line, and the popup is a dark surface', () => {
  assert.match(popupHtml, /id="statusLine"/, 'the status is one line');
  assert.match(css, /body\.popup \.statusLine\.ready/, 'the connected state has its own colour');
  assert.match(css, /body\.popup\s*\{[\s\S]*--pop-bg/, 'the popup carries its own dark surface');
  assert.match(css, /body\.popup \.menuItem/, 'and the menu rows are styled as rows');
});
