// @last-edited: 2026-10-25 UTC+7.
// @title: documents — a paper is planned on disk with tables, images and graphs, and a plan that cannot be checked is refused.
// @state: JSON in, a docplan with blocks and a figure ledger out, plus the recheck that catches an edited number.
// @dependencies: node:fs, node:path.

import fs from 'node:fs';
import path from 'node:path';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDocument(text) {
  let doc;
  try {
    doc = JSON.parse(String(text ?? ''));
  } catch (error) {
    throw new Error(`document_build needs JSON source: ${error.message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('document_build needs a JSON object with a title and sections.');
  }
  return doc;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sameGraphData(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const left = new Map();
  for (const point of actual) {
    const label = nonEmptyString(point?.label) ? point.label.trim() : '';
    const value = parseNumber(point?.value);
    if (label === '' || value === null) return false;
    if (left.has(label)) return false;
    left.set(label, value);
  }
  const right = new Map(expected.map((point) => [point.label, point.value]));
  if (left.size !== right.size) return false;
  for (const [label, value] of left) {
    if (!right.has(label) || right.get(label) !== value) return false;
  }
  return true;
}

function validateImage(image, sectionIndex, imageIndex) {
  if (!image || typeof image !== 'object' || Array.isArray(image)) {
    throw new Error(`section ${sectionIndex + 1} image ${imageIndex + 1} is not an object.`);
  }
  if (!nonEmptyString(image.alt)) {
    throw new Error(`section ${sectionIndex + 1} image ${imageIndex + 1} has no alt text; an image without alt cannot be placed.`);
  }
  return {
    alt: image.alt.trim(),
    caption: nonEmptyString(image.caption) ? image.caption.trim() : '',
    src: nonEmptyString(image.src) ? image.src.trim() : null
  };
}

function validateTable(table, sectionIndex, tableIndex) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    throw new Error(`section ${sectionIndex + 1} table ${tableIndex + 1} is not an object.`);
  }
  const headers = asArray(table.headers).map((header) => String(header ?? '').trim());
  if (headers.length === 0 || headers.some((header) => header === '')) {
    throw new Error(`section ${sectionIndex + 1} table ${tableIndex + 1} has no headers.`);
  }
  const rows = asArray(table.rows);
  const normalized = rows.map((row, rowIndex) => {
    const cells = asArray(row).map((cell) => String(cell ?? ''));
    if (cells.length !== headers.length) {
      throw new Error(`section ${sectionIndex + 1} table ${tableIndex + 1} row ${rowIndex + 1} has ${cells.length} cells, expected ${headers.length}.`);
    }
    return cells;
  });
  return { headers, rows: normalized };
}

function computeGraph(table, source) {
  if (source.aggregate !== 'count' && source.aggregate !== 'sum') {
    throw new Error('the graph source needs aggregate "count" or "sum".');
  }
  const labelIndex = table.headers.indexOf(source.labelColumn);
  if (labelIndex < 0) {
    throw new Error(`the graph source has no label column "${source.labelColumn}".`);
  }
  const valueIndex = source.aggregate === 'sum' ? table.headers.indexOf(source.valueColumn) : -1;
  if (source.aggregate === 'sum' && valueIndex < 0) {
    throw new Error(`the graph source has no value column "${source.valueColumn}".`);
  }

  const groups = new Map();
  table.rows.forEach((row, rowIndex) => {
    const label = String(row[labelIndex] ?? '').trim();
    if (label === '') {
      throw new Error(`row ${rowIndex + 1} has no label in "${source.labelColumn}".`);
    }
    let value = 1;
    if (source.aggregate === 'sum') {
      const parsed = parseNumber(row[valueIndex]);
      if (parsed === null) {
        throw new Error(`row ${rowIndex + 1} has a non-numeric value in "${source.valueColumn}".`);
      }
      value = parsed;
    }
    const bucket = groups.get(label) ?? { value: 0, rows: [] };
    bucket.value = source.aggregate === 'sum' ? bucket.value + value : bucket.value + 1;
    bucket.rows.push(rowIndex);
    groups.set(label, bucket);
  });

  return {
    data: [...groups.entries()].map(([label, bucket]) => ({ label, value: bucket.value })),
    rows: [...groups.values()].flatMap((bucket) => bucket.rows)
  };
}

function validateGraph(graph, sectionIndex, graphIndex, tables) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} is not an object.`);
  }
  const kind = nonEmptyString(graph.kind) ? graph.kind.trim() : '';
  if (kind === '') {
    throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} has no kind.`);
  }

  const source = graph.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} has no source; name the table, labelColumn, and aggregate it came from.`);
  }

  const tableIndex = source.table;
  if (!Number.isInteger(tableIndex) || tableIndex < 0 || tableIndex >= tables.length) {
    throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} names table ${String(source.table)}, but the section has ${tables.length} tables.`);
  }

  const labelColumn = nonEmptyString(source.labelColumn) ? source.labelColumn.trim() : '';
  if (labelColumn === '') {
    throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} has no source.labelColumn.`);
  }

  const aggregate = nonEmptyString(source.aggregate) ? source.aggregate.trim() : '';
  if (aggregate !== 'count' && aggregate !== 'sum') {
    throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} needs source.aggregate "count" or "sum".`);
  }

  let valueColumn = null;
  if (aggregate === 'sum') {
    valueColumn = nonEmptyString(source.valueColumn) ? source.valueColumn.trim() : '';
    if (valueColumn === '') {
      throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} needs source.valueColumn for a sum graph.`);
    }
  } else if (source.valueColumn !== undefined && source.valueColumn !== null) {
    valueColumn = nonEmptyString(source.valueColumn) ? source.valueColumn.trim() : '';
    if (valueColumn === '') {
      throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} has an empty source.valueColumn.`);
    }
  }

  const computed = computeGraph(tables[tableIndex], { labelColumn, valueColumn, aggregate });
  const provided = asArray(graph.data);
  if (provided.length === 0) {
    throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} has no data.`);
  }
  if (!sameGraphData(provided, computed.data)) {
    throw new Error(`section ${sectionIndex + 1} graph ${graphIndex + 1} does not match its table source.`);
  }

  return {
    kind,
    title: nonEmptyString(graph.title) ? graph.title.trim() : '',
    caption: nonEmptyString(graph.caption) ? graph.caption.trim() : '',
    source: {
      section: sectionIndex,
      table: tableIndex,
      labelColumn,
      valueColumn,
      aggregate,
      rows: computed.rows
    },
    data: computed.data
  };
}
export function buildDocument({ doc } = {}) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('document_build needs a document object.');
  }
  if (!nonEmptyString(doc.title)) {
    throw new Error('document_build needs a title.');
  }

  const sections = asArray(doc.sections);
  if (sections.length === 0) {
    throw new Error('document_build needs at least one section.');
  }

  const figures = [];
  const blocks = [];
  let totalItems = 0;

  sections.forEach((section, sectionIndex) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      throw new Error(`section ${sectionIndex + 1} is not an object.`);
    }
    if (!nonEmptyString(section.heading)) {
      throw new Error(`section ${sectionIndex + 1} has no heading.`);
    }

    blocks.push({ kind: 'heading', level: 1, text: section.heading.trim(), section: sectionIndex });

    if (nonEmptyString(section.body)) {
      blocks.push({ kind: 'paragraph', text: section.body.trim(), section: sectionIndex });
    }

    const normalizedTables = asArray(section.tables).map((table, tableIndex) => validateTable(table, sectionIndex, tableIndex));
    normalizedTables.forEach((normalized, tableIndex) => {
      blocks.push({ kind: 'table', headers: normalized.headers, rows: normalized.rows, section: sectionIndex, table: tableIndex });
      totalItems += normalized.rows.length;
    });

    const images = asArray(section.images);
    images.forEach((image, imageIndex) => {
      const normalized = validateImage(image, sectionIndex, imageIndex);
      blocks.push({ kind: 'image', ...normalized, section: sectionIndex });
    });

    const graphs = asArray(section.graphs);
    graphs.forEach((graph, graphIndex) => {
      const normalized = validateGraph(graph, sectionIndex, graphIndex, normalizedTables);
      figures.push({
        id: `graph:${sectionIndex}:${graphIndex}`,
        section: sectionIndex,
        table: normalized.source.table,
        labelColumn: normalized.source.labelColumn,
        valueColumn: normalized.source.valueColumn,
        aggregate: normalized.source.aggregate,
        data: normalized.data,
        source: {
          section: sectionIndex,
          table: normalized.source.table,
          rows: normalized.source.rows
        }
      });
      blocks.push({ ...normalized, kind: 'graph', section: sectionIndex });
    });
  });

  const docplan = {
    title: doc.title.trim(),
    author: nonEmptyString(doc.author) ? doc.author.trim() : null,
    sections: sections.map((section) => ({
      heading: section.heading.trim(),
      items: asArray(section.tables).reduce((count, table) => count + asArray(table.rows).length, 0),
      images: asArray(section.images).length,
      graphs: asArray(section.graphs).length
    })),
    blocks,
    totals: { sections: sections.length, items: totalItems, images: blocks.filter((block) => block.kind === 'image').length, graphs: figures.length }
  };

  return { title: docplan.title, docplan, figures };
}
export function verifyDocument({ document, doc } = {}) {
  if (!document || !Array.isArray(document.figures)) {
    throw new Error('verifyDocument needs a document with figures.');
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error('verifyDocument needs the source document.');
  }
  const mismatches = [];
  const sections = Array.isArray(doc.sections) ? doc.sections : [];

  // The count comes from the source, not from the artifact: a plan that dropped a figure cannot hide behind a totals line it also dropped.
  const expectedGraphs = sections.reduce((count, section) => count + (Array.isArray(section.graphs) ? section.graphs.length : 0), 0);
  if (document.figures.length !== expectedGraphs) {
    mismatches.push({ id: null, expected: expectedGraphs, actual: document.figures.length, why: 'the document does not carry every graph its source defines' });
  }

  for (const figure of document.figures) {
    try {
      const source = figure?.source;
      if (!source || !Number.isInteger(source.section) || !Number.isInteger(source.table)) {
        throw new Error('the figure names no table source, so it cannot be checked');
      }
      const section = sections[source.section];
      if (!section) {
        throw new Error(`source section ${source.section} is not in the document`);
      }
      const rawTables = Array.isArray(section.tables) ? section.tables : [];
      const table = validateTable(rawTables[source.table], source.section, source.table);
      const expected = computeGraph(table, {
        labelColumn: figure.labelColumn,
        valueColumn: figure.valueColumn,
        aggregate: figure.aggregate
      });

      if (!sameGraphData(figure.data, expected.data)) {
        mismatches.push({ id: figure.id, expected: expected.data, actual: figure.data ?? null, why: 'the graph and its table source disagree' });
        continue;
      }

      const rows = Array.isArray(source.rows) ? source.rows : [];
      if (rows.length !== expected.rows.length || rows.some((row, index) => row !== expected.rows[index])) {
        mismatches.push({ id: figure.id, expected: expected.rows, actual: rows, why: 'the figure does not name the exact rows that produced it' });
      }
    } catch (error) {
      mismatches.push({ id: figure?.id ?? null, why: error.message });
    }
  }

  if (!nonEmptyString(document?.docplan?.title)) {
    mismatches.push({ id: null, why: 'the document has no title' });
  } else if (document.docplan.title !== String(doc.title ?? '').trim()) {
    mismatches.push({ id: null, why: 'the document title does not match its source' });
  }

  return { ok: mismatches.length === 0, checked: document.figures.length, mismatches };
}

