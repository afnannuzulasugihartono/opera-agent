// @last-edited: 2026-10-22 UTC+7.
// @title: reports — a table becomes figures that name their source, and a figure that cannot be checked is refused.
// @state: CSV/TSV text in, a docplan and a figure ledger out, plus the recheck that catches an edited number.
// @dependencies: node:fs, node:path.

// WHY THE FIGURE KEEPS ITS SOURCE ROWS.
// A report that says "Rp 4.000.000" without saying which lines produced it cannot be checked by the person paying for it.
// So every figure carries the column and the exact row numbers it was computed from, and the recheck recomputes it from those rows.

// WHY MONEY IS INTEGER CENTS.
// A report is a bill's neighbour: 0.1 + 0.2 must not become 0.30000000000000004 in front of a client.
// The parser understands the Indonesian shape (dot groups thousands, comma groups sen) and answers null rather than guessing.

// WHY THE PERIOD IS CHECKED ROW BY ROW.
// A workbook that still holds last month's rows produces a report that looks right and is wrong by a month.
// The row that disagrees is named, because "the period is wrong" without a line number is a bug report nobody can act on.

import fs from 'node:fs';
import path from 'node:path';

const PERIOD_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;

function rowsOf(text) {
  const records = [];
  let cells = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      cells.push(field);
      field = '';
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      cells.push(field);
      records.push({
        cells,
        line: rowLine
      });
      cells = [];
      field = '';
      line += 1;
      rowLine = line;
      continue;
    }
    field += char;
  }

  if (field !== '' || cells.length > 0) {
    cells.push(field);
    records.push({
      cells,
      line: rowLine
    });
  }
  return records;
}

export function parseDelimited(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '');
  const records = rowsOf(clean).filter((record) => record.cells.some((cell) => cell.trim() !== ''));
  if (records.length === 0) return {
    headers: [],
    rows: []
  };
  const headers = records[0].cells.map((header) => header.trim());
  const rows = records.slice(1).map((record) => {
    const row = { __line: record.line };
    headers.forEach((
      header,
      index
    ) => {
      row[header] = record.cells[index] ?? '';
    });
    return row;
  });
  return {
    headers,
    rows
  };
}

// WHY A DOT IS ALWAYS A THOUSANDS GROUP.
// In Indonesian money the dot groups thousands and the comma groups sen, so "1.250" is one thousand two hundred fifty, not one and a quarter.
// A fraction longer than two digits is not money this ledger can hold, and null says so instead of rounding somebody's cent away.

