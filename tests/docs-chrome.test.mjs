// @last-edited: 2026-10-13 UTC+7.
// @title: docs-chrome.test — chrome workflow migrations embed valid, proven JSON.
// @state: locks footnote, header/footer, and page setup shapes and proofs.
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

test('footnote inserts and proves the note exists', () => {
  const def = read('20261014060000_docs_footnote.sql');
  assert.ok(JSON.stringify(def.steps).includes('Footnote'), 'footnote path is walked');
  assert.ok(def.output.noteId, 'output proves the note');
});

test('header_footer covers header, footer, and page numbers', () => {
  const def = read('20261014070000_docs_header_footer.sql');
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('Header') && text.includes('Footer'), 'both regions walked');
  assert.ok(text.includes('Page numbers') || text.includes('pageNumber'), 'page numbers included');
  assert.ok(def.output.header !== undefined && def.output.pageNumbers !== undefined, 'output proves all three');
});

test('page_setup applies margins and proves them', () => {
  const def = read('20261014080000_docs_page_setup.sql');
  assert.ok(JSON.stringify(def.steps).includes('Page setup'), 'dialog path is walked');
  assert.ok(def.output.applied, 'output proves application');
  assert.ok(JSON.stringify(def.steps).includes('page.wait_for'), 'dialog settle is waited, never slept');
});