export function documentFromFile({ source, out = null } = {}) {
  if (source === null || source === undefined || String(source).trim() === '') {
    throw new Error('document_build needs source: the JSON describing the paper.');
  }
  const from = path.resolve(String(source));
  let stat;
  try {
    stat = fs.statSync(from);
  } catch (error) {
    throw new Error(`no file at ${from} (${error.code ?? error.message}); write the paper as JSON and pass that path.`);
  }
  if (!stat.isFile()) throw new Error(`${from} is not a file; a folder cannot be a paper source.`);
  if (stat.size === 0) throw new Error(`${from} is zero bytes; an empty file is not a paper.`);

  const doc = parseDocument(fs.readFileSync(from, 'utf8'));
  const built = buildDocument({ doc });
  const verified = verifyDocument({ document: built, doc });
  if (!verified.ok) {
    throw new Error(`the document failed its own recheck: ${verified.mismatches.map((miss) => miss.why ?? miss.id).join('; ')}`);
  }

  const outPath = out === null || out === undefined || String(out).trim() === ''
    ? path.join(path.dirname(from), `${path.basename(from, path.extname(from))}.document.json`)
    : path.resolve(String(out));

  const artifact = {
    source: from,
    generatedAt: new Date().toISOString(),
    verified,
    document: built
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.writing`;
  fs.writeFileSync(tmp, `${JSON.stringify(artifact, null, 1)}\n`);
  fs.rmSync(outPath, { force: true });
  fs.renameSync(tmp, outPath);

  return { source: from, out: outPath, verified, document: built };
}