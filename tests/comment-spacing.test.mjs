// @last-edited: 2026-10-10 UTC+7.
// @title: comment-spacing — the scanner behind the blank-line rule must actually see comments.
// @state: pins classifyJs against the interpolation that blinded it, so a green hygiene run means the rule was measured rather than skipped.
// @dependencies: node:test, node:assert/strict, tests/helpers/comment-spacing.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { commentClasses, spacingViolations } from './helpers/comment-spacing.mjs';

test('an interpolation does not blind the scanner to the comments below it', () => {
  // WHY this shape: `${name}` put classifyJs into template mode and left it there, so every
  // line after it was read as string content. Comments stopped existing for the scanner,
  // spacingViolations returned nothing, and the whole repo reported clean. The rule was
  // never running on the 106 files that interpolate.
  const text = [
    'const url = new URL(`./f/${name}`, import.meta.url);',
    '',
    '// this comment is invisible to the scanner as it stands',
    'const x = 1;',
    '',
  ].join('\n');

  const violations = spacingViolations('x.mjs', text, '.mjs');
  assert.deepEqual(violations, ['x.mjs:4 no blank line after the comment block']);
});

test('the comment itself is classified, not just the violation it causes', () => {
  const text = [
    'const url = new URL(`./f/${name}`, import.meta.url);',
    '',
    '// seen',
    '',
    'const x = 1;',
    '',
  ].join('\n');
  assert.equal(commentClasses(text, '.mjs')[2].comment, true);
});

test('an interpolation carrying its own braces returns to the template', () => {
  // WHY: depth has to start at the brace `${` already consumed. Counting from zero popped
  // at the inner closing brace and left the rest of the line read as code.
  const text = [
    'const t = `a${ { k: 1 }.k }b`;',
    '',
    '// seen',
    '',
    'const z = 1;',
    '',
  ].join('\n');
  const classes = commentClasses(text, '.mjs');
  assert.equal(classes[2].comment, true);
  assert.equal(classes[0].string, true, 'the whole line is still one template value');
});

test('a // inside a string is still not a comment', () => {
  // WHY paired with the fix: loosening the scanner would trade blindness for false
  // comments, and a URL in a string is common enough to fire on.
  const text = [
    "const url = 'https://example.test/path';",
    '',
    '// this one really is a comment',
    'const y = 1;',
    '',
  ].join('\n');
  assert.deepEqual(spacingViolations('y.mjs', text, '.mjs'), [
    'y.mjs:4 no blank line after the comment block',
  ]);
});

test('an indented comment inside a function is judged like any other block', () => {
  const text = [
    'function f() {',
    '  const a = 1;',
    '  // WHY: it documents what follows',
    '  return a;',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(spacingViolations('z.mjs', text, '.mjs'), [
    'z.mjs:3 no blank line before the comment block',
  ]);
});
