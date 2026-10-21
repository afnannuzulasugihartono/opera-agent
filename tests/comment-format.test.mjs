// @last-edited: 2026-10-21 UTC+7.
// @title: comment-format — the structural rule for comment spacing and sentence lines, proved on an adversarial corpus.
// @state: every case the old scanner went blind on is a case here, and the rule is checked as an equality: format(file) === file.
// @dependencies: node:test, node:assert/strict, tests/helpers/comment-format.mjs.

// WHY THIS FILE EXISTS.
// The old gate was a scanner that looked for violations, so every hole in the scanner was a hole in the rule.
// This is the other kind of gate: a formatter, and the rule is that the file on disk is what the formatter writes.
// A file that the formatter cannot read is a file it does not touch, and the corpus below names each of those places so the limit is written down instead of guessed at.

// THE RULE, IN THREE PARTS.
// A comment block at column zero is a section header, and it gets a blank line before and after it.
// A comment block that is indented documents the code under it, and its spacing is left alone.
// A sentence is written on one line: the formatter joins a sentence that was wrapped and splits a line that held two.

// WHY A // BETWEEN TWO PARAGRAPHS BECOMES A BLANK LINE.
// A bare // is a placeholder for a paragraph break, and a placeholder reads as a comment line that says nothing.
// The reader gets the break from the file itself, the way every other break in the file is written.

import test from 'node:test';
import assert from 'node:assert/strict';

import { formatComments, commentLineMask } from './helpers/comment-format.mjs';

const source = (...lines) => [...lines, ''].join('\n');
const format = (ext, ...lines) => formatComments(source(...lines), ext);

const codeOf = (text, ext) => {
  const mask = commentLineMask(text, ext);
  return text.split('\n')
    .filter((line, index) => !mask[index] && line.trim() !== '')
    .join('\n');
};

test('a comment block at column zero is a header, and it is spaced from the code', () => {
  assert.equal(format('.mjs',
    'const a = 1;',
    '// why this exists',
    'const b = 2;',
  ), 'const a = 1;\n\n// why this exists\n\nconst b = 2;\n');
});

test('an indented comment documents the code under it, and its spacing is left alone', () => {
  const input = source(
    'function f() {',
    '  const a = 1;',
    '  // why this exists',
    '  return a;',
    '}',
  );
  assert.equal(formatComments(input, '.mjs'), input);
});

test('a line that holds two sentences becomes two lines', () => {
  assert.equal(format('.mjs',
    '// First. Second.',
  ), '// First.\n// Second.\n');
});

test('a sentence that was wrapped is joined, and the next one starts its own line', () => {
  assert.equal(format('.mjs',
    '// First sentence that is',
    '// wrapped across lines.',
    '// Next one.',
  ), '// First sentence that is wrapped across lines.\n// Next one.\n');
});

test('a bare // between two paragraphs becomes a blank line, not a comment line', () => {
  assert.equal(format('.mjs',
    '// Title.',
    '//',
    '// Body.',
  ), '// Title.\n\n// Body.\n');
});

test('a directive stays attached to the code it governs', () => {
  assert.equal(format('.mjs',
    '// eslint-disable-next-line no-console',
    'console.log(1);',
  ), '// eslint-disable-next-line no-console\nconsole.log(1);\n');
});

test('a star selector in a stylesheet is a selector, not a comment', () => {
  assert.equal(format('.css',
    '* { box-sizing: border-box; }',
  ), '* { box-sizing: border-box; }\n');
});

test('a stylesheet block comment is reflowed, and the rule around it holds', () => {
  assert.equal(format('.css',
    '/* First. Second. */',
    'body { color: red; }',
  ), '/*\n * First.\n * Second.\n */\n\nbody { color: red; }\n');
});

test('an HTML comment is reflowed, and each sentence is its own comment', () => {
  assert.equal(format('.html',
    '<!-- First. Second. -->',
    '<div>x</div>',
  ), '<!-- First. -->\n<!-- Second. -->\n\n<div>x</div>\n');
});

test('a template literal is data, and the rule does not reach inside it', () => {
  const input = source(
    'const x = `',
    '// First. Second.',
    '`;',
  );
  assert.equal(formatComments(input, '.mjs'), input);
});

test('a Python docstring is data, and the rule does not reach inside it', () => {
  const input = source(
    'def f():',
    '    """',
    '    # First. Second.',
    '    """',
    '    return 1',
  );
  assert.equal(formatComments(input, '.py'), input);
});

test('a shell block in a YAML run step is data, and the rule does not reach inside it', () => {
  const input = source(
    'run: |',
    '  # First. Second.',
    '  npm test',
  );
  assert.equal(formatComments(input, '.yml'), input);
});

test('JavaScript inside a YAML node -e block is JavaScript, and the rule reaches it', () => {
  assert.equal(format('.yml',
    'run: |',
    '  node -e "',
    '  // First. Second.',
    '  "',
  ), 'run: |\n  node -e "\n  // First.\n  // Second.\n  "\n');
});

