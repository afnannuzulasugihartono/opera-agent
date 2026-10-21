// @last-edited: 2026-10-11 UTC+7.
// @title: comment-placement — a comment documents a declaration, so it stands outside it.
// @state: 2 locks; no comment inside a body, and the scanner that decides it.
// @dependencies: node:test, assert, fs, path, child_process.

// A COMMENT DOCUMENTS A DECLARATION, SO IT STANDS OUTSIDE IT.
//
// Above a declaration or a top-level statement is fine: the file header, a function
// above its signature, a config key above its value. Inside a body is not: between two
// statements, inside a loop, in the middle of a stylesheet or a SQL statement.
//
// WHY, MEASURED: 4,036 comments in this repository before the rule, a large share inside
// bodies. The cost was never the words — a comment three lines from the decision it
// describes stops describing it when the code moves, and nothing notices, because a stale
// comment is still syntactically a comment. A comment inside a body reads as permanent:
// it looks like part of the algorithm, so nobody touches the block around it.
//
// WHY NO CARVE-OUT: the rule first said "runtime code, but not tests". That was true and
// still wrong — "which files count" is the question a gate exists to stop having. So the
// scope is every tracked and untracked file, in every language.
//
// WHAT IT COST: 705 lines of migration notes in supabase/migrations/, which recorded why
// each migration exists. That history is now only in git. Recorded here rather than left
// to be discovered.

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

function findComments(source, language) {
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