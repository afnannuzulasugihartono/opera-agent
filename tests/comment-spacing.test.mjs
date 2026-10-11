// @last-edited: 2026-10-10 UTC+7.
// @title: comment-spacing — the scanner behind the blank-line rule must actually see comments.
// @state: pins the scanner against every way it has gone blind — interpolation, a regex literal holding a quote, a script tag, a shell block scalar, a dialect with no extension — so a green hygiene run means the rule was measured rather than skipped.
// @dependencies: node:test, node:assert/strict, tests/helpers/comment-spacing.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { commentClasses, spacingViolations } from './helpers/comment-spacing.mjs';

const source = (...lines) => [...lines, ''].join('\n');
const scan = (file, ext, ...lines) => spacingViolations(file, source(...lines), ext);
const probe = (ext, ...lines) => commentClasses(source(...lines), ext);

test('an interpolation does not blind the scanner to the comments below it', () => {

  assert.deepEqual(scan('x.mjs', '.mjs',
    'const url = new URL(`./f/${name}`, import.meta.url);',
    '',
    '// this comment is invisible to the scanner as it stands',
    'const x = 1;',
  ), ['x.mjs:4 no blank line after the comment block']);

  assert.deepEqual(scan('clean.mjs', '.mjs',
    'const url = new URL(`./f/${name}`, import.meta.url);',
    '',
    '// this one is seen, and it is spaced correctly',
    '',
    'const x = 1;',
  ), []);
});

test('the comment itself is classified, not just the violation it causes', () => {
  assert.equal(probe('.mjs',
    'const url = new URL(`./f/${name}`, import.meta.url);',
    '',
    '// seen',
    '',
    'const x = 1;',
  )[2].comment, true);
});

test('an interpolation carrying its own braces returns to the template', () => {

  const seen = probe('.mjs',
    'const t = `a${ { k: 1 }.k }b`;',
    '',
    '// seen',
    '',
    'const z = 1;',
  );
  assert.equal(seen[2].comment, true);
  assert.equal(seen[0].string, true, 'the whole line is still one template value');
});

test('a // inside a string is still not a comment', () => {

  assert.deepEqual(scan('y.mjs', '.mjs',
    "const url = 'https://example.test/path';",
    '',
    '// this one really is a comment',
    'const y = 1;',
  ), ['y.mjs:4 no blank line after the comment block']);
});

test('an indented comment inside a function is judged like any other block', () => {
  assert.deepEqual(scan('z.mjs', '.mjs',
    'function f() {',
    '  const a = 1;',
    '  // WHY: it documents what follows',
    '  return a;',
    '}',
  ), ['z.mjs:3 no blank line before the comment block']);
});

test('a regex literal holding a quote does not blind the comments below it', () => {

  assert.deepEqual(scan('r.mjs', '.mjs',
    'const m = [...list.matchAll(/endsWith\\("([^"]+)"\\)/g)];',
    '',
    '// this was unreadable while the line above was parsed as strings',
    'const x = 1;',
  ), ['r.mjs:4 no blank line after the comment block']);
});

test('a regex literal holding a backtick does not open a template', () => {

  assert.equal(probe('.mjs',
    'const BACKTICKS = /`([^`]+)`/g;',
    '',
    '// read after the literal',
    'const y = 1;',
  )[2].comment, true);
});

test('division is not mistaken for a literal that swallows the comment after it', () => {

  assert.deepEqual(scan('d.mjs', '.mjs',
    'const s = fmt(a / b // nothing closed here',
    '  , c);',
    '',
    '// still a comment',
    'const z = 1;',
  ), ['d.mjs:5 no blank line after the comment block']);
});

test('the body of a script tag is classified as JavaScript, not as HTML', () => {

  assert.deepEqual(scan('p.html', '.html',
    '<script type="module">',
    '  // WHY this is a real comment inside a module script',
    '  const x = 1;',
    '</script>',
  ), ['p.html:2 no blank line before the comment block']);
});

test('every line of a comment that opens on its own line is a comment', () => {

  assert.deepEqual(scan('h.html', '.html',
    '<!--',
    '  @title: the second line of this comment was read as code',
    '-->',
    '<p>hi</p>',
  ), ['h.html:4 no blank line after the comment block']);

  assert.deepEqual(scan('quiet.html', '.html',
    '<p>above</p>',
    '',
    '<!-- a page comment with room around it -->',
    '',
    '<p>below</p>',
  ), []);
});

test('JavaScript inside a shell string in a YAML run block is still JavaScript', () => {

  assert.deepEqual(scan('w.yml', '.yml',
    'jobs:',
    '  build:',
    '    run: |',
    '      SIGNED="$(node -e "',
    '        const x = 1;',
    '        // WHY: a JavaScript comment inside a shell string',
    '        console.log(x);',
    '      )"',
  ), ['w.yml:6 no blank line before the comment block']);
});

test('a shell region with no closing quote is not treated as one', () => {

  assert.equal(probe('.yml',
    '      node -e "process.exit(1)" \\',
    '        || exit 1',
    '      # a shell comment afterwards',
  )[2].comment, true);
});

test('a dialect with no file extension still comments with #', () => {

  assert.deepEqual(scan('ignorefile', '',
    '# @title: root ignore file',
    'node_modules/',
  ), ['ignorefile:2 no blank line after the comment block']);
});

test('toml and env files comment with # and are read like any other dialect', () => {
  assert.deepEqual(scan('c.toml', '.toml',
    '# why this rule exists',
    'key = 1',
  ), ['c.toml:2 no blank line after the comment block']);
  assert.deepEqual(scan('e.example', '.example',
    '# why this variable exists',
    'FLAG=1',
  ), ['e.example:2 no blank line after the comment block']);
});

test('every comment block in a file is reported where it actually sits', () => {

  const found = scan('two.mjs', '.mjs',
    'const a = 1;',
    '',
    '// the first block',
    'const b = 2;',
    '',
    '// the second block',
    'const c = 3;',
  );
  assert.equal(found.length, 2);
  assert.match(found[0], /^two\.mjs:4 /);
  assert.match(found[1], /^two\.mjs:7 /);
});

test('a file with no comments at all reports nothing', () => {

  const found = scan('plain.mjs', '.mjs',
    'const a = 1;',
    'const b = a + 1;',
    'const c = b * 2;',
    'export default c;',
  );
  assert.deepEqual(found, []);
});

test('a comment on the first line has no code above it to be spaced from', () => {

  const found = scan('header.mjs', '.mjs',
    '// @title: the first line of this file is its own comment',
    '',
    'const a = 1;',
  );
  assert.deepEqual(found, []);
});

test('a comment that ends the file still needs the code above it spaced', () => {

  const found = scan('tail.mjs', '.mjs',
    'const a = 1;',
    'const b = a + 1;',
    '// WHY: the file ends on this line',
  );
  assert.match(found[0], /no blank line before/);
});
