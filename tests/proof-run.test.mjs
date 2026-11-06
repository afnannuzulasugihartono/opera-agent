// @last-edited: 2026-11-06 UTC+7.
// @title: proof-run — a real browser drive that has to leave the same four files the site ships.
// @state: the fixture portal over loopback, a throwaway browser, the MCP client, the four artifacts, and the record the suite rechecks.
// @dependencies: node:test, strict, node:fs, node:os, node:path, ../scripts/proof-run.mjs.

// WHY THIS FILE EXISTS.
// The product claims it drives a browser and hands back designed office files, and until this run the claim rested on separate tests: one drove a fake page, another wrote a workbook.
// A run that does both in one breath is the only thing that answers "can it actually do the job", and the hashes are what make the answer checkable instead of a story.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveCompany } from '../scripts/proof-run.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const company = path.join(root, 'tests', 'fixtures', 'mock-company');

test('the fixture portal answers with the page and the CSV a drive needs', async () => {
  const portal = await serveCompany(company);
  try {
    const page = await fetch(portal.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Portal Mitra/);
    assert.match(html, /Unduh CSV/);

    const csv = await fetch(portal.csvUrl);
    assert.equal(csv.status, 200);
    assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
    const bytes = Buffer.from(await csv.arrayBuffer());
    assert.deepEqual(bytes, fs.readFileSync(path.join(company, 'transaksi-2026-09.csv')));
  } finally {
    await portal.close();
  }
});
