// @last-edited: 2026-11-10 UTC+7.
// @title: clean-code - no tabs, no CR, no trailing whitespace, no mixed endings.
// @state: every tracked text file is paid attention to at the byte level: spaces only, LF endings, no line ends with a space, and no file mixing both kinds of line break.
// @dependencies: node:test, strict, node:fs, node:child_process.

// WHY THIS FILE EXISTS.
// A file that carries invisible characters is a change nobody reviewed; the diff said nothing and the runtime didn't notice until the image in the README rendered as one line of gibberish.
// The format gate reads comments, but not the bytes around them; this one does, and it names the file when it fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve();

const tracked = () => execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.yml', '.yaml', '.toml', '.json', '.md', '.txt', '.html', '.htm', '.css', '.svg', '.cmd', '.bat', '.example']);
const TEXT_NAME = new Set(['.gitattributes', '.gitignore', '.editorconfig']);

const isText = (file) => TEXT_EXT.has(path.extname(file)) || TEXT_NAME.has(path.basename(file));

test('every tracked text file: LF only, spaces only, no trailing spaces', () => {
  const offenders = [];
  for (const file of tracked()) {
    if (!isText(file)) continue;
    const body = fs.readFileSync(path.join(root, file));
    if (body.includes(0x00)) continue;
    const text = body.toString('utf8');
    if (text.includes('\r')) { offenders.push(`${file}: CR line ending(s)`); continue; }
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (line.endsWith(' ') || line.endsWith('\t')) offenders.push(`${file}:${index + 1}: trailing whitespace`);
      if (line.includes('\t')) offenders.push(`${file}:${index + 1}: tab character`);
    });
  }
  assert.deepEqual(offenders, [], offenders.slice(0, 24).join('\n'));
});