test('a batch file gets its REM block spaced, and a wrapped REM is joined', () => {
  assert.equal(format('.cmd',
    '@echo off',
    'REM Opera Agent dedicated Chrome: persistent profile, debugging port, extension always loaded.',
    'REM Run this instead of opening Chrome normally. Sign in to Google once; the',
    'REM profile keeps the login and the flag keeps the extension across restarts.',
    'setlocal',
  ), '@echo off\n\nREM Opera Agent dedicated Chrome: persistent profile, debugging port, extension always loaded.\n'
    + 'REM Run this instead of opening Chrome normally.\n'
    + 'REM Sign in to Google once; the profile keeps the login and the flag keeps the extension across restarts.\n\n'
    + 'setlocal\n');
});

test('a list keeps its markers, and each sentence of an item is its own line', () => {
  assert.equal(format('.mjs',
    '// - First. Second.',
    '// - Third.',
  ), '// - First.\n//   Second.\n// - Third.\n');
});

test('an interpolation does not hide the comment below it', () => {
  assert.equal(format('.mjs',
    'const url = new URL(`./f/${name}`, import.meta.url);',
    '',
    '// this comment is visible to the rule',
    'const x = 1;',
  ), 'const url = new URL(`./f/${name}`, import.meta.url);\n\n// this comment is visible to the rule\n\nconst x = 1;\n');
});

test('an interpolation carrying its own braces returns to the template', () => {
  assert.equal(format('.mjs',
    'const t = `a${ { k: 1 }.k }b`;',
    '',
    '// this comment is visible to the rule',
    'const z = 1;',
  ), 'const t = `a${ { k: 1 }.k }b`;\n\n// this comment is visible to the rule\n\nconst z = 1;\n');
});

test('a // inside a string is a string, and the comment below it is still seen', () => {
  assert.equal(format('.mjs',
    "const url = 'https://example.test/path';",
    '',
    '// this comment is visible to the rule',
    'const y = 1;',
  ), "const url = 'https://example.test/path';\n\n// this comment is visible to the rule\n\nconst y = 1;\n");
});

test('a regex literal holding a quote does not hide the comment below it', () => {
  assert.equal(format('.mjs',
    'const m = [...list.matchAll(/endsWith\\("([^"]+)"\\)/g)];',
    '',
    '// this comment is visible to the rule',
    'const x = 1;',
  ), 'const m = [...list.matchAll(/endsWith\\("([^"]+)"\\)/g)];\n\n// this comment is visible to the rule\n\nconst x = 1;\n');
});

test('a regex literal holding a backtick does not open a template', () => {
  assert.equal(format('.mjs',
    'const BACKTICKS = /`([^`]+)`/g;',
    '',
    '// this comment is visible to the rule',
    'const y = 1;',
  ), 'const BACKTICKS = /`([^`]+)`/g;\n\n// this comment is visible to the rule\n\nconst y = 1;\n');
});

test('division is not a literal that swallows the comment after it', () => {
  assert.equal(format('.mjs',
    'const s = fmt(a / b // nothing closed here',
    '  , c);',
    '',
    '// this comment is visible to the rule',
    'const z = 1;',
  ), 'const s = fmt(a / b // nothing closed here\n  , c);\n\n// this comment is visible to the rule\n\nconst z = 1;\n');
});

test('the body of a script tag is JavaScript, and its indented comment is documentation', () => {
  const input = source(
    '<script type="module">',
    '  // WHY this is a real comment inside a module script',
    '  const x = 1;',
    '</script>',
  );
  assert.equal(formatComments(input, '.html'), input);
});

test('every line of a comment that opens on its own line is a comment', () => {
  assert.equal(format('.html',
    '<!--',
    '  @title: the second line of this comment is read as a comment',
    '-->',
    '<p>hi</p>',
  ), '<!-- @title: the second line of this comment is read as a comment -->\n\n<p>hi</p>\n');
});

test('a shell region with no closing quote is not read as one', () => {
  const input = source(
    '      node -e "process.exit(1)" \\',
    '        || exit 1',
    '      # a shell comment afterwards',
  );
  assert.equal(formatComments(input, '.yml'), input);
});

test('a dialect with no file extension still comments with #', () => {
  assert.equal(format('',
    '# @title: root ignore file',
    'node_modules/',
  ), '# @title: root ignore file\n\nnode_modules/\n');
});

test('toml and env files comment with #, and are read like any other dialect', () => {
  assert.equal(format('.toml',
    '# why this rule exists',
    'key = 1',
  ), '# why this rule exists\n\nkey = 1\n');
  assert.equal(format('.example',
    '# why this variable exists',
    'FLAG=1',
  ), '# why this variable exists\n\nFLAG=1\n');
});

