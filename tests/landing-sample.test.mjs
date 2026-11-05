// @last-edited: 2026-11-05 UTC+7.
// @title: landing-sample - the four artifacts the site offers are the bytes a fresh run makes, not a stale copy.
// @state: rebuilds the mock company's four artifacts into a temp folder and compares them byte for byte with landing/contoh/.
// @dependencies: node:test, strict, node:fs, node:os, node:path, ../local/spreadsheets.js, ../local/decks.js, ../local/documents.js.

// WHY THIS FILE EXISTS.
// A download on the site is a promise that what the product makes is what a visitor gets.
// The writers are deterministic on purpose, so the promise is checkable: build the four artifacts again and the bytes must be identical, or the site is showing something the code no longer makes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spreadsheetFromFile } from '../local/spreadsheets.js';
import { deckFromFile } from '../local/decks.js';
import { documentDocxFromFile } from '../local/documents.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
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
      assert.deepEqual(onDisk, fresh, `${name} on the site differs from a fresh build; run node scripts/sample-artifacts.mjs`);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
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
