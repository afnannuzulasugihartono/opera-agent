// @last-edited: 2026-11-05 UTC+7.
// @title: landing-sample - the four artifacts the site offers are the bytes a fresh run makes, not a stale copy.
// @state: rebuilds the mock company's four artifacts into a temp folder and compares them byte for byte with landing/contoh/.
// @dependencies: node:test, strict, node:crypto, node:fs, node:os, node:path, ../local/spreadsheets.js, ../local/decks.js, ../local/documents.js.

// WHY THIS FILE EXISTS.
// A download on the site is a promise that what the product makes is what a visitor gets.
// The writers are deterministic on purpose, so the promise is checkable: build the four artifacts again and the bytes must be identical, or the site is showing something the code no longer makes.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spreadsheetFromFile } from '../../local/spreadsheets.js';
import { deckFromFile } from '../../local/decks.js';
import { documentDocxFromFile } from '../../local/documents.js';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const company = path.join(root, 'tests', 'fixtures', 'mock-company');
const shipped = path.join(root, 'landing', 'contoh');

test('the artifacts the site offers are a fresh build of the mock company', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-sample-'));
  try {
    const workbook = spreadsheetFromFile({
      source: path.join(company, 'transaksi-2026-09.csv'),
      client: 'Sinar Jaya',
      title: 'Laporan Keuangan September 2026',
      period: '2026-09',
      periodColumn: 'Tanggal',
      groupBy: 'Akun',
      valueColumn: 'Jumlah',
      out: path.join(out, 'laporan-keuangan-2026-09.xlsx')
    });
    const deck = deckFromFile({
      source: path.join(company, 'strategi.json'),
      report: workbook.plan,
      out: path.join(out, 'rencana-strategis-2027.pptx')
    });
    const paper = documentDocxFromFile({
      source: path.join(company, 'riset-promo.json'),
      out: path.join(out, 'riset-promo.docx')
    });
    const marketing = documentDocxFromFile({
      source: path.join(company, 'pemasaran.json'),
      out: path.join(out, 'rencana-pemasaran-2027.docx')
    });

    for (const artifact of [workbook, deck, paper, marketing]) {
      const name = path.basename(artifact.out);
      const fresh = fs.readFileSync(artifact.out);
      const onDisk = fs.readFileSync(path.join(shipped, name));
      assert.deepEqual(onDisk, fresh, `${name} on the site differs from a fresh build; run node scripts/proof/sample-artifacts.mjs`);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

// WHY THE PROOF PAGE IS CHECKED AGAINST THE SHIPPED FILES.
// The page prints the sha256 of each file and asks the reader to compare it with what they download.
// A page that prints the digest of a file the site no longer ships is a claim nothing keeps, so the digests are read from the bytes in landing/contoh/.

test('the proof page prints the digest of the file the site ships', () => {
  const page = fs.readFileSync(path.join(root, 'landing', 'bukti.html'), 'utf8');
  for (const name of ['laporan-keuangan-2026-09.xlsx', 'rencana-strategis-2027.pptx', 'riset-promo.docx', 'rencana-pemasaran-2027.docx']) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(shipped, name))).digest('hex');
    assert.ok(page.includes(digest), `${name} prints the sha256 of the file the site ships`);
    assert.ok(page.includes(name), `${name} is named on the proof page`);
  }
});

// WHY THE EXTENSION ROAD IS ON THE PROOF PAGE.
// The product ships a browser extension and claims it drives the everyday browser without a debugging port.
// The run that built the four files used a separate browser, so the page would leave a reader thinking that is the only road.
// The extension run is the road a reader can actually get, so the page names it and prints what it pulled, read from the record rather than typed by hand.

// WHY THE DIGEST COMES FROM THE RECORD: a hash typed into the page is a claim nothing keeps.
// The record holds the bytes the extension road pulled, so the page is checked against it.

test('the proof page names the extension road and prints what that road pulled', () => {
  const page = fs.readFileSync(path.join(root, 'landing', 'bukti.html'), 'utf8');
  const record = fs.readFileSync(path.join(root, 'docs', 'proof', 'extension-run.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const download = record.find((line) => line.kind === 'download');

  assert.ok(download, 'the extension run pulled a file');
  assert.match(page, /extension/i, 'the page names the extension');
  assert.match(page, /extension-run\.md/, 'and links the record of that run');
  assert.ok(page.includes(download.sha256), 'and prints the sha256 the extension road pulled');
  assert.ok(page.includes(String(download.bytes)), 'and the size it landed');
});

// WHY THE PRESS IS ON THE PAGE.
// A file that arrived says the drive fetched something, not that it pushed a button to get it.
// The press is the claim, so the page names the control the record shows was pressed.

test('the proof page says the drive pressed the control, and names it', () => {
  const page = fs.readFileSync(path.join(root, 'landing', 'bukti.html'), 'utf8');
  const record = fs.readFileSync(path.join(root, 'docs', 'proof', 'extension-run.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const download = record.find((line) => line.kind === 'download');

  const road = /aria-labelledby="roadTitle"[\s\S]*?<\/section>/.exec(page)?.[0] ?? '';
  const dict = JSON.parse(/<script type="application\/json" id="i18n-dict">([\s\S]*?)<\/script>/.exec(page)[1]);

  assert.ok(download.pressed, 'the record carries the press');
  assert.ok(road.includes(download.pressed.control.name), 'the road steps name the control that was pressed');
  assert.match(road, /ditekan/, 'the Indonesian road steps say the button was pressed');
  assert.ok(dict.en['road.three'].includes(download.pressed.control.name), 'the English road steps name it too');
  assert.match(dict.en['road.three'], /pressed/, 'the English road steps say the button was pressed');
});

// WHY THE PAGE IS CHECKED AGAINST THE REPORT.
// The case study page prints three figures and the rows behind them, so a reader can check the page against the file they downloaded.
// A page that prints a number the report no longer holds is a claim nothing keeps, so the page is read against a fresh build.

test('the case study page prints the figures the report holds', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-study-'));
  try {
    const workbook = spreadsheetFromFile({
      source: path.join(company, 'transaksi-2026-09.csv'),
      client: 'Sinar Jaya',
      title: 'Laporan Keuangan September 2026',
      period: '2026-09',
      periodColumn: 'Tanggal',
      groupBy: 'Akun',
      valueColumn: 'Jumlah',
      out: path.join(out, 'laporan-keuangan-2026-09.xlsx')
    });
    const plan = JSON.parse(fs.readFileSync(workbook.plan, 'utf8'));
    const page = fs.readFileSync(path.join(root, 'landing', 'studi.html'), 'utf8');

    for (const id of ['group:Pendapatan Penjualan', 'group:Beban Pokok Layanan', 'total']) {
      const figure = plan.report.figures.find((entry) => entry.id === id);
      assert.ok(figure, `the report holds ${id}`);
      assert.ok(page.includes(figure.display), `the page prints ${figure.display}`);
      const rows = figure.source.rows;
      const range = `${Math.min(...rows)}–${Math.max(...rows)}`;
      assert.ok(page.includes(range), `the page prints the rows ${range}`);
    }

    assert.equal(plan.verified.ok, true, 'the report checked its own figures');
    assert.equal(plan.verified.checked, 7, 'and it checked seven');
    assert.ok(page.includes('Tujuh angka diperiksa'), 'the page says how many figures were checked');
    assert.equal(workbook.sheets.length, 3, 'the workbook holds three sheets');
    assert.ok(page.includes('Tiga sheet'), 'and the page says so');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
