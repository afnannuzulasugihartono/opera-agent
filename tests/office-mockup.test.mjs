// @last-edited: 2026-11-05 UTC+7.
// @title: office-mockup - the four business jobs run on a mock company, and the files they leave behind.
// @state: a workbook, a deck and two Word files, each checked against the rows the figures came from.
// @dependencies: node:test, strict, node:fs, node:os, node:path, node:child_process, ../local/office/zip.js, ../local/office/xml.js, ../local/office/xlsx.js, ../local/office/pptx.js, ../local/office/docx.js, ../local/spreadsheets.js, ../local/decks.js, ../local/documents.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { crc32, zipBytes } from '../local/office/zip.js';
import { cellAddress, columnName, escapeXml } from '../local/office/xml.js';
import { buildWorkbook } from '../local/office/xlsx.js';
import { buildDeck } from '../local/office/pptx.js';
import { buildDocumentFile } from '../local/office/docx.js';
import { spreadsheetFromFile } from '../local/spreadsheets.js';
import { deckFromFile } from '../local/decks.js';
import { documentDocxFromFile } from '../local/documents.js';
import { parseDelimited, parseMoney } from '../local/reports.js';

const company = path.resolve('tests/fixtures/mock-company');

function readZip(bytes) {
  const buffer = Buffer.from(bytes);
  let end = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('the file carries no end of central directory, so it is not an archive.');
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const size = buffer.readUInt32LE(localOffset + 18);
    entries.set(name, buffer.subarray(dataStart, dataStart + size));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opera-office-'));
}

function csvText() {
  return fs.readFileSync(path.join(company, 'transaksi-2026-09.csv'), 'utf8');
}

function buildMockup(dir) {
  const source = path.join(dir, 'transaksi-2026-09.csv');
  fs.writeFileSync(source, csvText());
  const workbook = spreadsheetFromFile({
    source,
    client: 'Sinar Jaya',
    title: 'Laporan Keuangan September 2026',
    period: '2026-09',
    periodColumn: 'Tanggal',
    groupBy: 'Akun',
    valueColumn: 'Jumlah',
    out: path.join(dir, 'laporan.xlsx')
  });
  const deck = deckFromFile({
    source: path.join(company, 'strategi.json'),
    report: workbook.plan,
    out: path.join(dir, 'rencana.pptx')
  });
  const paper = documentDocxFromFile({
    source: path.join(company, 'riset-promo.json'),
    out: path.join(dir, 'riset.docx')
  });
  const marketing = documentDocxFromFile({
    source: path.join(company, 'pemasaran.json'),
    out: path.join(dir, 'pemasaran.docx')
  });
  return { workbook, deck, paper, marketing };
}

test('the archive holds what it says it holds, and the same bytes twice', () => {
  const bytes = zipBytes([{ name: 'a.txt', data: 'halo' }]);
  const entries = readZip(bytes);
  assert.equal(entries.get('a.txt').toString('utf8'), 'halo');
  assert.equal(crc32(Buffer.from('halo')), crc32(Buffer.from('halo')));
  const again = zipBytes([{ name: 'a.txt', data: 'halo' }]);
  assert.deepEqual([...again], [...bytes], 'one report is one hash, so the clock stays out of the file');
});

test('the text of a cell is escaped and a column continues past Z', () => {
  const amp = String.fromCharCode(38);
  assert.equal(escapeXml('P&L <2026>'), `P${amp}amp;L ${amp}lt;2026${amp}gt;`);
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(cellAddress(27, 4), 'AB4');
});

test('a writer refuses a file it cannot make', () => {
  assert.throws(() => buildWorkbook({ sheets: [] }), /at least one sheet/);
  assert.throws(() => buildWorkbook({ sheets: [{ name: 'a/b', rows: [] }] }), /Excel does not allow/);
  assert.throws(() => buildDeck({ slides: [] }), /at least one slide/);
  assert.throws(() => buildDeck({ slides: [{ title: '', bullets: [] }] }), /needs a title/);
  assert.throws(() => buildDocumentFile({ blocks: [] }), /at least one block/);
});

