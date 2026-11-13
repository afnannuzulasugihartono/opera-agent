// @last-edited: 2026-11-06 UTC+7.
// @title: extension-run — the shipped extension drove a real browser, and the record says so.
// @state: the recorded call sequence, the transport it used, the press and the download hash, the picture, and the markdown that must match the jsonl.
// @dependencies: node:test, strict, node:crypto, node:fs, node:path, node:url, scripts/dev/extension-run.mjs.

// WHY THIS FILE EXISTS.
// The product ships a browser extension and claims it drives the everyday browser without a debugging port.
// The claim was true in code and unproven in fact, and a proof run over a debugging port cannot speak for the extension.
// So this file reads the recorded drive and asks the only two questions that matter: which road carried the calls, and did the bytes land.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromeIgnoresLoadExtension, majorOf, recordMarkdown, roadFor } from '../scripts/dev/extension-run.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const proof = (name) => path.join(root, 'proof', name);
const rows = () => fs.readFileSync(proof('extension-run.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((line) => JSON.parse(line));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('the recorded extension run drove the browser through the extension', () => {
  const calls = rows().filter((entry) => entry.kind === 'call' || entry.kind === 'download');
  assert.deepEqual(calls.map((entry) => entry.tool), [
    'browser_status', 'open_url', 'read_page', 'find_elements', 'download', 'capture_page', 'close_tab'
  ]);
  assert.equal(rows().find((entry) => entry.kind === 'header').transport, 'bridge');
  assert.ok(calls.every((entry) => entry.ok === true), 'every recorded call said ok');
});

test('the record and the markdown agree on the bytes', () => {
  const markdown = fs.readFileSync(proof('extension-run.md'), 'utf8');
  const download = rows().find((entry) => entry.kind === 'download');
  assert.ok(markdown.includes(download.sha256), 'the readable record carries the download hash');
  assert.ok(fs.existsSync(proof('extension-portal.jpg')), 'the picture the run took is in the tree');
});

test('the download came off the portal unchanged', () => {
  const download = rows().find((entry) => entry.kind === 'download');
  const fixture = path.join(root, 'tests', 'fixtures', 'mock-company', 'transaksi-2026-09.csv');
  assert.equal(download.sha256, sha256(fixture), 'the CSV landed as the portal served it');
});

test('the record shows the press, not only the file it fetched', () => {
  const download = rows().find((entry) => entry.kind === 'download');
  assert.ok(download.pressed, 'the download row names the press that fetched the file');
  assert.equal(typeof download.pressed.x, 'number', 'the press has a point on the page');
  assert.equal(typeof download.pressed.y, 'number', 'the press has a point on the page');
  assert.equal(download.pressed.control?.name, 'Unduh CSV', 'the press names the control it pushed');
  const markdown = fs.readFileSync(proof('extension-run.md'), 'utf8');
  assert.match(markdown, /pressed the download control "Unduh CSV"/, 'the readable record says the press in words');
});

// WHY THE MARKDOWN IS REGENERATED FROM THE JSONL AND LOCKED EQUAL.
// The two files were written by one run, so a sentence that survives an edit to the generator is a sentence nobody can trust.
// Regenerating the markdown from the recorded rows proves the readable record is what the recorded run says.

test('the readable record is the recorded rows, regenerated', () => {
  const markdown = fs.readFileSync(proof('extension-run.md'), 'utf8');
  const header = rows().find((entry) => entry.kind === 'header');
  const regenerated = recordMarkdown({
    rows: rows(),
    browser: header.browser,
    extensionId: header.extensionId
  });
  assert.equal(markdown, regenerated, 'the markdown file is what recordMarkdown produces from the jsonl');
  assert.match(markdown, /`tests\/extension-run\.test\.mjs` re-hashes the fixture/, 'the closing sentence names what the test re-checks');
  assert.doesNotMatch(markdown, /cannot drift/, 'the record does not claim the test re-proves it');
});

// WHY THE VERSION IS READ BEFORE THE LINK IS WAITED FOR, AND WHY IT CANNOT REFUSE THE RUN.
// /json/version answers "Chrome/<major>" for branded Chrome and for Chrome for Testing alike, and the two differ exactly here.
// So the payload is a suspect for the failure, never the verdict: a link that arrives ends the matter, and only a link that does not arrive hears about the flag.

test('the version number is a suspect for the failure, not the verdict', () => {
  assert.equal(chromeIgnoresLoadExtension('Chrome/153.0.8010.36'), true, 'a build that answers Chrome/153 is a suspect');
  assert.equal(chromeIgnoresLoadExtension('Chrome/137.0.0.0'), true, 'the boundary itself is a suspect');
  assert.equal(chromeIgnoresLoadExtension('Chrome/136.0.0.0'), false, 'and 136 is not');
  assert.equal(chromeIgnoresLoadExtension('HeadlessChrome/153.0.8010.36'), false, 'chrome-headless-shell answers with its own product');
  assert.equal(majorOf('Chrome/153.0.8010.36'), 153);
  assert.equal(majorOf('nothing'), null);
});

// WHY THE ROAD SENTENCE IS A FUNCTION OF THE MODE.
// A run that launches its own Chrome has a debugging port open on that browser; saying "no debugging port" next to it is the one claim the run cannot make.
// Rows with no header are a record of no road at all, and guessing one is exactly the drift the sentence exists to prevent.

test('the road sentence is true of the mode that ran', () => {
  const joined = roadFor({ mode: 'joined' });
  assert.match(joined, /joined that bridge/);
  assert.match(joined, /No debugging port, no cloud relay\./);

  const own = roadFor({ mode: 'own' });
  assert.match(own, /loaded into a real Chrome/);
  assert.doesNotMatch(own, /No debugging port/, 'a run that had to open one cannot claim it did not');
  assert.match(own, /still travelled over the bridge/s, 'the calls travelled over the bridge even in own mode');

  const headless = roadFor({ mode: undefined });
  assert.doesNotMatch(headless, /No debugging port/, 'a record with no header claims no road at all');
  assert.match(headless, /no header/, 'and says so');
});