export function parseMoney(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  text = text.replace(/[()]/g, '').replace(/^-/, '').replace(/[^\d.,]/g, '');
  if (text === '' || /^\D*$/.test(text)) return null;

  const comma = text.lastIndexOf(',');
  let whole;
  let fraction = '';
  if (comma >= 0) {
    whole = text.slice(0, comma).replace(/\./g, '');
    fraction = text.slice(comma + 1);
  } else {
    whole = text.replace(/\./g, '');
  }
  if (fraction.length > 2) return null;
  const digits = whole === '' ? '0' : whole;
  if (!/^\d+$/.test(digits) || (fraction !== '' && !/^\d+$/.test(fraction))) return null;
  const cents = Number(digits) * 100 + Number(fraction.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

function formatMoney(cents) {
  const value = Math.abs(Number(cents) || 0) / 100;
  return `${cents < 0 ? '-' : ''}Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}

function need(
  value,
  what
) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(`the report spec needs ${what}; a report without one is a document nobody can check.`);
  }
  return String(value).trim();
}

export function buildReport({
  table,
  spec
} = {}) {
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) {
    throw new Error('buildReport needs a parsed table: headers and rows.');
  }
  const client = need(spec?.client, 'client');
  const title = need(spec?.title, 'title');
  const period = need(spec?.period, 'period');
  const groupBy = need(spec?.groupBy, 'groupBy');
  const valueColumn = need(spec?.valueColumn, 'valueColumn');
  if (!PERIOD_SHAPE.test(period)) {
    throw new Error(`the period must be YYYY-MM, like 2026-09; got "${period}".`);
  }
  for (const column of [groupBy, valueColumn, spec?.periodColumn].filter(Boolean)) {
    if (!table.headers.includes(column)) {
      throw new Error(`the table has no column "${column}"; the report declares it, so a typo here is a wrong report later.`);
    }
  }
  if (table.rows.length === 0) {
    throw new Error('the table has no rows; a report of nothing is not a report.');
  }

  const groups = new Map();
  let total = 0;
  const totalRows = [];
  for (const row of table.rows) {
    const line = row.__line;
    if (spec?.periodColumn) {
      const stamp = String(row[spec.periodColumn] ?? '').trim();
      if (!stamp.startsWith(period)) {
        throw new Error(`line ${line}: "${stamp}" is outside the requested period ${period}; a report that mixes months is wrong in a way nobody sees.`);
      }
    }
    const raw = String(row[valueColumn] ?? '').trim();
    const cents = parseMoney(raw);
    if (cents === null) {
      throw new Error(`line ${line}: ${valueColumn} is not money: "${raw}"${raw === '' ? ' (an empty cell is not zero)' : ''}.`);
    }
    const group = String(row[groupBy] ?? '').trim();
    if (group === '') {
      throw new Error(`line ${line}: ${groupBy} is empty; a total without a group is not a report line.`);
    }
    total += cents;
    totalRows.push(line);
    const bucket = groups.get(group) ?? {
      cents: 0,
      rows: []
    };
    bucket.cents += cents;
    bucket.rows.push(line);
    groups.set(group, bucket);
  }

  const figures = [{
    id: 'total',
    label: 'Total',
    cents: total,
    display: formatMoney(total),
    formula: 'sum',
    source: {
      column: valueColumn,
      header: valueColumn,
      rows: totalRows
    }
  }];
  for (const [group, bucket] of [...groups.entries()].sort((
    [left],
    [right]
  ) => (left < right ? -1 : left > right ? 1 : 0))) {
    figures.push({
      id: `group:${group}`,
      label: group,
      cents: bucket.cents,
      display: formatMoney(bucket.cents),
      formula: 'sum',
      source: {
        column: valueColumn,
        header: valueColumn,
        rows: bucket.rows
      }
    });
  }

  const groupSum = [...groups.values()].reduce((
    sum,
    bucket
  ) => sum + bucket.cents, 0);
  if (groupSum !== total) {
    throw new Error(`the group totals (${groupSum}) do not add up to the total (${total}); the report would carry a number its own lines deny.`);
  }

  return {
    client,
    title,
    period,
    figures,
    docplan: {
      title,
      client,
      period,
      blocks: [
        {
          kind: 'heading',
          level: 1,
          text: title
        },
        {
          kind: 'paragraph',
          text: `Klien: ${client} · Periode: ${period}`
        },
        {
          kind: 'table',
          headers: [
            groupBy,
            'Total'
          ],
          rows: [...groups.entries()]
            .sort((
              [left],
              [right]
            ) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([
              group,
              bucket
            ]) => [
              group,
              formatMoney(bucket.cents)
            ])
        },
        {
          kind: 'paragraph',
          id: 'total',
          text: `Total: ${formatMoney(total)}`
        }
      ]
    },
    check: {
      rows: table.rows.length,
      columns: {
        groupBy,
        valueColumn,
        periodColumn: spec?.periodColumn ?? null
      }
    }
  };
}

// WHY THE RECHECK IS SEPARATE FROM THE BUILD.
// Building trusts the table once; the recheck trusts nothing and recomputes every figure from the rows the figure names.
// That is the difference between a plan that was right when it was made and a plan that is still right now.

export function verifyReport({
  report,
  table
} = {}) {
  if (!report || !Array.isArray(report.figures)) {
    throw new Error('verifyReport needs a report with figures.');
  }
  if (!table || !Array.isArray(table.rows)) {
    throw new Error('verifyReport needs the table the report was built from.');
  }
  const byLine = new Map(table.rows.map((row) => [
    row.__line,
    row
  ]));
  const mismatches = [];

  for (const figure of report.figures) {
    const rows = figure?.source?.rows;
    const column = figure?.source?.column;
    if (!Array.isArray(rows) || !column) {
      mismatches.push({
        id: figure?.id ?? null,
        expected: figure?.cents ?? null,
        actual: null,
        why: 'the figure names no source, so it cannot be checked'
      });
      continue;
    }
    let actual = 0;
    let why = null;
    for (const line of rows) {
      const row = byLine.get(line);
      if (!row) {
        why = `source row ${line} is not in the table`;
        break;
      }
      const cents = parseMoney(row[column]);
      if (cents === null) {
        why = `source row ${line} holds no money in ${column}`;
        break;
      }
      actual += cents;
    }
    if (why || actual !== figure.cents) {
      mismatches.push({
        id: figure.id,
        expected: figure.cents,
        actual: why ? null : actual,
        why: why ?? 'the figure and its source disagree'
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    checked: report.figures.length,
    mismatches
  };
}

// WHY THE JOB READS THE FILE ITSELF.
// The table is the argument, so a caller that passes a path cannot also pass a different table behind it.
// Reading, building and rechecking in one place is what makes the written artifact trustworthy: it was verified before it existed as a file.

export function reportFromFile({
  source,
  client,
  title,
  period,
  periodColumn = null,
  groupBy,
  valueColumn,
  out = null
} = {}) {
  if (source === null || source === undefined || String(source).trim() === '') {
    throw new Error('report_build needs source: the CSV exported from the workbook.');
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
  const report = buildReport({
    table,
    spec: {
      client,
      title,
      period,
      periodColumn,
      groupBy,
      valueColumn
    }
  });
  const verified = verifyReport({
    report,
    table
  });
  if (!verified.ok) {
    throw new Error(`the report failed its own recheck: ${verified.mismatches.map((miss) => miss.why ?? miss.id).join('; ')}`);
  }

  const outPath = out === null || out === undefined || String(out).trim() === ''
    ? path.join(path.dirname(from), `${path.basename(from, path.extname(from))}.report.json`)
    : path.resolve(String(out));
  const artifact = {
    source: from,
    generatedAt: new Date().toISOString(),
    verified,
    report
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.writing`;
  fs.writeFileSync(tmp, `${JSON.stringify(artifact, null, 1)}\n`);
  fs.rmSync(outPath, { force: true });
  fs.renameSync(tmp, outPath);

  return {
    source: from,
    out: outPath,
    verified,
    report
  };
}
