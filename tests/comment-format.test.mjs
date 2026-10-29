// @last-edited: 2026-10-25 UTC+7.
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

import {
  formatComments,
  commentLineMask
} from './helpers/comment-format.mjs';

const source = (...lines) => [
  ...lines,
  ''
].join('\n');
const format = (
  ext,
  ...lines
) => formatComments(source(...lines), ext);

const codeOf = (
  text,
  ext
) => {
  const mask = commentLineMask(text, ext);
  return text.split('\n')
    .filter((
      line,
      index
    ) => !mask[index] && line.trim() !== '')
    .join('\n');
};

// ONE TABLE HOLDS THE CORPUS, THE EXPECTATION, AND THE TEST NAME.
// A case without an expected output is a case the formatter must leave exactly as it found it.
// The table is the only place a case is written, so a case cannot drift from its own regression check.

const CASES = [
  {
    name: 'a comment block at column zero is a header, and it is spaced from the code',
    ext: '.mjs',
    lines: [
      'const a = 1;',
      '// why this exists',
      'const b = 2;'
    ],
    expected: 'const a = 1;\n\n// why this exists\n\nconst b = 2;\n',
  },
  {
    name: 'an indented comment is a paragraph too, and it is spaced from the code around it',
    ext: '.mjs',
    lines: [
      'function f() {',
      '  const a = 1;',
      '  // why this exists',
      '  return a;',
      '}'
    ],
    expected: 'function f() {\n  const a = 1;\n\n  // why this exists\n\n  return a;\n}\n',
  },
  {
    name: 'a line that holds two sentences becomes two lines',
    ext: '.mjs',
    lines: ['// First. Second.'],
    expected: '// First.\n// Second.\n',
  },
  {
    name: 'a sentence that was wrapped is joined, and the next one starts its own line',
    ext: '.mjs',
    lines: [
      '// First sentence that is',
      '// wrapped across lines.',
      '// Next one.'
    ],
    expected: '// First sentence that is wrapped across lines.\n// Next one.\n',
  },
  {
    name: 'a bare // between two paragraphs becomes a blank line, not a comment line',
    ext: '.mjs',
    lines: [
      '// Title.',
      '//',
      '// Body.'
    ],
    expected: '// Title.\n\n// Body.\n',
  },
  {
    name: 'a directive stays attached to the code it governs',
    ext: '.mjs',
    lines: [
      '// eslint-disable-next-line no-console',
      'console.log(1);'
    ],
  },
  {
    name: 'a star selector in a stylesheet is a selector, not a comment',
    ext: '.css',
    lines: ['* { box-sizing: border-box; }'],
  },
  {
    name: 'a stylesheet block comment is reflowed, and the rule around it holds',
    ext: '.css',
    lines: [
      '/* First. Second. */',
      'body { color: red; }'
    ],
    expected: '/*\n * First.\n * Second.\n */\n\nbody { color: red; }\n',
  },
  {
    name: 'an HTML comment is reflowed, and each sentence is its own comment',
    ext: '.html',
    lines: [
      '<!-- First. Second. -->',
      '<div>x</div>'
    ],
    expected: '<!-- First. -->\n<!-- Second. -->\n\n<div>x</div>\n',
  },
  {
    name: 'a template literal is data, and the rule does not reach inside it',
    ext: '.mjs',
    lines: [
      'const x = `',
      '// First. Second.',
      '`;'
    ],
  },
  {
    name: 'a Python docstring is data, and the rule does not reach inside it',
    ext: '.py',
    lines: [
      'def f():',
      '    """',
      '    # First. Second.',
      '    """',
      '    return 1'
    ],
  },
  {
    name: 'a shell block in a YAML run step is data, and the rule does not reach inside it',
    ext: '.yml',
    lines: [
      'run: |',
      '  # First. Second.',
      '  npm test'
    ],
  },
  {
    name: 'JavaScript inside a YAML node -e block is JavaScript, and the rule reaches it',
    ext: '.yml',
    lines: [
      'run: |',
      '  node -e "',
      '  // First. Second.',
      '  "'
    ],
    expected: 'run: |\n  node -e "\n  // First.\n  // Second.\n  "\n',
  },
  {
    name: 'a batch file gets its REM block spaced, and a wrapped REM is joined',
    ext: '.cmd',
    lines: [
      '@echo off',
      'REM Opera Agent dedicated Chrome: persistent profile, debugging port, extension always loaded.',
      'REM Run this instead of opening Chrome normally. Sign in to Google once; the',
      'REM profile keeps the login and the flag keeps the extension across restarts.',
      'setlocal',
    ],
    expected: '@echo off\n\nREM Opera Agent dedicated Chrome: persistent profile, debugging port, extension always loaded.\n'
      + 'REM Run this instead of opening Chrome normally.\n'
      + 'REM Sign in to Google once; the profile keeps the login and the flag keeps the extension across restarts.\n\n'
      + 'setlocal\n',
  },
  {
    name: 'a list keeps its markers, and each sentence of an item is its own line',
    ext: '.mjs',
    lines: [
      '// - First. Second.',
      '// - Third.'
    ],
    expected: '// - First.\n//   Second.\n// - Third.\n',
  },
  {
    name: 'an interpolation does not hide the comment below it',
    ext: '.mjs',
    lines: [
      'const url = new URL(`./f/${name}`, import.meta.url);',
      '',
      '// this comment is visible to the rule',
      'const x = 1;'
    ],
    expected: 'const url = new URL(`./f/${name}`, import.meta.url);\n\n// this comment is visible to the rule\n\nconst x = 1;\n',
  },
  {
    name: 'an interpolation carrying its own braces returns to the template',
    ext: '.mjs',
    lines: [
      'const t = `a${ { k: 1 }.k }b`;',
      '',
      '// this comment is visible to the rule',
      'const z = 1;'
    ],
    expected: 'const t = `a${ { k: 1 }.k }b`;\n\n// this comment is visible to the rule\n\nconst z = 1;\n',
  },
  {
    name: 'a // inside a string is a string, and the comment below it is still seen',
    ext: '.mjs',
    lines: [
      "const url = 'https://example.test/path';",
      '',
      '// this comment is visible to the rule',
      'const y = 1;'
    ],
    expected: "const url = 'https://example.test/path';\n\n// this comment is visible to the rule\n\nconst y = 1;\n",
  },
  {
    name: 'a regex literal holding a quote does not hide the comment below it',
    ext: '.mjs',
    lines: [
      'const m = [...list.matchAll(/endsWith\\("([^"]+)"\\)/g)];',
      '',
      '// this comment is visible to the rule',
      'const x = 1;'
    ],
    expected: 'const m = [...list.matchAll(/endsWith\\("([^"]+)"\\)/g)];\n\n// this comment is visible to the rule\n\nconst x = 1;\n',
  },
  {
    name: 'a regex literal holding a backtick does not open a template',
    ext: '.mjs',
    lines: [
      'const BACKTICKS = /`([^`]+)`/g;',
      '',
      '// this comment is visible to the rule',
      'const y = 1;'
    ],
    expected: 'const BACKTICKS = /`([^`]+)`/g;\n\n// this comment is visible to the rule\n\nconst y = 1;\n',
  },
  {
    name: 'division is not a literal that swallows the comment after it',
    ext: '.mjs',
    lines: [
      'const s = fmt(a / b // nothing closed here',
      '  , c);',
      '',
      '// this comment is visible to the rule',
      'const z = 1;'
    ],
    expected: 'const s = fmt(a / b // nothing closed here\n  , c);\n\n// this comment is visible to the rule\n\nconst z = 1;\n',
  },
  {
    name: 'the body of a script tag is JavaScript, and its comment is spaced like any other',
    ext: '.html',
    lines: [
      '<script type="module">',
      '  // WHY this is a real comment inside a module script',
      '  const x = 1;',
      '</script>'
    ],
    expected: '<script type="module">\n\n  // WHY this is a real comment inside a module script\n\n  const x = 1;\n</script>\n',
  },
  {
    name: 'every line of a comment that opens on its own line is a comment',
    ext: '.html',
    lines: [
      '<!--',
      '  @title: the second line of this comment is read as a comment',
      '-->',
      '<p>hi</p>'
    ],
    expected: '<!-- @title: the second line of this comment is read as a comment -->\n\n<p>hi</p>\n',
  },
  {
    name: 'a shell region with no closing quote is not read as one',
    ext: '.yml',
    lines: [
      '      node -e "process.exit(1)" \\',
      '        || exit 1',
      '      # a shell comment afterwards'
    ],
    expected: '      node -e "process.exit(1)" \\\n        || exit 1\n\n      # a shell comment afterwards\n',
  },
  {
    name: 'a dialect with no file extension still comments with #',
    ext: '',
    lines: [
      '# @title: root ignore file',
      'node_modules/'
    ],
    expected: '# @title: root ignore file\n\nnode_modules/\n',
  },
  {
    name: 'toml and env files comment with #, and are read like any other dialect',
    checks: [
      {
        ext: '.toml',
        lines: [
          '# why this rule exists',
          'key = 1'
        ],
        expected: '# why this rule exists\n\nkey = 1\n'
      },
      {
        ext: '.example',
        lines: [
          '# why this variable exists',
          'FLAG=1'
        ],
        expected: '# why this variable exists\n\nFLAG=1\n'
      },
    ],
  },
  {
    name: 'a SQL comment is a header, and it is spaced from the statement',
    ext: '.sql',
    lines: [
      '-- Header line',
      'create table x (id int);'
    ],
    expected: '-- Header line\n\ncreate table x (id int);\n',
  },
  {
    name: 'a comment on the first line has no code above it to be spaced from',
    ext: '.mjs',
    lines: [
      '// @title: the first line of this file is its own comment',
      '',
      'const a = 1;'
    ],
  },
  {
    name: 'a comment that ends the file still needs the code above it spaced',
    ext: '.mjs',
    lines: [
      'const a = 1;',
      'const b = a + 1;',
      '// WHY: the file ends on this line'
    ],
    expected: 'const a = 1;\nconst b = a + 1;\n\n// WHY: the file ends on this line\n',
  },
  {
    name: 'a file with no comments at all is left alone',
    ext: '.mjs',
    lines: [
      'const a = 1;',
      'const b = a + 1;',
      'export default b;'
    ],
  },
];

