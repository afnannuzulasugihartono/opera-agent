import test from 'node:test';
import assert from 'node:assert/strict';
import { stripComments } from './helpers/source-scan.mjs';

// Committed tests for the comment stripper. The stripper protects a security lock,
// and its failure direction is a FALSE PASS -- comment handling that deletes live
// code makes the lock blind exactly when it matters. So the cases below are
// written in two directions: live code must survive, and comment text must go.

test('stripComments never deletes live code', () => {
  const survives = [
    // A block-comment opener inside a string literal must not start a comment.
    ['block opener in a string', 'const re = "/* not a comment";\nconst keep = live();\n', 'javascript', 'live()'],
    // A closer inside a later string literal must not end one either.
    ['block closer in a later string', 'const a = "/*";\nconst b = "*/";\nconst keep = live();\n', 'javascript', 'live()'],
    // A line comment inside a template literal is code, not a comment.
    ['line comment in a template', 'const q = `\n// select status from devices\n${live()}\n`;\n', 'javascript', 'live()'],
    // A URL in a string is not a comment.
    ['double slash in a URL', 'const u = "https://example.test/a";\nconst keep = live();\n', 'javascript', 'live()'],
    // SQL string literal holding a comment marker.
    ['sql marker in a string', "select '-- not a comment';\nselect keep from t;\n", 'sql', 'keep from t'],
    // A dollar-quoted function body containing a comment marker in a string.
    ['dollar-quoted body', "create function f() returns void as $f$ select '-- x' $f$ language sql;\nselect keep from t;\n", 'sql', 'keep from t'],
    // An escaped quote must not end the string early.
    ['escaped backslash', 'const s = "a\\\\";\nconst keep = live();\n', 'javascript', 'live()'],
    // CRLF input must survive intact.
    ['crlf line endings', 'const a = 1;\r\nconst keep = live();\r\n', 'javascript', 'live()'],
    // A trailing comment on a code line is code-preserving.
    ['trailing comment keeps code', 'const a = 1; // note\nconst keep = live();\n', 'javascript', 'const a = 1;']
  ];
  for (const [label, input, kind, needle] of survives) {
    assert.ok(stripComments(input, kind).includes(needle), `live code survives: ${label}`);
  }
});

test('stripComments neutralises comment text', () => {
  const removed = [
    ['js line comment', '// status = disabled_marker()\n', 'javascript'],
    ['indented js line comment', '    // status = disabled_marker()\n', 'javascript'],
    ['sql line comment', "-- status = 'disabled_marker()'\n", 'sql'],
    ['block comment', '/* status = disabled_marker() */\n', 'javascript'],
    ['multi-line block comment', '/*\n status = disabled_marker()\n*/\n', 'javascript'],
    ['block comment with an apostrophe', "/* it's status = disabled_marker() */\n", 'javascript']
  ];
  for (const [label, input, kind] of removed) {
    assert.doesNotMatch(stripComments(input, kind), /disabled_marker/, `comment removed: ${label}`);
  }
});

test('stripComments preserves length and line structure', () => {
  const src = 'const a = 1; // note\n/* block\n   note */\nconst b = "x";\n';
  const out = stripComments(src, 'javascript');
  assert.equal(out.length, src.length, 'length preserved');
  assert.equal(out.split('\n').length, src.split('\n').length, 'line count preserved');
});