// @last-edited: 2026-10-04 11:10 UTC.
// @title: file-headers — every file carries its header in the @tag shape.
// @context: Test.
// @state: Headers carry @last-edited with UTC time, then @title, @context, @state, @updated.
// @updated: file headers rewritten one @tag per line with UTC time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// File headers, locked in the @tag shape the rules require: @last-edited with a
// UTC timestamp, then @title, @context, @state, @updated, one tag per line. A
// .md carries @last-edited only. Migrations, JSON and lockfiles cannot carry
// one: migrations must never be rewritten, and JSON has no comments.

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_EXACT = new Set([
  'LICENSE',
  'release-trigger/v1.0.1',
  'supabase/functions/opera-agent-mcp/deno.lock',
]);
const SKIP_EXT = new Set(['.json', '.lock']);
const STAMP = /^@last-edited: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\.$/;

const allFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

function headerLines(file) {
  const body = fs.readFileSync(path.join(root, file), 'utf8');
  const lines = body.split('\n');
  if (path.extname(file) === '.md') {
    const start = lines[0] === '---'
      ? lines.findIndex((l, i) => i > 0 && l === '---') + 1
      : 0;
    return { lines, start, count: 1 };
  }
  return { lines, start: 0, count: 5 };
}

function strip(line) {
  return line
    .replace(/^\s*(?:\/\/|#|--|REM|\/\*|<!--)\s*/, '')
    .replace(/\s*(?:\*\/|-->)\s*$/, '');
}

test('every file carries its header in the @tag shape', () => {
  let checked = 0;
  for (const file of allFiles) {
    if (SKIP_EXACT.has(file) || file.startsWith('supabase/migrations/')) continue;
    if (SKIP_EXT.has(path.extname(file).toLowerCase())) continue;
    const { lines, start, count } = headerLines(file);
    assert.ok(
      STAMP.test(strip(lines[start])),
      `${file} line ${start + 1} must be @last-edited with a UTC timestamp`
    );
    if (count === 5) {
      const tags = lines.slice(start, start + 6).map((l) => strip(l).split(':')[0]);
      assert.deepEqual(
        tags,
        ['@last-edited', '@title', '@context', '@state', '@updated', '@dependencies'],
        `${file} must carry @last-edited, @title, @context, @state, @updated, @dependencies in order`
      );
    }
    checked++;
  }
  assert.ok(checked > 150, `expected the whole tree checked, saw ${checked}`);
});
