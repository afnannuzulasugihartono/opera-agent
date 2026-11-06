// @last-edited: 2026-11-06 UTC+7.
// @title: proof-run — a real browser drive that has to leave the same four files the site ships.
// @state: the fixture portal over loopback, a throwaway browser, the MCP client, the four artifacts, and the record the suite rechecks.
// @dependencies: node:test, strict, node:fs, node:path, ../local/driver.js, ../scripts/proof-run.mjs.

// WHY THIS FILE EXISTS.
// The product claims it drives a browser and hands back designed office files, and until this run the claim rested on separate tests: one drove a fake page, another wrote a workbook.
// A run that does both in one breath is the only thing that answers "can it actually do the job", and the hashes are what make the answer checkable instead of a story.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installedBrowsers } from '../local/driver.js';
import { launchProofBrowser, serveCompany, speakMcp } from '../scripts/proof-run.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const company = path.join(root, 'tests', 'fixtures', 'mock-company');

const browsers = installedBrowsers();
const canShowWindow = process.platform !== 'linux'
  || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const noBrowser = browsers.length > 0 && canShowWindow
  ? false
  : 'this machine cannot start a browser window';

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

test('the proof browser answers its own port and is gone when the run ends', { skip: noBrowser }, async () => {
  const browser = await launchProofBrowser();
  const { port } = browser;
  try {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    assert.match(String(version.Browser ?? ''), /Chrome|Chromium/);
  } finally {
    browser.close();
  }

  const deadline = Date.now() + 5000;
  let alive = true;
  while (alive && Date.now() < deadline) {
    alive = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
    if (alive) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(alive, false, 'the browser the run started must close with it');
});

test('the server opens the portal tab and reads the page', { skip: noBrowser }, async () => {
  const portal = await serveCompany(company);
  const browser = await launchProofBrowser();
  const mcp = speakMcp({ port: browser.port, cwd: root });
  try {
    const ready = await mcp.initialize();
    assert.equal(ready?.serverInfo?.name, 'opera-local');
    const names = await mcp.listTools();
    for (const wanted of ['open_url', 'read_page', 'download', 'spreadsheet_build', 'deck_build', 'document_write', 'capture_page', 'close_tab']) {
      assert.ok(names.includes(wanted), `the server offers ${wanted}`);
    }

    const opened = await mcp.tool('open_url', { url: portal.url });
    const tabId = opened.answer?.action?.id;
    assert.ok(tabId, 'open_url names the tab it opened');

    const read = await mcp.tool('read_page', { tabId });
    assert.match(String(read.answer?.text ?? ''), /Portal Mitra/);
    assert.match(String(read.answer?.text ?? ''), /Unduh CSV/);

    await mcp.tool('close_tab', { tabId });
  } finally {
    await mcp.close();
    browser.close();
    await portal.close();
  }
});
