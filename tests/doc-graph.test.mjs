import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every .md must be reachable from another .md, must carry a Related: line, and
// every relative link in it must resolve. The owner's rule is that the documents are
// related to each other, and a lock only counts when it can fail: each check below
// names a violation that would otherwise pass review silently. The file list comes
// from the filesystem, not from git, because a document that has been written but
// not yet added is exactly the orphan this has to catch.

const root = fileURLToPath(new URL('..', import.meta.url));
const skip = new Set(['.git', 'node_modules', '.kilo']);

function walk(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

const allFiles = new Set(
  walk(root).map((full) => path.relative(root, full).split(path.sep).join('/'))
);
const tracked = [...allFiles].filter((file) => file.endsWith('.md'));

const text = new Map(
  tracked.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')])
);

test('the repository tracks documents to check', () => {
  assert.ok(tracked.length >= 20, `expected the full document set, saw ${tracked.length}`);
});

test('every relative link in a document resolves to a file that exists', () => {
  for (const [file, body] of text) {
    for (const match of body.matchAll(/\]\(([^)#][^)]*)\)/g)) {
      const target = match[1].trim();
      if (/^[a-z]+:/i.test(target)) continue; // absolute URL
      const resolved = path
        .relative(root, path.resolve(path.dirname(path.join(root, file)), target))
        .split(path.sep)
        .join('/');
      assert.ok(allFiles.has(resolved), `${file} links to ${target}, which does not exist`);
    }
  }
});

test('every document names its relatives', () => {
  for (const [file, body] of text) {
    assert.match(body, /Related:/, `${file} has no Related: line`);
  }
});

test('no document is an orphan: another document points at it', () => {
  for (const file of tracked) {
    const linkedFromSomewhere = tracked.some(
      (other) =>
        other !== file &&
        [...text.get(other).matchAll(/\]\(([^)#][^)]*)\)/g)].some((match) => {
          const target = match[1].trim();
          if (/^[a-z]+:/i.test(target)) return false;
          return path
            .relative(root, path.resolve(path.dirname(path.join(root, other)), target))
            .split(path.sep)
            .join('/') === file;
        })
    );
    assert.ok(linkedFromSomewhere, `${file} is not linked from any other document`);
  }
});