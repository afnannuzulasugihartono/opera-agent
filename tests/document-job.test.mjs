// @last-edited: 2026-10-25 UTC+7.
// @title: document-job — a paper is planned on disk with tables, images and graphs, and a plan that cannot be checked is refused.
// @state: the parser, the validators, the docplan and the recheck, each pinned by one behaviour.
// @dependencies: node:test, strict, ../local/documents.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseDocument,
  buildDocument,
  verifyDocument,
  documentFromFile
} from '../local/documents.js';

const DOC = {
  title: 'Menu inventory',
  author: 'Opera Agent',
  sections: [
    {
      heading: 'Insert menu',
      body: 'Every item reachable from Insert.',
      tables: [
        {
          headers: [
            'Item',
            'Shortcut'
          ],
          rows: [
            [
              'Image',
              'Ctrl+Alt+I'
            ],
            [
              'Table',
              ''
            ]
          ]
        }
      ],
      images: [{
        alt: 'insert menu screenshot',
        caption: 'Insert menu'
      }],
      graphs: [{
        kind: 'count',
        title: 'Items',
        source: {
          table: 0,
          labelColumn: 'Item',
          aggregate: 'count'
        },
        data: [
          {
            label: 'Image',
            value: 1
          },
          {
            label: 'Table',
            value: 1
          }
        ]
      }]
    }
  ]
};

test('a JSON document parses and keeps its title', () => {
  const doc = parseDocument(JSON.stringify(DOC));
  assert.equal(doc.title, 'Menu inventory');
  assert.equal(doc.sections.length, 1);
});

test('a document without a title is refused', () => {
  assert.throws(() => buildDocument({ doc: { sections: DOC.sections } }), /title/);
});

test('a section without a heading is refused', () => {
  const bad = structuredClone(DOC);
  bad.sections[0].heading = '';
  assert.throws(() => buildDocument({ doc: bad }), /heading/);
});

test('an image without alt text is refused', () => {
  const bad = structuredClone(DOC);
  bad.sections[0].images[0].alt = '';
  assert.throws(() => buildDocument({ doc: bad }), /alt/);
});

test('a graph with no data is refused', () => {
  const bad = structuredClone(DOC);
  bad.sections[0].graphs[0].data = [];
  assert.throws(() => buildDocument({ doc: bad }), /no data/);
});

test('a table with the wrong number of cells is refused', () => {
  const bad = structuredClone(DOC);
  bad.sections[0].tables[0].rows[0] = ['Image'];
  assert.throws(() => buildDocument({ doc: bad }), /cells/);
});

// WHY THE GRAPH DATA HERE IS OUT OF TABLE ORDER.
// The artifact must carry the rows it recomputed, not the caller's array; keeping the fixture reversed makes the difference visible to the test below.

const SUM_DOC = {
  title: 'Revenue',
  sections: [{
    heading: 'Revenue',
    tables: [{
      headers: [
        'Item',
        'Amount'
      ],
      rows: [
        [
          'A',
          '10'
        ],
        [
          'B',
          '20'
        ]
      ]
    }],
    graphs: [{
      kind: 'bar',
      title: 'Revenue',
      source: {
        table: 0,
        labelColumn: 'Item',
        valueColumn: 'Amount',
        aggregate: 'sum'
      },
      data: [
        {
          label: 'B',
          value: 20
        },
        {
          label: 'A',
          value: 10
        }
      ]
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
  assert.deepEqual(figure.data, [
    {
      label: 'A',
      value: 10
    },
    {
      label: 'B',
      value: 20
    }
  ]);
  assert.deepEqual(figure.source.rows, [
    0,
    1
  ]);
  assert.equal(verifyDocument({
    document: built,
    doc: SUM_DOC
  }).ok, true);
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
  const out = verifyDocument({
    document: forged,
    doc: SUM_DOC
  });
  assert.equal(out.ok, false);
  assert.equal(out.mismatches.length, 1);
});

test('verify catches a graph that was deleted from the plan', () => {
  const built = buildDocument({ doc: SUM_DOC });
  const forged = structuredClone(built);
  forged.figures = [];
  forged.docplan.totals.graphs = 0;
  const out = verifyDocument({
    document: forged,
    doc: SUM_DOC
  });
  assert.equal(out.ok, false);
  assert.match(out.mismatches[0].why, /every graph/);
});

test('verify catches a title that was changed after the build', () => {
  const built = buildDocument({ doc: SUM_DOC });
  const forged = structuredClone(built);
  forged.title = 'Other paper';
  forged.docplan.title = 'Other paper';
  const out = verifyDocument({
    document: forged,
    doc: SUM_DOC
  });
  assert.equal(out.ok, false);
  assert.equal(out.mismatches.length, 1);
  assert.match(out.mismatches[0].why, /title/);
});

test('every graph carries the section and rows that produced it', () => {
  const built = buildDocument({ doc: DOC });
  const figure = built.figures[0];
  assert.equal(figure.id, 'graph:0:0');
  assert.equal(figure.section, 0);
  assert.equal(figure.source.table, 0);
  assert.equal(figure.aggregate, 'count');
  assert.deepEqual(figure.source.rows, [
    0,
    1
  ]);
  assert.deepEqual(figure.data, [
    {
      label: 'Image',
      value: 1
    },
    {
      label: 'Table',
      value: 1
    }
  ]);
});

test('the docplan holds the blocks in order', () => {
  const built = buildDocument({ doc: DOC });
  const kinds = built.docplan.blocks.map((block) => block.kind);
  assert.deepEqual(kinds, [
    'heading',
    'paragraph',
    'table',
    'image',
    'graph'
  ]);
  assert.equal(built.docplan.totals.items, 2);
  assert.equal(built.docplan.totals.images, 1);
});

test('the recheck passes when every figure still equals its source', () => {
  const built = buildDocument({ doc: DOC });
  const out = verifyDocument({
    document: built,
    doc: DOC
  });
  assert.equal(out.ok, true);
  assert.equal(out.mismatches.length, 0);
});

test('the recheck catches a graph that was edited after it was computed', () => {
  const built = buildDocument({ doc: DOC });
  const forged = structuredClone(built);
  forged.figures[0].data[0].value += 1;
  const out = verifyDocument({
    document: forged,
    doc: DOC
  });
  assert.equal(out.ok, false);
  assert.equal(out.mismatches.length, 1);
});

test('a JSON file becomes a checked document file beside it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-document-'));
  const source = path.join(dir, 'paper.json');
  fs.writeFileSync(source, JSON.stringify(DOC));
  try {
    const out = documentFromFile({ source });
    assert.equal(out.out, path.join(dir, 'paper.document.json'));
    const artifact = JSON.parse(fs.readFileSync(out.out, 'utf8'));
    assert.equal(artifact.source, source);
    assert.equal(artifact.verified.ok, true);
    assert.equal(artifact.document.docplan.title, 'Menu inventory');
  } finally {
    fs.rmSync(dir, {
      recursive: true,
      force: true
    });
  }
});

test('a missing source file is refused by name, not reported as an empty document', () => {
  assert.throws(
    () => documentFromFile({ source: path.join(os.tmpdir(), 'no-such-document-source.json') }),
    /no file at/
  );
});

test('the shipped paper fixture verifies against its own tables', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../docs/paper-all-menus.json', import.meta.url), 'utf8'));
  const built = buildDocument({ doc: source });
  assert.ok(built.figures.length > 0, 'the fixture still carries graphs');
  assert.equal(verifyDocument({
    document: built,
    doc: source
  }).ok, true);
});
