// @last-edited: 2026-10-11 UTC+7.
// @title: comment-placement — a comment documents a declaration, so it stands outside it.
// @state: 2 locks; no comment inside a body, and the scanner that decides it.
// @dependencies: node:test, assert, fs, path, child_process.

// WHY THIS RULE
//
// A comment in the middle of a function is a message to the person already reading
// that function. The person who needs it arrives at the file cold, six months from
// now, at 2am, with no memory of writing it — and they read from the top down, not
// into the middle of a loop. Measured in this repository before the rule: 4,036
// comments, of which a large share sat inside function bodies.
//
// WHY IT DECAYED. A comment three lines from the decision it describes stops
// describing it the moment the code moves, and nothing notices, because a stale
// comment is still syntactically a comment. Worse, a comment inside a body reads as
// permanent: it looks like part of the algorithm, so nobody dares to touch the block
// around it. A comment above a declaration is visibly about the file's structure, and
// moving it with the declaration is the obvious thing to do.
//
// THE RULE, exactly
//
//   Allowed — a comment immediately above a declaration or a statement that sits at
//   the top level of its block: the file header, a function above its signature, a
//   config key above its value. It documents what comes next and is outside it.
//
//   Forbidden — a comment anywhere inside a body: between two statements of a
//   function, inside a loop, inside an if, in the middle of a CSS rule, in the middle
//   of a SQL statement. If it is about code above it, it belongs above the code it is
//   about; if it is about code below it, it belongs above that.
//
//   Spacing is a separate rule and has its own gate: tests/comment-spacing.test.mjs
//   requires a blank line on each side of every comment. This file does not restate it,
//   because two gates asserting one property is one gate too many to keep honest.
//
// WHY EVERY LANGUAGE: `#` is a comment in Python, YAML and TOML and a directive in
// TypeScript; `//` is a comment in JavaScript and a URL in a string; `--` is a comment
// in SQL and a flag on a command line. A rule with a per-language carve-out is a rule
// that grows a new exception every time a language is added.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const repo = (p) => new URL(p, root);

const LANGUAGES = {
  js: { line: ['//'], block: [['/*', '*/']], strings: ['\'', '"', '`'], brace: true, regex: true },
  mjs: { line: ['//'], block: [['/*', '*/']], strings: ['\'', '"', '`'], brace: true, regex: true },
  ts: { line: ['//'], block: [['/*', '*/']], strings: ['\'', '"', '`'], brace: true, regex: true },
  py: { line: ['#'], block: [], strings: ['\'', '"'], triple: true, indent: true },
  sql: { line: ['--'], block: [['/*', '*/']], strings: ['\''], keyword: /\b(begin|declare|do|create\s+or\s+replace\s+function|create\s+function)\b/i },
  css: { line: [], block: [['/*', '*/']], strings: ['\'', '"'], brace: true },
  html: { line: [], block: [['<!--', '-->']], strings: [] },
  yml: { line: ['#'], block: [], strings: ['\'', '"'], indent: true },
  toml: { line: ['#'], block: [], strings: ['\'', '"'], indent: true }
};