test('the mock company leaves a workbook whose figures match the rows they came from', () => {
  const dir = workspace();
  const { workbook } = buildMockup(dir);

  const entries = readZip(fs.readFileSync(workbook.out));
  assert.ok(entries.has('[Content_Types].xml'));
  assert.ok(entries.has('xl/workbook.xml'));
  assert.ok(entries.has('xl/styles.xml'));
  assert.ok(entries.has('xl/worksheets/sheet1.xml'));

  const sheetNames = entries.get('xl/workbook.xml').toString('utf8');
  assert.match(sheetNames, /name="Laporan"/);
  assert.match(sheetNames, /name="Sumber"/);
  assert.match(sheetNames, /name="Angka"/);

  const table = parseDelimited(csvText());
  const revenue = table.rows
    .filter((row) => row.Akun === 'Pendapatan Penjualan')
    .reduce((sum, row) => sum + parseMoney(row.Jumlah), 0);
  const reported = workbook.figures.find((figure) => figure.id === 'group:Pendapatan Penjualan');
  assert.equal(reported.cents, revenue, 'the workbook total is the sum of the rows it names');

  const reportSheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.ok(reportSheet.includes(`<v>${revenue / 100}</v>`), 'the total is a number a spreadsheet can add');
  assert.ok(reportSheet.includes('<v>-36500000</v>'), 'a cost keeps its sign');
});

test('a deck carries a figure the report checked, and refuses one it does not hold', () => {
  const dir = workspace();
  const { deck, workbook } = buildMockup(dir);

  const entries = readZip(fs.readFileSync(deck.out));
  assert.ok(entries.has('ppt/presentation.xml'));
  assert.ok(entries.has('ppt/theme/theme1.xml'));
  assert.ok(entries.has('ppt/slides/slide4.xml'));

  const slide = entries.get('ppt/slides/slide3.xml').toString('utf8');
  const figure = workbook.figures.find((item) => item.id === 'group:Pendapatan Penjualan');
  assert.ok(slide.includes(figure.display), 'the slide shows the checked value');

  const spec = path.join(dir, 'salah.json');
  fs.writeFileSync(spec, JSON.stringify({ title: 'Dek', slides: [{ title: 'Satu', bullets: [], figure: 'group:TidakAda' }] }));
  assert.throws(() => deckFromFile({ source: spec, report: workbook.plan }), /does not hold it/);
});

test('a paper becomes a Word file with its headings, its tables and its numbers', () => {
  const dir = workspace();
  const { paper } = buildMockup(dir);

  const entries = readZip(fs.readFileSync(paper.out));
  assert.ok(entries.has('word/document.xml'));
  assert.ok(entries.has('word/styles.xml'));

  const document = entries.get('word/document.xml').toString('utf8');
  assert.ok(document.includes('Dampak Promosi terhadap Kinerja Kanal Sinar Jaya'));
  assert.ok(document.includes('Ringkasan eksekutif'));
  assert.ok(document.includes('Tambahan pendapatan per kanal'));
  assert.ok(document.includes('12500000'), 'the graph carries the numbers it was checked against');
});

test('a month outside the period stops the workbook before the file exists', () => {
  const dir = workspace();
  const source = path.join(dir, 'bocor.csv');
  fs.writeFileSync(source, 'Tanggal,Akun,Jumlah\n2026-08-30,Pendapatan Penjualan,1.000.000\n');
  assert.throws(() => spreadsheetFromFile({
    source,
    client: 'A',
    title: 'B',
    period: '2026-09',
    periodColumn: 'Tanggal',
    groupBy: 'Akun',
    valueColumn: 'Jumlah'
  }), /outside the requested period/);
});

test('the real readers open what this writes, where they are installed', (t) => {
  const dir = workspace();
  const { workbook, deck, paper } = buildMockup(dir);

  const python = ['python3', 'py'].find((name) => {
    try {
      execFileSync(name, ['-c', 'import openpyxl, pptx, docx'], { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  });
  if (!python) {
    t.skip('openpyxl, python-pptx and python-docx are not installed on this machine');
    return;
  }

  const script = `
import openpyxl, pptx, docx
book = openpyxl.load_workbook(r'${workbook.out}')
assert book.sheetnames == ['Laporan', 'Sumber', 'Angka'], book.sheetnames
rows = [[cell.value for cell in row] for row in book['Laporan'].iter_rows()]
assert rows[1][1] == -36500000, rows[1]
presentation = pptx.Presentation(r'${deck.out}')
assert len(presentation.slides) == 4, len(presentation.slides)
paper = docx.Document(r'${paper.out}')
assert any('Dampak Promosi' in paragraph.text for paragraph in paper.paragraphs)
print('readers ok')
`;
  const out = execFileSync(python, ['-c', script], { encoding: 'utf8' });
  assert.match(out, /readers ok/);
});
