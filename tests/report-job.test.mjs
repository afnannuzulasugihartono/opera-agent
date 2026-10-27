// @last-edited: 2026-10-22 UTC+7.
// @title: report-job — a table becomes figures that name their source, and a figure that cannot be checked is refused.
// @state: the parser, the money rule, the period guard, the docplan and the recheck, each pinned by one behaviour.
// @dependencies: node:test, strict, ../local/jobs/reports.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseDelimited, parseMoney, buildReport, verifyReport, reportFromFile } from '../local/jobs/reports.js';

// WHY THE FIXTURE IS A CSV AND NOT A WORKBOOK.
// A workbook is a zip of XML and a second parser; a CSV is what Excel and Sheets both export in one click, and the money rules are the same either way.
// The parser is pinned first so that a later workbook reader has an answer to match.

const CSV = '\ufeffTanggal,Kategori,Penjualan\r\n'
  + '2026-09-01,Retail,"1.250.000"\r\n'
  + '2026-09-02,Grosir,"2.000.000"\r\n'
  + '2026-09-03,Retail,"750.000"\r\n';

const SPEC = {
  client: 'Toko Sinar Jaya',
  title: 'Laporan Penjualan',
  period: '2026-09',
  periodColumn: 'Tanggal',
  groupBy: 'Kategori',
  valueColumn: 'Penjualan'
};

test('a quoted field keeps its comma and a BOM is not part of the first header', () => {
  const table = parseDelimited(CSV);
  assert.deepEqual(table.headers, ['Tanggal', 'Kategori', 'Penjualan']);
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[0].Kategori, 'Retail');
  assert.equal(table.rows[0].Penjualan, '1.250.000');
  assert.equal(table.rows[0].__line, 2);
});

test('an Indonesian money string becomes integer cents, and a value that is not money is null', () => {
  assert.equal(parseMoney('Rp 1.250.000,00'), 125000000);
  assert.equal(parseMoney('(1.000)'), -100000);
  assert.equal(parseMoney('750.000'), 75000000);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(''), null);
});

test('a value that is not money stops the report and names its line', () => {
  const bad = CSV.replace('"750.000"', '"tujuh ratus"');
  assert.throws(
    () => buildReport({ table: parseDelimited(bad), spec: SPEC }),
    /line 4.*Penjualan.*tujuh ratus/
  );
});

test('a row outside the requested period stops the report', () => {
  const bad = CSV.replace('2026-09-03', '2026-08-31');
  assert.throws(
    () => buildReport({ table: parseDelimited(bad), spec: SPEC }),
    /2026-08-31.*2026-09/
  );
});

test('a missing column stops the report and names the column', () => {
  const spec = { ...SPEC, valueColumn: 'Omzet' };
  assert.throws(
    () => buildReport({ table: parseDelimited(CSV), spec }),
    /Omzet/
  );
});

test('a table with no rows stops the report', () => {
  assert.throws(
    () => buildReport({ table: parseDelimited('Tanggal,Kategori,Penjualan\r\n'), spec: SPEC }),
    /no rows/
  );
});

test('every figure carries the exact rows that produced it', () => {
  const report = buildReport({ table: parseDelimited(CSV), spec: SPEC });
  const total = report.figures.find((figure) => figure.id === 'total');
  assert.equal(total.cents, 400000000);
  assert.equal(total.display, 'Rp 4.000.000');
  assert.deepEqual(total.source.rows, [2, 3, 4]);
  assert.equal(total.source.column, 'Penjualan');

  const retail = report.figures.find((figure) => figure.id === 'group:Retail');
  assert.equal(retail.cents, 200000000);
  assert.deepEqual(retail.source.rows, [2, 4]);
});

test('the group totals add up to the grand total', () => {
  const report = buildReport({ table: parseDelimited(CSV), spec: SPEC });
  const total = report.figures.find((figure) => figure.id === 'total');
  const groups = report.figures.filter((figure) => figure.id.startsWith('group:'));
  const sum = groups.reduce((cents, figure) => cents + figure.cents, 0);
  assert.equal(sum, total.cents);
});

test('the docplan is the report a person reads, in the same numbers', () => {
  const report = buildReport({ table: parseDelimited(CSV), spec: SPEC });
  const table = report.docplan.blocks.find((block) => block.kind === 'table');
  assert.deepEqual(table.headers, ['Kategori', 'Total']);
  assert.deepEqual(table.rows, [['Grosir', 'Rp 2.000.000'], ['Retail', 'Rp 2.000.000']]);
  const total = report.docplan.blocks.find((block) => block.id === 'total');
  assert.equal(total.text, 'Total: Rp 4.000.000');
});

test('a blank line is skipped, and the line after it keeps its own number', () => {
  const withBlank = CSV.replace('2026-09-02', '\r\n2026-09-02');
  const table = parseDelimited(withBlank);
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[1].__line, 4);
});

test('the recheck passes when every figure still equals its source', () => {
  const table = parseDelimited(CSV);
  const report = buildReport({ table, spec: SPEC });
  const out = verifyReport({ report, table });
  assert.equal(out.ok, true);
  assert.equal(out.mismatches.length, 0);
});

test('the recheck catches a figure that was edited after it was computed', () => {
  const table = parseDelimited(CSV);
  const report = buildReport({ table, spec: SPEC });
  const forged = structuredClone(report);
  forged.figures[0].cents += 1;
  forged.figures[0].display = 'Rp 4.000.000,01';

  const out = verifyReport({ report: forged, table });
  assert.equal(out.ok, false);
  assert.equal(out.mismatches.length, 1);
  assert.equal(out.mismatches[0].id, forged.figures[0].id);
});

test('a CSV file becomes a checked report file beside it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-report-'));
  const source = path.join(dir, 'penjualan-2026-09.csv');
  fs.writeFileSync(source, CSV);
  try {
    const out = reportFromFile({
      source,
      client: SPEC.client,
      title: SPEC.title,
      period: SPEC.period,
      periodColumn: SPEC.periodColumn,
      groupBy: SPEC.groupBy,
      valueColumn: SPEC.valueColumn
    });
    assert.equal(out.out, path.join(dir, 'penjualan-2026-09.report.json'));
    const artifact = JSON.parse(fs.readFileSync(out.out, 'utf8'));
    assert.equal(artifact.source, source);
    assert.equal(artifact.verified.ok, true);
    assert.equal(artifact.report.figures.find((figure) => figure.id === 'total').cents, 400000000);
    assert.equal(artifact.report.docplan.blocks.find((block) => block.id === 'total').text, 'Total: Rp 4.000.000');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing source file is refused by name, not reported as an empty table', () => {
  assert.throws(
    () => reportFromFile({
      source: path.join(os.tmpdir(), 'no-such-report-source.csv'),
      client: SPEC.client,
      title: SPEC.title,
      period: SPEC.period,
      groupBy: SPEC.groupBy,
      valueColumn: SPEC.valueColumn
    }),
    /no file at/
  );
});
