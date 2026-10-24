# Opera Agent Commit Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `document_build` verify every graph against an explicit table source, sync the local surface docs, keep one final Docs migration, remove scratch noise, and leave the branch commit-ready without pushing.

**Architecture:** Keep `local/documents.js` as the single document planner. Add an explicit graph source contract, recompute graph data from the named table rows during build and verify, and keep the artifact as a JSON plan. Add the missing MCP-level and focus-window regression tests, then update docs and clean the working tree.

**Tech Stack:** Node.js >= 22, existing local MCP server, existing document/report modules, Git, gitleaks, Python browser gate.

**Spec:** [`../specs/2026-10-24-opera-agent-commit-readiness-design.md`](../specs/2026-10-24-opera-agent-commit-readiness-design.md)

## Global Constraints

- Node.js >= 22; no new dependencies.
- Output artifact stays `.document.json`; no DOCX or PDF generator.
- No Supabase migration apply, no production deploy, no branch push, no PR creation.
- No `git add .`; every commit adds only the exact paths named in its task.
- Every bug fix starts with a failing test before implementation.
- Every graph must name an explicit source; no inference from tables.
- No `eval`, no site-specific browser code, no secrets in the tree.
- Use `py`, not `python`, for the Python browser gate.
- Comment formatter rule is canonical: run `node scripts/format-comments.mjs --write` only after scratch cleanup in Task 6.

## Review Focus

- Graph without `source`: must be refused before any artifact is written.
- Graph `sum` value disagrees with its named table rows: must be refused before any artifact is written.
- Graph source names a missing table or column: error must name the missing table or column.
- `sum` column contains a non-numeric cell: must be refused, never coerced to zero.
- MCP `document_build` with an invalid paper: must return a JSON-RPC error and write no `.document.json`.

---

### Task 1: Lock document graph verification with tests, then fix `documents.js`

**Files:**
- Modify: `tests/document-job.test.mjs`
- Modify: `local/documents.js`
- Modify: `docs/paper-all-menus.json`
- Test: `tests/document-job.test.mjs`

**Interfaces:**
- Consumes: existing `parseDocument`, `buildDocument`, `verifyDocument`, `documentFromFile`.
- Produces: `buildDocument({ doc })` returns figures with `source.rows` as an array of row indices, `aggregate`, `labelColumn`, `valueColumn`, and `data` recomputed from the table. `verifyDocument({ document, doc })` recomputes every figure from `doc`, not from the built artifact.

- [ ] **Step 1: Update the shared fixture to use an explicit graph source**

In `tests/document-job.test.mjs`, replace the graph inside `DOC`:

```js
      graphs: [{ kind: 'count', title: 'Items', source: { table: 0, labelColumn: 'Item', aggregate: 'count' }, data: [{ label: 'Image', value: 1 }, { label: 'Table', value: 1 }] }]
```

- [ ] **Step 2: Update the two existing graph tests**

Replace `every graph carries the section and rows that produced it`:

```js
test('every graph carries the section and rows that produced it', () => {
  const built = buildDocument({ doc: DOC });
  const figure = built.figures[0];
  assert.equal(figure.id, 'graph:0:0');
  assert.equal(figure.section, 0);
  assert.equal(figure.source.table, 0);
  assert.equal(figure.aggregate, 'count');
  assert.deepEqual(figure.source.rows, [0, 1]);
  assert.deepEqual(figure.data, [{ label: 'Image', value: 1 }, { label: 'Table', value: 1 }]);
});
```

Replace `the recheck catches a graph that was edited after it was computed`:

```js
test('the recheck catches a graph that was edited after it was computed', () => {
  const built = buildDocument({ doc: DOC });
  const forged = structuredClone(built);
  forged.figures[0].data[0].value += 1;
  const out = verifyDocument({ document: forged, doc: DOC });
  assert.equal(out.ok, false);
  assert.equal(out.mismatches.length, 1);
});
```

- [ ] **Step 3: Add the failing graph-contract tests**

Add these tests after `a table with the wrong number of cells is refused`:

```js
const SUM_DOC = {
  title: 'Revenue',
  sections: [{
    heading: 'Revenue',
    tables: [{ headers: ['Item', 'Amount'], rows: [['A', '10'], ['B', '20']] }],
    graphs: [{
      kind: 'bar',
      title: 'Revenue',
      source: { table: 0, labelColumn: 'Item', valueColumn: 'Amount', aggregate: 'sum' },
      data: [{ label: 'A', value: 10 }, { label: 'B', value: 20 }]
    }]
  }]
};

test('a graph without a source is refused', () => {
  const bad = structuredClone(SUM_DOC);
  delete bad.sections[0].graphs[0].source;
  assert.throws(() => buildDocument({ doc: bad }), /source/);
});

test('a count graph without a table is refused', () => {
  const bad = structuredClone(DOC);
  bad.sections[0].tables = [];
  assert.throws(() => buildDocument({ doc: bad }), /table/);
});

test('a sum graph is computed from the rows it names', () => {
  const built = buildDocument({ doc: SUM_DOC });
  const figure = built.figures[0];
  assert.equal(figure.aggregate, 'sum');
  assert.deepEqual(figure.data, [{ label: 'A', value: 10 }, { label: 'B', value: 20 }]);
  assert.deepEqual(figure.source.rows, [0, 1]);
  assert.equal(verifyDocument({ document: built, doc: SUM_DOC }).ok, true);
});

test('a sum graph with a wrong value is refused', () => {
  const bad = structuredClone(SUM_DOC);
  bad.sections[0].graphs[0].data[0].value = 999;
  assert.throws(() => buildDocument({ doc: bad }), /does not match its table source/);
});

test('a graph naming a missing column is refused', () => {
  const bad = structuredClone(SUM_DOC);
  bad.sections[0].graphs[0].source.labelColumn = 'Missing';
  assert.throws(() => buildDocument({ doc: bad }), /Missing/);
});

test('a graph with a non-numeric value is refused', () => {
  const bad = structuredClone(SUM_DOC);
  bad.sections[0].tables[0].rows[0][1] = 'ten';
  assert.throws(() => buildDocument({ doc: bad }), /non-numeric/);
});

test('verify catches a graph that lost a source row', () => {
  const built = buildDocument({ doc: SUM_DOC });
  const forged = structuredClone(built);
  forged.figures[0].source.rows = [0];
  const out = verifyDocument({ document: forged, doc: SUM_DOC });
  assert.equal(out.ok, false);
  assert.equal(out.mismatches.length, 1);
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test tests/document-job.test.mjs`
Expected: FAIL on the new graph-contract tests because `documents.js` still accepts graphs without a source and only checks `kind: "count"`.

- [ ] **Step 5: Add numeric and graph-comparison helpers to `local/documents.js`**

Add after `nonEmptyString`:

```js
function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
```

Add after `asArray`:

```js
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
```

- [ ] **Step 6: Replace `validateGraph` with source-aware graph validation**

Replace the existing `validateGraph` function in `local/documents.js` with:

```js
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
```

- [ ] **Step 7: Update `buildDocument` to validate tables before graphs**

In `buildDocument`, replace:

```js
    const tables = asArray(section.tables);
    tables.forEach((table, tableIndex) => {
      const normalized = validateTable(table, sectionIndex, tableIndex);
      blocks.push({ kind: 'table', headers: normalized.headers, rows: normalized.rows, section: sectionIndex, table: tableIndex });
      totalItems += normalized.rows.length;
    });
```

with:

```js
    const normalizedTables = asArray(section.tables).map((table, tableIndex) => validateTable(table, sectionIndex, tableIndex));
    normalizedTables.forEach((normalized, tableIndex) => {
      blocks.push({ kind: 'table', headers: normalized.headers, rows: normalized.rows, section: sectionIndex, table: tableIndex });
      totalItems += normalized.rows.length;
    });
```

- [ ] **Step 8: Replace the graph block in `buildDocument`**

Replace the existing `const graphs = ...` block and the later `for (const figure of figures)` recheck loop with:

```js
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
```

Remove this old loop entirely:

```js
  for (const figure of figures) {
    const sectionItems = asArray(sections[figure.section].tables).reduce(
      (count, table) => count + asArray(table.rows).length,
      0
    );
    if (sectionItems > 0 && figure.kind === 'count' && figure.sum !== sectionItems) {
      throw new Error(`section ${figure.section + 1} graph ${figure.id} counts ${figure.sum} but its tables hold ${sectionItems}.`);
    }
  }
```

