// @last-edited: 2026-11-05 UTC+7.
// @title: sample-artifacts — the four business artifacts the site hands a visitor, built from the mock company.
// @state: writes landing/contoh/ so the download is a real file and a test can prove the bytes on disk are a fresh build.
// @dependencies: node:fs, node:path, local/spreadsheets.js, local/decks.js, local/documents.js.

// WHY THE SITE SHIPS REAL FILES AND NOT A SCREENSHOT.
// A buyer who can open a workbook, a deck and a paper from one conversation is looking at the product working, not at a claim about it.
// The bytes are deterministic, so the committed file and a fresh build are the same file, and a drift test can say so.

// WHY THIS READS THE SAME FIXTURES THE TESTS DO.
// The demo and the suite share one mock company, so a number on the site that drifts from the code that makes it is a failing test rather than a quiet lie.

import fs from 'node:fs';
import path from 'node:path';

import { spreadsheetFromFile } from '../local/spreadsheets.js';
import { deckFromFile } from '../local/decks.js';
import { documentDocxFromFile } from '../local/documents.js';

const company = path.resolve('tests/fixtures/mock-company');
const outDir = path.resolve(process.argv[2] ?? 'landing/contoh');
fs.mkdirSync(outDir, { recursive: true });

const workbook = spreadsheetFromFile({
  source: path.join(company, 'transaksi-2026-09.csv'),
  client: 'Sinar Jaya',
  title: 'Laporan Keuangan September 2026',
  period: '2026-09',
  periodColumn: 'Tanggal',
  groupBy: 'Akun',
  valueColumn: 'Jumlah',
  out: path.join(outDir, 'laporan-keuangan-2026-09.xlsx')
});

const deck = deckFromFile({
  source: path.join(company, 'strategi.json'),
  report: workbook.plan,
  out: path.join(outDir, 'rencana-strategis-2027.pptx')
});

const paper = documentDocxFromFile({
  source: path.join(company, 'riset-promo.json'),
  out: path.join(outDir, 'riset-promo.docx')
});

const marketing = documentDocxFromFile({
  source: path.join(company, 'pemasaran.json'),
  out: path.join(outDir, 'rencana-pemasaran-2027.docx')
});

for (const artifact of [workbook, deck, paper, marketing]) {
  console.log(`${artifact.out} ${fs.readFileSync(artifact.out).length} bytes`);
}
