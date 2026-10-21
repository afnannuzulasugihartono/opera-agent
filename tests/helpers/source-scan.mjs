// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: source-scan — the source-text helpers the drift locks read.
// @state: docs and test: correct the final review's overclaims and audit-request errors.
// @dependencies: none.

// Source-text scanning helpers for drift locks.

// WHY THIS EXISTS: several locks assert something about code that comments and documentation also discuss in prose.
// Without neutralising comments those locks fire on a sentence that merely *describes* the behaviour, which makes them noisy and trains reviewers to ignore them.

// WHY A STATE MACHINE INSTEAD OF REGEXES: the first version of this file removed comment text with regular expressions, which had two failure modes that both produce a FALSE PASS on a security-relevant lock -- exactly the wrong direction to fail.
// A `/*` inside a string literal started a block comment that swallowed the rest of the file, and a `//` line inside a template literal blanked real code.
// This scanner is a small character-level state machine so that comment and string states are mutually exclusive and neither can delete live code.

// KNOWN LIMITS.
// The SQL side does not model dollar-quoted bodies as a distinct state, so a `$$`-quoted function body that contains a bare `--` or `/*` outside any string literal would be treated as a comment.
// No migration in this repository uses that shape.
// Inside `$$` bodies, quoted strings containing those markers are handled correctly, which is the realistic case.

/**
 * Replace comment text with equivalent whitespace, preserving offsets and line structure so that a caller scanning the result cannot accidentally join two previously-separate tokens.
 *
 * @param {string} src
 * @param {'sql'|'javascript'} kind
 * @returns {string} the source with comments blanked, same length and line count
 */

export function stripComments(src, kind) {
  const out = [];
  let i = 0;

  let state = 'code';

  let lineBlank = true;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (state === 'code') {
      if (ch === '\n') {
        out.push(ch);
        lineBlank = true;
        i += 1;
        continue;
      }
      if (kind !== 'sql' && ch === '/' && next === '/' && lineBlank) {
        state = 'line';
        out.push(' ', ' ');
        i += 2;
        continue;
      }
      if (kind === 'sql' && ch === '-' && next === '-') {
        state = 'line';
        out.push(' ', ' ');
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        out.push(' ', ' ');
        i += 2;
        continue;
      }
      if (ch === "'") state = 'sq';
      else if (ch === '"') state = 'dq';
      else if (ch === '`') state = 'bt';
      if (!/\s/.test(ch)) lineBlank = false;
      out.push(ch);
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        lineBlank = true;
        out.push(ch);
      } else {
        out.push(' ');
      }
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        out.push(' ', ' ');
        i += 2;
        state = 'code';
        continue;
      }
      if (ch === '\n') lineBlank = true;
      out.push(ch === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }

    if (ch === '\\') {
      out.push(ch, next ?? '');
      i += 2;
      continue;
    }
    if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"') || (state === 'bt' && ch === '`')) {
      state = 'code';
    }
    if (ch === '\n') {
      lineBlank = true;
      if (state !== 'bt') state = 'code';
    } else if (!/\s/.test(ch)) {
      lineBlank = false;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}

async function collectSources(dir, extensions) {
  const { readdir, readFile } = await import('node:fs/promises');
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) {
      out.push(...await collectSources(url, extensions));
      continue;
    }
    if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push({ name: entry.name, url, src: await readFile(url, 'utf8') });
    }
  }
  return out;
}