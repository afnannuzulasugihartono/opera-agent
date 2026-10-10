// @last-edited: 2026-10-10 UTC+7.
// @title: comment-spacing — the scanner behind the blank-line rule must actually see comments.
// @state: pins the scanner against every way it has gone blind — interpolation, a regex literal holding a quote, a script tag, a shell block scalar, a dialect with no extension — so a green hygiene run means the rule was measured rather than skipped.
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

test('a regex literal holding a quote does not blind the comments below it', () => {
  // WHY this shape: a `"` inside `/…/` opened a string the scanner never closed, so
  // every comment after it in the file was read as string content. api-docs.test.mjs
  // and hygiene.test.mjs both went unread this way — one for a quote, one for the
  // apostrophe in `Don't`.
  const text = [
    'const m = [...list.matchAll(/endsWith\\("([^"]+)"\\)/g)];',
    '',
    '// this was unreadable while the line above was parsed as strings',
    'const x = 1;',
    '',
  ].join('\n');
  assert.deepEqual(spacingViolations('r.mjs', text, '.mjs'), [
    'r.mjs:4 no blank line after the comment block',
  ]);
});

test('a regex literal holding a backtick does not open a template', () => {
  // WHY: scripts/scope-check.mjs carried `` /`([^`]+)`/g `` on line 19 and never left
  // template mode again — the mode probe ended the file still inside it, with 15
  // comments unread behind it.
  const text = [
    'const BACKTICKS = /`([^`]+)`/g;',
    '',
    '// read after the literal',
    'const y = 1;',
    '',
  ].join('\n');
  assert.equal(commentClasses(text, '.mjs')[2].comment, true);
});

test('division is not mistaken for a literal that swallows the comment after it', () => {
  // WHY paired with the fix: the heuristic could only ever trade blindness for blindness
  // in the other direction — treating `a / b` as a literal would consume up to the next
  // slash and take a real `//` with it. regexLiteralEnd returns -1 when a comment or a
  // block opener arrives before any closing slash, and this is the shape that proves it.
  const text = [
    'const s = fmt(a / b // nothing closed here',
    '  , c);',
    '',
    '// still a comment',
    'const z = 1;',
    '',
  ].join('\n');
  assert.deepEqual(spacingViolations('d.mjs', text, '.mjs'), [
    'd.mjs:5 no blank line after the comment block',
  ]);
});

test('the body of a script tag is classified as JavaScript, not as HTML', () => {
  // WHY: classifyHtml read only `<!--`, so all 293 comments inside this tree's inline
  // module scripts were outside the rule while every one of those files reported clean.
  const text = [
    '<script type="module">',
    '  // WHY this is a real comment inside a module script',
    '  const x = 1;',
    '</script>',
    '',
  ].join('\n');
  assert.deepEqual(spacingViolations('p.html', text, '.html'), [
    'p.html:2 no blank line before the comment block',
  ]);
});

test('every line of a comment that opens on its own line is a comment', () => {
  // WHY: `<!--` and `-->` sit on separate lines in this tree's page headers, and reading
  // each line alone left the @title and @dependencies lines classified as code.
  const text = [
    '<!--',
    '  @title: the second line of this comment was read as code',
    '-->',
    '<p>hi</p>',
    '',
  ].join('\n');
  assert.deepEqual(spacingViolations('h.html', text, '.html'), [
    'h.html:4 no blank line after the comment block',
  ]);
});

test('JavaScript inside a shell string in a YAML run block is still JavaScript', () => {
  // WHY: publish-crx.yml hands a double-quoted body to `node -e`, and classifyHash reads
  // only `#` — so the five comments it carries were never examined. The region ends at
  // the first bare quote in code position, which in valid JavaScript can only be the
  // shell closing its own string.
  const text = [
    'jobs:',
    '  build:',
    '    run: |',
    '      SIGNED="$(node -e "',
    '        const x = 1;',
    '        // WHY: a JavaScript comment inside a shell string',
    '        console.log(x);',
    '      )"',
    '',
  ].join('\n');
  assert.deepEqual(spacingViolations('w.yml', text, '.yml'), [
    'w.yml:6 no blank line before the comment block',
  ]);
});

test('a shell region with no closing quote is not treated as one', () => {
  // WHY: a mistakable match has to cost nothing. `node -e "…"` that never closes leaves
  // the region unopened rather than running the JavaScript classifier to end of file.
  const text = [
    '      node -e "process.exit(1)" \\',
    '        || exit 1',
    '      # a shell comment afterwards',
    '',
  ].join('\n');
  assert.equal(commentClasses(text, '.yml')[2].comment, true);
});

test('a dialect with no file extension still comments with #', () => {
  // WHY: path.extname reports '' for `.gitignore`, `CODEOWNERS` and `_headers`. Without
  // the empty key the walk returned null for every one of them — 19 comments in the root
  // ignore file alone, never opened while the rule claimed the whole tree.
  const text = ['# @title: root ignore file', 'node_modules/', ''].join('\n');
  assert.deepEqual(spacingViolations('ignorefile', text, ''), [
    'ignorefile:2 no blank line after the comment block',
  ]);
});

test('toml and env files comment with # and are read like any other dialect', () => {
  const toml = ['# why this rule exists', 'key = 1', ''].join('\n');
  assert.deepEqual(spacingViolations('c.toml', toml, '.toml'), [
    'c.toml:2 no blank line after the comment block',
  ]);
  const env = ['# why this variable exists', 'FLAG=1', ''].join('\n');
  assert.deepEqual(spacingViolations('e.example', env, '.example'), [
    'e.example:2 no blank line after the comment block',
  ]);
});
