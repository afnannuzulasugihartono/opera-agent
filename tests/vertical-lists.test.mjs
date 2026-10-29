// @last-edited: 2026-10-29 UTC+7.
// @title: vertical-lists — the rule that a list announces its length before it is read.
// @state: proves the checker on both sides: the constructs that must break, and the ones that must not.
// @dependencies: node:test, strict, helpers/vertical-lists.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listViolations,
  indentViolations
} from './helpers/vertical-lists.mjs';

const violations = (source) => listViolations(source).map((item) => item.kind);

test('a list on one line is reported, with its kind', () => {
  assert.deepEqual(violations('const { a, b } = source;\n'), ['object']);
  assert.deepEqual(violations('const items = [1, 2];\n'), ['array']);
  assert.deepEqual(violations('function f(a, b) {}\n'), ['parameter']);
  assert.deepEqual(violations('import { a, b } from "./x.mjs";\n'), ['import-export']);
  assert.deepEqual(violations('export { a, b };\n'), ['import-export']);
  assert.deepEqual(violations('const o = { a: 1, b: 2 };\n'), ['object']);
  assert.deepEqual(violations('const f = (a, b) => a + b;\n'), ['parameter']);
  assert.deepEqual(violations('for (const [a, b] of pairs) {}\n'), ['array']);
  assert.deepEqual(violations("for (const name of ['a', 'b']) {}\n"), ['array']);
});

test('a list already written one item per line is not reported', () => {
  const source = [
    'const {',
    '  a,',
    '  b',
    '} = source;',
    'const items = [',
    '  1,',
    '  2',
    '];',
    ''
  ].join('\n');
  assert.deepEqual(listViolations(source), []);
});

test('call arguments and control-flow parentheses are not lists', () => {
  assert.deepEqual(listViolations('foo(a, b);\n'), []);
  assert.deepEqual(listViolations('if (a, b) {}\n'), []);
  assert.deepEqual(listViolations('for (let i = 0, n = 1; i < n; i += 1) {}\n'), []);
  assert.deepEqual(listViolations('while (a, b) {}\n'), []);
});

test('member access is not an array literal', () => {
  assert.deepEqual(listViolations('const x = table[0];\n'), []);
  assert.deepEqual(listViolations('const x = a[b];\n'), []);
});

test('strings, comments and regexes are not code', () => {
  assert.deepEqual(listViolations('const s = "a, b";\n'), []);
  assert.deepEqual(listViolations('// one, two\n'), []);
  assert.deepEqual(listViolations('/* one, two */\n'), []);
  assert.deepEqual(listViolations('const r = /a,b/g;\n'), []);
  assert.deepEqual(listViolations('const t = `a, b`;\n'), []);
});

test('blocks are not object literals', () => {
  assert.deepEqual(listViolations('if (x) { a(); b(); }\n'), []);
  assert.deepEqual(listViolations('class A { m() {} }\n'), []);
  assert.deepEqual(listViolations('() => { const a = 1, b = 2; }\n'), []);
});

test('a nested list is reported on its own line', () => {
  const source = 'const x = {\n  a: { b: 1, c: 2 }\n};\n';
  assert.deepEqual(listViolations(source), [
    {
      line: 2,
      kind: 'object',
      items: 2
    }
  ]);
});

test('indentation is two spaces per level, in spaces only', () => {
  assert.deepEqual(indentViolations('function f() {\n  return 1;\n}\n'), []);
  assert.deepEqual(indentViolations('function f() {\n   return 1;\n}\n'), [
    {
      line: 2,
      kind: 'indent 3'
    }
  ]);
  assert.deepEqual(indentViolations('\tconst a = 1;\n'), [
    {
      line: 1,
      kind: 'tab'
    }
  ]);
});

test('template and comment content keep its own indentation', () => {
  const source = [
    'const t = `',
    '   text in a template',
    '`;',
    '/*',
    ' * a comment line',
    ' */',
    ''
  ].join('\n');
  assert.deepEqual(indentViolations(source), []);
});