// A case holding checks is one test with more than one input, and it still contributes every input to the corpus.

const runsOf = (entry) => entry.checks ?? [entry];
const CORPUS = CASES.flatMap(runsOf);

for (const entry of CASES) {
  test(entry.name, () => {
    for (const {
      ext,
      lines,
      expected
    } of runsOf(entry)) {
      assert.equal(format(ext, ...lines), expected ?? source(...lines));
    }
  });
}

test('the formatter is idempotent on every case in the corpus', () => {
  for (const {
    ext,
    lines
  } of CORPUS) {
    const once = formatComments(source(...lines), ext);
    assert.equal(formatComments(once, ext), once, `not idempotent: ${JSON.stringify(lines)}`);
  }
});

test('the formatter never changes a line that is not a comment', () => {
  for (const {
    ext,
    lines
  } of CORPUS) {
    const input = source(...lines);
    const output = formatComments(input, ext);
    assert.equal(codeOf(output, ext), codeOf(input, ext), `code changed: ${JSON.stringify(lines)}`);
  }
});

test('the corpus is the corpus, and every case in it is a case the rule decides', () => {
  assert.ok(CORPUS.length >= 30, 'the corpus is the regression net, and it must be wide');
  const decided = CORPUS.filter(({
    ext,
    lines
  }) => formatComments(source(...lines), ext) !== source(...lines));
  assert.ok(decided.length >= 20, `only ${decided.length} of ${CORPUS.length} cases exercise the rule`);
});