test('a SQL comment is a header, and it is spaced from the statement', () => {
  assert.equal(format('.sql',
    '-- Header line',
    'create table x (id int);',
  ), '-- Header line\n\ncreate table x (id int);\n');
});

test('a comment on the first line has no code above it to be spaced from', () => {
  assert.equal(format('.mjs',
    '// @title: the first line of this file is its own comment',
    '',
    'const a = 1;',
  ), '// @title: the first line of this file is its own comment\n\nconst a = 1;\n');
});

test('a comment that ends the file still needs the code above it spaced', () => {
  assert.equal(format('.mjs',
    'const a = 1;',
    'const b = a + 1;',
    '// WHY: the file ends on this line',
  ), 'const a = 1;\nconst b = a + 1;\n\n// WHY: the file ends on this line\n');
});

test('a file with no comments at all is left alone', () => {
  const input = source(
    'const a = 1;',
    'const b = a + 1;',
    'export default b;',
  );
  assert.equal(formatComments(input, '.mjs'), input);
});

const CORPUS = [
  ['.mjs', 'const a = 1;', '// why this exists', 'const b = 2;'],
  ['.mjs', 'function f() {', '  const a = 1;', '  // why this exists', '  return a;', '}'],
  ['.mjs', '// First. Second.'],
  ['.mjs', '// First sentence that is', '// wrapped across lines.', '// Next one.'],
  ['.mjs', '// Title.', '//', '// Body.'],
  ['.mjs', '// eslint-disable-next-line no-console', 'console.log(1);'],
  ['.css', '* { box-sizing: border-box; }'],
  ['.css', '/* First. Second. */', 'body { color: red; }'],
  ['.html', '<!-- First. Second. -->', '<div>x</div>'],
  ['.mjs', 'const x = `', '// First. Second.', '`;'],
  ['.py', 'def f():', '    """', '    # First. Second.', '    """', '    return 1'],
  ['.yml', 'run: |', '  # First. Second.', '  npm test'],
  ['.yml', 'run: |', '  node -e "', '  // First. Second.', '  "'],
  ['.cmd', '@echo off', 'REM one.', 'REM two.', 'setlocal'],
  ['.mjs', '// - First. Second.', '// - Third.'],
  ['.mjs', 'const url = new URL(`./f/${name}`, import.meta.url);', '', '// seen', 'const x = 1;'],
  ['.mjs', 'const t = `a${ { k: 1 }.k }b`;', '', '// seen', 'const z = 1;'],
  ['.mjs', "const url = 'https://example.test/path';", '', '// seen', 'const y = 1;'],
  ['.mjs', 'const m = [...list.matchAll(/endsWith\\("([^"]+)"\\)/g)];', '', '// seen', 'const x = 1;'],
  ['.mjs', 'const BACKTICKS = /`([^`]+)`/g;', '', '// seen', 'const y = 1;'],
  ['.mjs', 'const s = fmt(a / b // nothing closed here', '  , c);', '', '// seen', 'const z = 1;'],
  ['.html', '<script type="module">', '  // seen', '  const x = 1;', '</script>'],
  ['.html', '<!--', '  @title: read', '-->', '<p>hi</p>'],
  ['.yml', '      node -e "process.exit(1)" \\', '        || exit 1', '      # a shell comment afterwards'],
  ['', '# @title: root ignore file', 'node_modules/'],
  ['.toml', '# why this rule exists', 'key = 1'],
  ['.example', '# why this variable exists', 'FLAG=1'],
  ['.sql', '-- Header line', 'create table x (id int);'],
  ['.mjs', '// @title: first line', '', 'const a = 1;'],
  ['.mjs', 'const a = 1;', 'const b = a + 1;', '// WHY: the file ends on this line'],
  ['.mjs', 'const a = 1;', 'const b = a + 1;', 'export default b;'],
];

test('the formatter is idempotent on every case in the corpus', () => {
  for (const [ext, ...lines] of CORPUS) {
    const once = formatComments(source(...lines), ext);
    assert.equal(formatComments(once, ext), once, `not idempotent: ${JSON.stringify(lines)}`);
  }
});

test('the formatter never changes a line that is not a comment', () => {
  for (const [ext, ...lines] of CORPUS) {
    const input = source(...lines);
    const output = formatComments(input, ext);
    assert.equal(codeOf(output, ext), codeOf(input, ext), `code changed: ${JSON.stringify(lines)}`);
  }
});

test('the corpus is the corpus, and every case in it is a case the rule decides', () => {
  assert.ok(CORPUS.length >= 30, 'the corpus is the regression net, and it must be wide');
  const decided = CORPUS.filter(([ext, ...lines]) => {
    const input = source(...lines);
    return formatComments(input, ext) !== input;
  });
  assert.ok(decided.length >= 20, `only ${decided.length} of ${CORPUS.length} cases exercise the rule`);
});