- [ ] **Step 9: Replace `verifyDocument` with a table-source recheck**

Replace the existing `verifyDocument` function with:

```js
export function verifyDocument({ document, doc } = {}) {
  if (!document || !Array.isArray(document.figures)) {
    throw new Error('verifyDocument needs a document with figures.');
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error('verifyDocument needs the source document.');
  }
  const mismatches = [];
  const sections = Array.isArray(doc.sections) ? doc.sections : [];

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
  }

  return { ok: mismatches.length === 0, checked: document.figures.length, mismatches };
}
```

- [ ] **Step 10: Run the document tests to verify they pass**

Run: `node --test tests/document-job.test.mjs`
Expected: PASS, 19/19 tests.

- [ ] **Step 11: Migrate the paper fixture to explicit graph sources**

In `docs/paper-all-menus.json`, replace every graph opening. Use this exact replacement with `replaceAll: true`:

```text
oldString: { "kind": "count", "title":
newString: { "kind": "count", "source": { "table": 0, "labelColumn": "Primitive", "aggregate": "count" }, "title":
```

- [ ] **Step 12: Verify the migrated fixture builds**

Run:

```bash
node --input-type=module -e "import { documentFromFile } from './local/documents.js'; const out = documentFromFile({ source: 'docs/paper-all-menus.json' }); if (!out.verified.ok) throw new Error('fixture failed its recheck'); console.log('fixture verified:', out.document.figures.length, 'graphs');"
```

Expected: `fixture verified: 5 graphs`

- [ ] **Step 13: Commit the graph fix and fixture**

```bash
git add tests/document-job.test.mjs local/documents.js docs/paper-all-menus.json
git commit -m "Fix document_build graph verification against named tables"
```

---

### Task 2: Add the MCP-level `document_build` test

**Files:**
- Modify: `tests/local-mcp-server.test.mjs`
- Test: `tests/local-mcp-server.test.mjs`

**Interfaces:**
- Consumes: `createMcpServer` and `ctx()` from `tests/local-mcp-server.test.mjs`; `documentFromFile` from `local/documents.js`.
- Produces: MCP integration coverage for valid and invalid `document_build` calls without a browser.

- [ ] **Step 1: Add the valid MCP test**

Add after the `report_build turns an exported sheet into a checked report without a browser` test:

```js
test('document_build turns a JSON paper into a checked document without a browser', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-document-tool-'));
  const source = path.join(dir, 'paper.json');
  fs.writeFileSync(source, JSON.stringify({
    title: 'Menu inventory',
    sections: [{
      heading: 'Insert menu',
      tables: [{ headers: ['Item', 'Shortcut'], rows: [['Image', 'Ctrl+Alt+I'], ['Table', '']] }],
      graphs: [{
        kind: 'count',
        title: 'Items',
        source: { table: 0, labelColumn: 'Item', aggregate: 'count' },
        data: [{ label: 'Image', value: 1 }, { label: 'Table', value: 1 }]
      }]
    }]
  }));
  try {
    const server = createMcpServer(ctx());
    const res = await server.handle({
      jsonrpc: '2.0', id: 71, method: 'tools/call',
      params: {
        name: 'document_build',
        arguments: { source }
      }
    });
    assert.equal(res.result.isError, undefined);
    const payload = JSON.parse(res.result.content[0].text);
    assert.equal(payload.verified.ok, true);
    assert.deepEqual(payload.document.figures[0].source.rows, [0, 1]);
    assert.ok(fs.existsSync(payload.out), 'the document file is written beside the source');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add the invalid MCP test**

Add immediately after the valid test:

```js
test('document_build refuses a graph with no source and writes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-document-invalid-'));
  const source = path.join(dir, 'bad.json');
  fs.writeFileSync(source, JSON.stringify({
    title: 'Menu inventory',
    sections: [{
      heading: 'Insert menu',
      tables: [{ headers: ['Item', 'Shortcut'], rows: [['Image', 'Ctrl+Alt+I'], ['Table', '']] }],
      graphs: [{
        kind: 'count',
        title: 'Items',
        data: [{ label: 'Image', value: 1 }, { label: 'Table', value: 1 }]
      }]
    }]
  }));
  try {
    const server = createMcpServer(ctx());
    const res = await server.handle({
      jsonrpc: '2.0', id: 72, method: 'tools/call',
      params: {
        name: 'document_build',
        arguments: { source }
      }
    });
    assert.ok(res.error, 'an invalid paper is a JSON-RPC error, not a result');
    assert.match(res.error.message, /source/);
    assert.ok(!fs.existsSync(path.join(dir, 'bad.document.json')), 'no artifact is written for an invalid paper');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the MCP tests**

Run: `node --test tests/local-mcp-server.test.mjs`
Expected: PASS, including the two new `document_build` tests.

- [ ] **Step 4: Commit the MCP test**

```bash
git add tests/local-mcp-server.test.mjs
git commit -m "Test document_build through the local MCP surface"
```

---

### Task 3: Lock the `focus_window` no-match refusal

**Files:**
- Modify: `tests/window-focus.test.mjs`
- Test: `tests/window-focus.test.mjs`

**Interfaces:**
- Consumes: `focusWindow` from `local/window-focus.js`.
- Produces: regression coverage that an empty match reads window state and never issues a focus command.

- [ ] **Step 1: Add the failing regression test**

Add after `focusing names the window it brought and whether the machine allowed it`:

```js
test('focus_window with no match reads the machine and moves nothing', async () => {
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, args[args.length - 1]]);
    return { stdout: 'FOREGROUND OpenCode\nPaper - Google Chrome\n' };
  };

  const out = await focusWindow('', { platform: 'win32', exec });

  assert.equal(calls.length, 1, 'the machine is read once');
  assert.match(calls[0][1], /Read\(\)/, 'and only the read path runs');
  assert.doesNotMatch(calls[0][1], /Focus\(/, 'no window is brought forward');
  assert.equal(out.match, '');
  assert.equal(out.focused, false);
  assert.equal(out.title, '');
  assert.equal(out.foreground, 'OpenCode');
  assert.deepEqual(out.windows, ['Paper - Google Chrome']);
  assert.match(out.why, /no match given/);
});
```

- [ ] **Step 2: Run the test to verify it passes with the existing fix**

Run: `node --test tests/window-focus.test.mjs`
Expected: PASS. The empty-match behavior is already implemented in `local/window-focus.js`; this task only locks it.

- [ ] **Step 3: Commit the regression test**

```bash
git add tests/window-focus.test.mjs
git commit -m "Lock focus_window no-match refusal"
```

---

### Task 4: Sync local surface documentation

**Files:**
- Modify: `local/README.md`
- Modify: `local/agent-guide.js`
- Test: `tests/agent-guide.test.mjs`

**Interfaces:**
- Consumes: existing `RECIPES`, `SIDE_EFFECTS`, and `guide()` in `local/agent-guide.js`.
- Produces: a `document_build` recipe and an accurate 39-tool local surface count.

- [ ] **Step 1: Add the `document_build` recipe**

In `local/agent-guide.js`, insert after the `Build a report from an exported sheet` recipe:

```js
  {
    task: 'Build a paper from JSON tables, images, and graphs',
    do: ['document_build'],
    note: 'JSON in, a checked document plan out, written beside the source. No browser is touched. Every graph names its table and columns, and the graph is recomputed from those rows before the file exists — a graph without a source, or one whose number disagrees with the table, stops the paper instead of reaching a reader.'
  },
```

- [ ] **Step 2: Name `document_build` in the on-disk plan refusal**

Replace:

```js
      'A complex document or report is built as a plan on disk (report_build) before it reaches a page, not by driving cells one by one.'
```

with:

```js
      'A complex document or report is built as a plan on disk (report_build, document_build) before it reaches a page, not by driving cells one by one.'
```

- [ ] **Step 3: Correct the local tool count**

In `local/README.md`, replace:

```text
The server advertises 38 tools; `guide()` returns them as tasks rather than a list.
```

with:

```text
The server advertises 39 tools; `guide()` returns them as tasks rather than a list.
```

- [ ] **Step 4: Run the guide and readme tests**

Run: `node --test tests/agent-guide.test.mjs tests/readme.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit the documentation sync**

```bash
git add local/README.md local/agent-guide.js
git commit -m "Sync local guide and README with document_build"
```

---

### Task 5: Keep one final Docs migration

**Files:**
- Delete: `supabase/migrations/20261023000000_docs_insert_table_v2.sql`
- Rename: `supabase/migrations/20261023000001_docs_insert_table_v3.sql` to `supabase/migrations/20261023000000_docs_insert_table_v3.sql`
- Test: `npm test` after scratch cleanup in Task 6

**Interfaces:**
- Consumes: the existing `docs.insert_table` workflow v1 migration already in the tree.
- Produces: one final untracked migration file for `docs.insert_table`, ready to commit but not applied.

- [ ] **Step 1: Read both migration files before changing them**

Run:

```bash
Get-Content -LiteralPath supabase/migrations/20261023000000_docs_insert_table_v2.sql -Raw
Get-Content -LiteralPath supabase/migrations/20261023000001_docs_insert_table_v3.sql -Raw
```

Expected: confirm v2 is the superseded single-burst version and v3 is the final two-burst version.

- [ ] **Step 2: Remove the superseded v2 migration**

Run:

```bash
Remove-Item -LiteralPath supabase/migrations/20261023000000_docs_insert_table_v2.sql
```

- [ ] **Step 3: Rename v3 to the single final migration path**

Run:

```bash
Move-Item -LiteralPath supabase/migrations/20261023000001_docs_insert_table_v3.sql -Destination supabase/migrations/20261023000000_docs_insert_table_v3.sql
```

- [ ] **Step 4: Commit the final migration**

```bash
git add supabase/migrations/20261023000000_docs_insert_table_v3.sql
git commit -m "Keep final docs.insert_table migration"
```

---

### Task 6: Clean scratch, format comments, and run full gates

**Files:**
- Delete after review: `tmp_body.mjs`, `tmp_burst.mjs`, `tmp_client.mjs`, `tmp_dbg.mjs`, `tmp_open.mjs`, `tmp_open2.mjs`, `tmp_paper.mjs`, `tmp_table.mjs`, `tmp_table2.mjs`, `tmp_table3.mjs`, `tmp_tableburst.mjs`, `tmp_tabs.mjs`, `tmp_testout.txt`, `tmp_tools.mjs`, `tmp_wf.mjs`
- Modify: any file rewritten by `node scripts/format-comments.mjs --write`
- Test: full repository gates

**Interfaces:**
- Consumes: all commits from Tasks 1-5.
- Produces: a working tree with no scratch noise, canonical comments, and green full gates.

- [ ] **Step 1: Read every scratch file before deleting it**

Run:

```bash
Get-ChildItem -LiteralPath . -File | Where-Object { $_.Name -like 'tmp_*' } | Sort-Object Name | ForEach-Object { Write-Output "--- $($_.Name) ---"; Get-Content -LiteralPath $_.FullName -Raw }
```

Expected: each file is a one-off MCP/probe script or captured output. Do not delete any file that contains work not represented by the committed tests.

- [ ] **Step 2: Delete the reviewed scratch files**

Run:

```bash
Remove-Item -LiteralPath tmp_body.mjs,tmp_burst.mjs,tmp_client.mjs,tmp_dbg.mjs,tmp_open.mjs,tmp_open2.mjs,tmp_paper.mjs,tmp_table.mjs,tmp_table2.mjs,tmp_table3.mjs,tmp_tableburst.mjs,tmp_tabs.mjs,tmp_testout.txt,tmp_tools.mjs,tmp_wf.mjs
```

- [ ] **Step 3: Format comments to canonical form**

Run: `node scripts/format-comments.mjs --write`
Expected: the command prints how many files were rewritten and exits 0.

- [ ] **Step 4: Run the full unit gate**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 5: Run the repo check gate**

Run: `npm run check`
Expected: `check ok`, exit 0.

- [ ] **Step 6: Run the working-tree secret scan**

Run: `gitleaks detect --no-git --source . --redact`
Expected: no findings, exit 0.

- [ ] **Step 7: Run the browser extension gate**

Run: `py tests/browser_extension_test.py`
Expected: the script completes without an exit error.

- [ ] **Step 8: Check the final diff hygiene**

Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 9: Review the final status**

Run: `git status --short`
Expected: no `tmp_*` files remain; only intended changes or clean tracked modifications remain.

- [ ] **Step 10: Commit the cleanup and formatter changes**

```bash
git add -A
git commit -m "Clean scratch files and apply canonical comment form"
```

`git add -A` is allowed only in this final task because scratch deletion and formatter rewrites are the intended whole-tree change.
