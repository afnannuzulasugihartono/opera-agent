// @last-edited: 2026-10-12 UTC+7.
// @title: docplan tests — the index arithmetic is the risk, so it is pinned here.
// @dependencies: none.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compileChunk, compilePlan, compileTable, blockLength, NAMED_STYLE } from '../lib/docplan.js';

test('a paragraph occupies its text plus one paragraph mark', () => {
  assert.equal(blockLength({ kind: 'para', text: 'Abstrak' }), 8);
  assert.equal(blockLength({ kind: 'para', text: '' }), 1);
});

test('indices land on the paragraph start of each block', () => {
  const { requests, cursor } = compileChunk([
    { kind: 'body', text: 'Abstrak' },
    { kind: 'body', text: 'Intro' }
  ], { startIndex: 95 });

  const styles = requests.filter((r) => r.updateParagraphStyle).map((r) => r.updateParagraphStyle.range.startIndex);
  assert.deepEqual(styles, [95, 103]);
  assert.equal(cursor, 95 + 7 + 1 + 5);
});

test('a kind that names no style emits text only', () => {
  const { requests } = compileChunk([{ kind: 'para', text: 'x' }], { startIndex: 1 });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].insertText);
});

test('a style range covers the text and its paragraph mark', () => {
  const { requests } = compileChunk([{ kind: 'h1', text: 'Judul' }], { startIndex: 1 });
  const style = requests.find((r) => r.updateParagraphStyle).updateParagraphStyle;
  assert.deepEqual(style.range, { startIndex: 1, endIndex: 7 });
  assert.equal(style.paragraphStyle.namedStyleType, NAMED_STYLE.h1);
});

test('two compiles of one spec are byte-identical', () => {
  const blocks = [
    { kind: 'title', text: 'Judul' },
    { kind: 'body', text: 'Paragraf pertama.' },
    { kind: 'h1', text: '1. Pendahuluan' },
    { kind: 'bullet', text: 'Butir satu' },
    { kind: 'pagebreak' },
    { kind: 'body', text: 'Paragraf kedua.' }
  ];
  const a = JSON.stringify(compileChunk(blocks, { startIndex: 1 }));
  const b = JSON.stringify(compileChunk(blocks, { startIndex: 1 }));
  assert.equal(a, b);
});

test('a bullet gets a paragraph and a list in one block', () => {
  const { requests } = compileChunk([{ kind: 'bullet', text: 'Temuan' }], { startIndex: 1 });
  assert.ok(requests.some((r) => r.createParagraphBullets));
  assert.equal(requests.filter((r) => r.insertText).length, 1);
});

test('a structural block may not be smuggled into a text chunk', () => {
  assert.throws(
    () => compileChunk([{ kind: 'para', text: 'a' }, { kind: 'table', rows: [[1]], cols: [[1]] }]),
    /structural block "table" must be compiled alone/
  );
});

test('a page break advances the cursor by exactly one', () => {
  const { cursor } = compileChunk([{ kind: 'para', text: 'x' }, { kind: 'pagebreak' }], { startIndex: 1 });
  assert.equal(cursor, 1 + 2 + 1);
});

test('compilePlan splits at a table and marks the cursor unknown after it', () => {
  const plan = compilePlan([
    { kind: 'body', text: 'Sebelum' },
    { kind: 'table', rows: [['a', 'b']], cols: [['a', 'b']] },
    { kind: 'body', text: 'Sesudah' }
  ], { startIndex: 1 });

  assert.equal(plan.chunks.length, 3);
  assert.equal(plan.chunks[1].kind, 'table');
  assert.equal(plan.chunks[1].needsReread, true);
  assert.equal(plan.nextIndex, null, 'the cursor after a table cannot be predicted');
});

test('compileTable refuses a malformed grid instead of guessing', () => {
  assert.throws(() => compileTable({ kind: 'table', rows: [], cols: [] }), /rows and cols/);
  assert.throws(() => compileTable({ kind: 'para' }), /expects kind "table"/);
});

// The cursor after block k is the legal insert position for block k+1.

test('every insert index stays strictly below the segment end', () => {
  const { requests, cursor } = compileChunk([
    { kind: 'body', text: 'AAA' },
    { kind: 'body', text: 'BBB' },
    { kind: 'body', text: 'CCC' }
  ], { startIndex: 1 });

  const inserts = requests.filter((r) => r.insertText);
  assert.equal(inserts[0].insertText.location.index, 1);
  assert.equal(inserts[1].insertText.location.index, 4);
  assert.equal(inserts[2].insertText.location.index, 8);
  assert.ok(cursor < 13);
});

test('only the first block is bare; the rest carry a leading newline', () => {
  const { requests } = compileChunk([
    { kind: 'body', text: 'AAA' },
    { kind: 'body', text: 'BBB' }
  ], { startIndex: 1 });

  const texts = requests.filter((r) => r.insertText).map((r) => r.insertText.text);
  assert.deepEqual(texts, ['AAA', '\nBBB']);
});

test('a style range starts after the newline that opened the paragraph', () => {
  const { requests } = compileChunk([
    { kind: 'body', text: 'AAA' },
    { kind: 'h1', text: 'BBB' }
  ], { startIndex: 1 });

  const style = requests.find((r) => r.updateParagraphStyle && r.updateParagraphStyle.range.startIndex === 5);
  assert.deepEqual(style.updateParagraphStyle.range, { startIndex: 5, endIndex: 9 });
});

test('a block with no kind is rejected at compile time, not at API time', () => {
  assert.throws(() => compileChunk([{ text: 'tanpa kind' }]), /every block needs a kind/);
});