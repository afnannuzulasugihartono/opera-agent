// Last edited: 2026-10-04 17:52. Title: doc-graph.test — Every .md must be reachable from another .md, must carry a Related: line, and Now: every document gets a Need row, and each turn passes the map.

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

test('every document is mutual with the hub, not just reachable through it', () => {
  // Reachability alone lets a document drift: it is pointed at but points at
  // nothing in return, so a reader who lands on it has no way back to the map.
  // The hub is AGENTS.md, the one file an agent is guaranteed to read. Mutual
  // means both directions: the hub names every document, and every document
  // names the hub in its Related: line. A full mesh would bloat every header;
  // the hub keeps it one hop each way.
  const hub = 'AGENTS.md';
  const hubLinks = new Set(
    [...text.get(hub).matchAll(/\]\(([^)#][^)]*)\)/g)]
      .map((match) => match[1].trim())
      .filter((target) => !/^[a-z]+:/i.test(target))
      .map((target) =>
        path.relative(root, path.resolve(root, target)).split(path.sep).join('/')
      )
  );
  for (const file of tracked) {
    if (file === hub) continue;
    assert.ok(
      hubLinks.has(file),
      `${file} is not named by the hub ${hub}`
    );
    const related = text.get(file).match(/^(?:-\s*)?Related:(.*)$/m);
    assert.ok(related, `${file} has no Related: line naming the hub`);
    const namesHub = [...related[1].matchAll(/\(([^)#][^)]*)\)/g)]
      .map((match) => match[1].trim())
      .filter((target) => !/^[a-z]+:/i.test(target))
      .map((target) =>
        path
          .relative(root, path.resolve(path.dirname(path.join(root, file)), target))
          .split(path.sep)
          .join('/')
      )
      .includes(hub);
    assert.ok(namesHub, `${file} does not name the hub ${hub} in its Related: line`);
  }
});

test('every document has a Need row, so the map can route to it', () => {
  // A document with no Need row is opened only by accident: nothing tells the
  // agent in which situation to read it, so it is never read. The area table
  // routes the three area scopes; the Need table routes the rest. Every tracked
  // document except the hub itself must be a target in one of them.
  const hub = 'AGENTS.md';
  const body = text.get(hub);
  const mapSection = body.split('## Which document answers what')[1].split('## Commands')[0];
  const bootstrapSection = body.split('## Bootstrap order')[1].split('## Which')[0];
  const targets = new Set(
    [...(mapSection + bootstrapSection).matchAll(/\]\(([^)#][^)]*)\)/g)]
      .map((match) => match[1].trim())
      .filter((target) => !/^[a-z]+:/i.test(target))
      .map((target) =>
        path.relative(root, path.resolve(root, target)).split(path.sep).join('/')
      )
  );
  for (const file of tracked) {
    if (file === hub) continue;
    assert.ok(targets.has(file), `${file} has no Need row routing to it`);
  }
});