// @last-edited: 2026-10-31 UTC+7.
// @title: doc-template — the named looks a paper may ask for.
// @state: the names a paper may name, and the rules each name gives the renderer.
// @dependencies: node:test, strict, ../local/doc-template.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAPER_TEMPLATES,
  paperTemplate
} from '../local/doc-template.js';

test('a paper with no template gets the plain look', () => {
  const template = paperTemplate(null);
  assert.equal(template.name, 'plain');
  assert.match(template.styles.body, /Arial/);
});

test('the journal template is the one the gallery names', () => {
  assert.deepEqual(PAPER_TEMPLATES, ['journal']);
  assert.equal(paperTemplate('journal').name, 'journal');
});

test('a template nobody knows is refused instead of drawn as something else', () => {
  assert.throws(() => paperTemplate('thesis'), /not one this renderer knows/);
});

test('the journal rules are the rules of the class, not a taste of ours', () => {
  const template = paperTemplate('journal');
  assert.match(template.styles.title, /font-size:26\.67px/, 'the title is 20pt');
  assert.match(template.styles.title, /text-align:left/, 'the title is ragged right');
  assert.match(template.styles.author, /font-weight:bold/, 'the author is Helvetica bold');
  assert.match(template.styles.body, /Times New Roman/, 'the body is Times');
  assert.match(template.styles.body, /font-size:13\.33px/, 'the body is 10pt');
  assert.match(template.styles.heading, /font-weight:bold/, 'the headings are bold sans');
  assert.match(template.styles.abstractCell, /#b6c1fb/, 'the abstract box is RGB(182,193,251)');
  assert.equal(template.labels.abstract, 'ABSTRACT');
  assert.equal(template.labels.keywords, 'Keywords:');
  assert.equal(template.headingText('Pengantar', 1), '1 PENGANTAR');
});
