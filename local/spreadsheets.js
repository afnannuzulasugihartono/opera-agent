// @last-edited: 2026-11-05 UTC+7.
// @title: spreadsheets - an exported sheet becomes a workbook a bookkeeper opens, with every figure naming its rows.
// @state: CSV in, a checked workbook and a checked plan out, both written beside the source.
// @dependencies: node:fs, node:path, ./reports.js, ./office/xlsx.js.

// WHY THE WORKBOOK HOLDS THREE SHEETS.
// The report lines are what the customer reads, the source rows are what the customer checks, and the figure ledger is what says which rows produced which line.
// A workbook with only the first sheet is a claim, and a claim a bookkeeper cannot check is a claim they will not pay for.

// WHY THE TOTALS ARE NUMBERS AND NOT TEXT.
// A total that is a sentence cannot be added to another sheet, so the cell holds the rupiah value as a number and the format shows it as rupiah.

// WHY THE PLAN IS WRITTEN BESIDE THE WORKBOOK.
// A deck, a paper or a later month may need the same figures, and recomputing them from the CSV each time is how two documents end up disagreeing.

import fs from 'node:fs';
import path from 'node:path';

import { buildReport, parseDelimited, verifyReport } from './reports.js';
import { buildWorkbook } from './office/xlsx.js';

const HEAD = (text) => ({ value: text, bold: true });
const MONEY = (cents) => ({ value: cents / 100, money: true });

export function spreadsheetFromFile({
  source, client, title, period, periodColumn = null, groupBy, valueColumn, out = null
} = {}) {
  if (source === null || source === undefined || String(source).trim() === '') {
    throw new Error('spreadsheet_build needs source: the CSV exported from the workbook.');
  }
  const from = path.resolve(String(source));
  let stat;
  try {
    stat = fs.statSync(from);
  } catch (error) {
    throw new Error(`no file at ${from} (${error.code ?? error.message}); export the sheet to CSV and pass that path.`);
  }
  if (!stat.isFile()) throw new Error(`${from} is not a file; a folder cannot be a report source.`);
  if (stat.size === 0) throw new Error(`${from} is zero bytes; an empty export is not a table.`);

  const table = parseDelimited(fs.readFileSync(from, 'utf8'));
  const report = buildReport({ table, spec: { client, title, period, periodColumn, groupBy, valueColumn } });
  const verified = verifyReport({ report, table });
  if (!verified.ok) {
    throw new Error(`the workbook failed its own recheck: ${verified.mismatches.map((miss) => miss.why ?? miss.id).join('; ')}`);
  }

  const groups = report.figures.filter((figure) => figure.id.startsWith('group:'));
  const total = report.figures.find((figure) => figure.id === 'total');

  const reportRows = [[HEAD(groupBy), HEAD('Total')]];
  for (const figure of groups) reportRows.push([figure.label, MONEY(figure.cents)]);
  reportRows.push([HEAD('Total'), { value: total.cents / 100, money: true, bold: true }]);

  const sourceRows = [[HEAD('Baris'), ...table.headers.map((header) => HEAD(header))]];
  for (const row of table.rows) sourceRows.push([row.__line, ...table.headers.map((header) => String(row[header] ?? ''))]);

  const ledgerRows = [[HEAD('Angka'), HEAD('Nilai'), HEAD('Kolom'), HEAD('Baris')]];
  for (const figure of report.figures) {
    ledgerRows.push([
      figure.label,
      { value: figure.cents / 100, money: true },
      figure.source.column,
      figure.source.rows.join(', ')
    ]);
  }

  const workbook = buildWorkbook({
    sheets: [
      { name: 'Laporan', rows: reportRows },
      { name: 'Sumber', rows: sourceRows },
      { name: 'Angka', rows: ledgerRows }
    ]
  });

  const base = path.join(path.dirname(from), path.basename(from, path.extname(from)));
  const outPath = out === null || out === undefined || String(out).trim() === ''
    ? `${base}.xlsx`
    : path.resolve(String(out));
  const planPath = `${base}.report.json`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.writing`;
  fs.writeFileSync(tmp, workbook);
  fs.rmSync(outPath, { force: true });
  fs.renameSync(tmp, outPath);

  const plan = { source: from, generatedAt: new Date().toISOString(), verified, report };
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 1)}\n`);

  return {
    source: from,
    out: outPath,
    plan: planPath,
    bytes: workbook.length,
    verified,
    sheets: ['Laporan', 'Sumber', 'Angka'],
    figures: report.figures.map((figure) => ({ id: figure.id, label: figure.label, cents: figure.cents, display: figure.display }))
  };
}
