// @last-edited: 2026-10-14 UTC+7.
// @title: docs-structure-v3.test — one burst per walk, one wait for proof, no polling.
// @state: locks the v3 shapes for heading, list, table, image, footnote, page setup, TOC, export.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => {
  const migration = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, `${name} must embed the workflow JSON`);
  return JSON.parse(match[1]);
};

// A count walk is N arrow steps, so the test counts them instead of reading a
// number: a number in the JSON would be arithmetic the runner cannot do, while
// N steps it executes one command.

function walkSteps(def, id) {
  const found = [];
  const scan = (nodes) => {
    for (const node of nodes || []) {
      if (node?.params?.steps?.length) found.push(node);
      for (const branch of [node?.then, node?.else, node?.steps]) if (Array.isArray(branch)) scan(branch);
    }
  };
  scan(def.steps);
  return found.find((node) => node.id === id)?.params.steps ?? null;
}

function arrowCount(def, id, key = 'ArrowDown') {
  const steps = walkSteps(def, id);
  assert.ok(steps, `burst ${id} must exist`);
  return steps.filter((step) => step.key === key).length;
}

// WHY the shape is a count walk in one burst. A menubar opens on click, a row
// owns its submenu on hover, and every count was measured live: click level
// one, Down to the row, Right into its submenu. Each level is proven inside the
// same burst by finding what the level must have revealed, so a wrong count
// fails at the burst instead of painting a wrong menu. Proving by a find costs
// one command; polling page.read twelve times cost about seven seconds.

test('apply_heading v3 types through the key road and proves the outline in one wait', () => {
  const text = JSON.stringify(read('20261014120000_docs_apply_heading_v3.sql').steps);
  assert.ok(text.includes('"keyEvents":true'), 'text travels as key events');
  assert.ok(text.includes('page.wait_for'), 'proof is one wait, not a poll loop');
  assert.ok(!text.includes('"type":"repeat"'), 'no polling loop in the road');

  const def = read('20261014120000_docs_apply_heading_v3.sql');
  assert.ok(def.output.applied && def.output.style, 'output proves the applied style');
  assert.ok(read('20261014120000_docs_apply_heading_v2.sql').output.applied,
    'v2 stays in the tree as the rollback target');
});

test('make_list v3 proves the caller-computed count in one wait', () => {
  const def = read('20261014130000_docs_make_list_v3.sql');
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('expectedWords'), 'the count dialog is read against caller words');
  assert.ok(text.includes('page.wait_for'), 'the dialog read is one wait');
  assert.ok(!text.includes('"type":"repeat"'), 'no polling loop');
  assert.ok(text.includes('"keyEvents":true'), 'items travel as key events');
  assert.ok(def.output.verified, 'output proves the count');
});

test('insert_table v3 walks Insert and Table by count and picks the grid by count', () => {
  const def = read('20261014140000_docs_insert_table_v3.sql');
  assert.equal(arrowCount(def, 'openInsert'), 1, 'Table is the second Insert row, measured');
  assert.ok(walkSteps(def, 'openGrid').some((s) => s.key === 'ArrowRight'), 'a row with a submenu opens on Right');
  assert.ok(walkSteps(def, 'gridSize').some((s) => s.action === 'find'), 'the grid label is proven by a find, never by text');
  assert.ok(def.output.rows && def.output.cols && def.output.verified, 'output proves dimensions');
});

test('insert_image v3 walks Insert and Image by count and proves placement', () => {
  const def = read('20261014150000_docs_insert_image_v3.sql');
  assert.equal(arrowCount(def, 'openInsert'), 0, 'Image is the first Insert row, measured');
  assert.ok(walkSteps(def, 'openImageMenu').some((s) => s.key === 'ArrowRight'), 'Image owns a submenu on Right');
  assert.ok(def.output.placed, 'output proves placement');
});

test('footnote v3 uses the measured shortcut and proves the note text', () => {
  const def = read('20261014160000_docs_footnote_v3.sql');
  const steps = walkSteps(def, 'insertNote');
  assert.deepEqual(steps.map((s) => `${s.key}+${(s.modifiers || []).join('-')}`), ['f+control-alt'],
    'Ctrl+Alt+f is the footnote shortcut, measured; uppercase would add shift and miss');
  assert.ok(walkSteps(def, 'typeNote').some((s) => s.keyEvents === true), 'the note text travels as key events');
  assert.ok(def.output.noteId, 'output proves the note');
});

test('page_setup v3 walks File to Page setup by count and proves the dialog re-read', () => {
  const def = read('20261014180000_docs_page_setup_v3.sql');
  assert.equal(arrowCount(def, 'openFile'), 17, 'Page setup is row eighteen of File, measured');
  assert.ok(walkSteps(def, 'openDialog').some((s) => s.key === 'ArrowRight'), 'Page setup opens its dialog on Right');
  assert.ok(JSON.stringify(def.steps).includes('page.wait_for'), 'the dialog settles on a wait, never a sleep');
  assert.ok(def.output.applied, 'output proves application');
});

test('toc_insert v3 walks Insert by count and proves the outline grew', () => {
  const def = read('20261014190000_docs_toc_insert_v3.sql');
  assert.equal(arrowCount(def, 'openInsert'), 0, 'Table of contents is the first Insert row, measured');
  assert.ok(JSON.stringify(def.steps).includes('page.wait_for'), 'the outline wait is a wait, never a sleep');
  assert.ok(def.output.entries, 'output proves the entry count');
});

test('export_pdf v3 walks File to Download to PDF by count and waits for the toast', () => {
  const def = read('20261014200000_docs_export_pdf_v3.sql');
  assert.equal(arrowCount(def, 'openFile'), 5, 'Download is row six of File, measured');
  assert.equal(arrowCount(def, 'pickPdf'), 1, 'PDF Document is the second row of Download, measured');
  assert.ok(JSON.stringify(def.steps).includes('page.wait_for'), 'the download feedback is waited, never slept');
  assert.ok(def.output.downloaded, 'output proves the feedback');
});
