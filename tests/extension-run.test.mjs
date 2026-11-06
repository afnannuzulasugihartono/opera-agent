// @last-edited: 2026-11-06 UTC+7.
// @title: extension-run — the shipped extension drove a real browser, and the record says so.
// @state: the recorded call sequence, the transport it used, the download hash, and the picture.
// @dependencies: node:test, strict, node:fs, node:path, node:url.

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
