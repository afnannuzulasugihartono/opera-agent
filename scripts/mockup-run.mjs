// @last-edited: 2026-11-05 UTC+7.
// @title: mockup-run - the four business jobs of a mock company, run end to end on this machine.
// @state: one CSV in, one workbook, one deck, and two Word files out, each with the hash of its bytes.
// @dependencies: node:crypto, node:fs, node:path, local/spreadsheets.js, local/decks.js, local/documents.js.

// WHY THIS SCRIPT IS COMMITTED AND NOT AD-HOC.
// The claim this product makes is that it can do the work of a back office: a financial report, a strategy deck, a research paper, a marketing plan.
// A claim like that is worth nothing without the artifacts, so this script produces them from a mock company and prints where each one landed and what it weighs.

// WHY THE MOCK COMPANY LIVES IN THE TEST FIXTURES.
// The same numbers have to answer the test suite and the demo, so the company is one set of files that both read.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { spreadsheetFromFile } from '../local/spreadsheets.js';
import { deckFromFile } from '../local/decks.js';
import { documentDocxFromFile } from '../local/documents.js';

const company = path.resolve('tests/fixtures/mock-company');
const outDir = path.resolve(process.argv[2] ?? 'tmp/mockup');

fs.mkdirSync(outDir, { recursive: true });

const source = path.join(company, 'transaksi-2026-09.csv');
const workbook = spreadsheetFromFile({
  source,
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

const artifacts = [workbook, deck, paper, marketing];

const lines = artifacts.map((artifact) => {
  const bytes = fs.readFileSync(artifact.out);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return `${artifact.out} ${bytes.length} bytes sha256:${hash}`;
});

const figures = workbook.figures.map((figure) => `${figure.id} ${figure.display}`);

console.log(lines.join('\n'));
console.log(`figures: ${figures.join(' | ')}`);
console.log(`deck slides: ${deck.slides}, deck figures: ${deck.figures.map((figure) => figure.display).join(' | ')}`);
console.log(`paper blocks: ${paper.blocks}, paper images: ${paper.images.total}`);
console.log(`verified: ${workbook.verified.ok && paper.verified.ok && marketing.verified.ok}`);
