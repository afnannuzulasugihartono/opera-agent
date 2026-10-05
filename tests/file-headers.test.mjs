// @last-edited: 2026-10-04 23:32 UTC+7.
// @title: file-headers — every file carries its header in the @tag shape.
// @state: Code carries four tags; a .md carries @last-edited then @related.
// @dependencies: test, assert, fs, path, child_process, url.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// File headers, locked in the @tag shape the rules require: @last-edited with a
// UTC timestamp, then @title, @state and @dependencies, one tag per line. A .md
// carries @last-edited only. Migrations, JSON and lockfiles cannot carry one:
// migrations must never be rewritten, and JSON has no comments. An archive cannot
// either: a zip is bytes, and the download page carries its checksum and version.
//
// Four tags, not six: @context restated @title and @updated restated
// @last-edited, so two of every six lines carried no fact the others did not.

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_EXACT = new Set([
  'LICENSE',
  'release-trigger/v1.0.1',
  'supabase/functions/opera-agent-mcp/deno.lock',
]);
const SKIP_EXT = new Set(['.json', '.lock', '.zip']);
const STAMP = /^@last-edited: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\+7\.$/;

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
    return { lines, start, count: 2 };
  }
  return { lines, start: 0, count: 4 };
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
    if (count === 4) {
      const tags = lines.slice(start, start + 4).map((l) => strip(l).split(':')[0]);
      assert.deepEqual(
        tags,
        ['@last-edited', '@title', '@state', '@dependencies'],
        `${file} must carry @last-edited, @title, @state, @dependencies in order`
      );
    } else {
      // A .md carries two tags and no body header: the stamp and the graph edge
      // that says which documents belong with it.
      const tags = lines.slice(start, start + 2).map((l) => strip(l).split(':')[0]);
      assert.deepEqual(tags, ['@last-edited', '@related'], `${file} must carry @last-edited then @related`);
    }
    checked++;
  }
  assert.ok(checked > 150, `expected the whole tree checked, saw ${checked}`);
});