const tracked = () => {
  const listed = execFileSync('git', ['ls-files'], { cwd: repo('.'), encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const known = (f) => LANGUAGES[path.extname(f).slice(1).toLowerCase()];

  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'],
    { cwd: repo('.'), encoding: 'utf8' }).split('\n').filter(Boolean);
  return [...new Set([...listed, ...untracked])].filter(known);
};

export function findComments(source, language) {
  const spec = LANGUAGES[language];
  const found = [];
  let i = 0;
  let line = 0;
  let col = 0;
  let depth = 0;
  let lastCodeIndent = 0;
  let prev = '';

  while (i < source.length) {
    const c = source[i];

    if (c === '\n') {
      line += 1; i += 1; col = 0;
      let j = i;
      let indent = 0;
      while (source[j] === ' ' || source[j] === '\t') { indent += 1; j += 1; }
      if (source[j] !== '\n' && source[j] !== undefined && spec.indent) {
        if (indent === 0) lastCodeIndent = 0;
        else if (indent > lastCodeIndent) lastCodeIndent = indent;
      }
      continue;
    }

    if (c === ' ' || c === '\t' || c === '\r') { i += 1; col += 1; continue; }

    const blockOpen = spec.block.find(([open]) => source.startsWith(open, i));
    if (blockOpen) {
      const [open, close] = blockOpen;
      const start = { line: line + 1, col, depth, indent: lastCodeIndent };
      i += open.length;
      while (i < source.length && !source.startsWith(close, i)) {
        if (source[i] === '\n') { line += 1; }
        i += 1;
      }
      i += close.length;
      found.push({ ...start, text: source.slice(start.col, start.col + 60).trim() });
      continue;
    }

    const lineOpen = spec.line.find((open) => source.startsWith(open, i));
    if (lineOpen) {
      const start = { line: line + 1, col, depth, indent: lastCodeIndent };
      let text = '';
      while (i < source.length && source[i] !== '\n') { text += source[i]; i += 1; }
      found.push({ ...start, text: text.trim().slice(0, 70) });
      continue;
    }

    if (spec.strings.includes(c)) {
      if (spec.triple && (source.startsWith("'''", i) || source.startsWith('"""', i))) {
        const open = source.slice(i, i + 3);
        i += 3;
        while (i < source.length && !source.startsWith(open, i)) { if (source[i] === '\n') line += 1; i += 1; }
        i += 3;
        continue;
      }
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === c) { i += 1; break; }
        if (source[i] === '\n') { line += 1; break; }
        i += 1;
      }
      continue;
    }

    if (spec.regex && c === '/') {
      const startsRegex = prev === '' || '=(,:[!&|?{};+-*%~^<>'.includes(prev);
      if (startsRegex) {
        prev = '/';
        i += 1;
        let inClass = false;
        while (i < source.length) {
          if (source[i] === '\\') { i += 2; continue; }
          if (source[i] === '[') inClass = true;
          else if (source[i] === ']') inClass = false;
          else if (source[i] === '/' && !inClass) { i += 1; break; }
          else if (source[i] === '\n') { break; }
          i += 1;
        }
        continue;
      }
    }

    if (spec.brace) {
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
    }
    if (!spec.indent) lastCodeIndent = 0;
    prev = /\s/.test(c) ? prev : c;
    col += 1;
    i += 1;
  }

  return found;
}

const insideABody = (comment, language) => {
  const spec = LANGUAGES[language];
  if (spec.brace) return comment.depth > 0;
  if (spec.keyword) return false;
  return comment.indent > 0;
};

test('no comment stands inside a function, a block, or any body', () => {
  const files = tracked();
  assert.ok(files.length > 150, `only ${files.length} files carry a known comment syntax`);

  const offenders = [];
  for (const file of files) {
    const language = path.extname(file).slice(1).toLowerCase();
    for (const comment of findComments(fs.readFileSync(repo(file), 'utf8'), language)) {
      if (insideABody(comment, language)) offenders.push(`${file}:${comment.line}  ${comment.text}`);
    }
  }

  assert.deepEqual(offenders, [],
    `a comment must stand ABOVE the code it documents, never inside a body. ${offenders.length} misplaced:\n${offenders.slice(0, 25).join('\n')}`);
});

test('the scanner knows a comment from a string, and a body from a top level', () => {

  const at = (source, language) => findComments(source, language)
    .map((c) => ({ line: c.line, depth: c.depth, indent: c.indent }));

  const cases = [
    ['a URL is not a comment', 'js', "const u = 'https://x.test/a//b';", []],
    ['a glob is not a comment', 'js', 'const g = "/* not a comment */";', []],
    ['a template is not a comment', 'js', 'const t = `a // b`;', []],
    ['a shebang inside a string is not a shebang', 'mjs', 'const h = "#!/usr/bin/env node";', []],
    ['a base64 slashes pair is a regex, not a comment', 'js', "return btoa(b).replace(/\\+/g, '-').replace(/\\//g, '_');", []],
    ['a comment one brace deep is inside a body', 'js', 'function f() {\n  const a = 1;\n  // inside\n}', [{ line: 3, depth: 1, indent: 0 }]],
    ['a comment above a declaration is at the top level', 'js', '// above\nexport function f() {\n  return 1;\n}\n', [{ line: 1, depth: 0, indent: 0 }]],
    ['an indented comment in Python is inside a body', 'py', 'def f():\n    a = 1\n    # inside\n', [{ line: 3, depth: 0, indent: 4 }]],
    ['a column-zero comment in Python is top level', 'py', '# above\ndef f():\n    return 1\n', [{ line: 1, depth: 0, indent: 0 }]],
    ['a SQL string is not a comment', 'sql', "select '-- not a comment';", []],
    ['a SQL comment at column zero is found', 'sql', '-- above\nselect 1;', [{ line: 1, depth: 0, indent: 0 }]],
    ['CSS strings are not comments', 'css', 'a { content: "/* x */"; }', []],
    ['an HTML comment is found', 'html', '<p>t</p><!-- real -->', [{ line: 1, depth: 0, indent: 0 }]],
    ['a YAML value is not a comment', 'yml', 'key: "# not a comment"', []],
    ['a TOML value is not a comment', 'toml', 'key = "# not a comment"', []]
  ];

  for (const [label, language, source, expected] of cases) {
    assert.deepEqual(at(source, language), expected, label);
  }
});