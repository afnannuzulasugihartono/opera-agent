// @last-edited: 2026-10-27 UTC+7.
// @title: local-package - the npm package has to carry every module the bin imports.
// @state: one lock; the published groups are checked against the import graph, not against memory.
// @dependencies: node:test, strict, ../local/package.json.

// WHY THIS FILE EXISTS.
// The package published seven modules and imported sixteen: the `files` list had never been touched since the first modules, so `npx opera-local` would have installed a package that dies on its first import with ERR_MODULE_NOT_FOUND.
// A release that ships that is worse than no release, because the error names a file the user never heard of.
// So the list is derived from the imports and compared here.

// WHY THE LIST NAMES GROUPS AND NOT EVERY FILE.
// The modules are grouped by the job they do, so `files` names each group once and a module added inside one ships with it.
// The gate walks the imports to prove that every module a bin can reach lands inside a named group.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const local = resolve(here, '..', 'local');
const shipped = JSON.parse(readFileSync(join(local, 'package.json'), 'utf8')).files;

const IMPORT = /from\s+'(\.[^']+)'/g;

const filesUnder = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const name = prefix ? `${prefix}/${entry.name}` : entry.name;
  return entry.isDirectory() ? filesUnder(join(dir, entry.name), name) : [name];
});

const reachable = (entry) => {
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const file = join(local, `${name}.js`);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = resolve(dirname(file), spec);
      if (!target.startsWith(`${local}${sep}`) || !existsSync(target)) continue;
      walk(relative(local, target).replace(/\.js$/, '').split(sep).join('/'));
    }
  };
  walk(entry);
  return seen;
};

// WHY EVERY FILE IN bin/ IS WALKED AND NOT ONLY opera-local.js.
// Measured: dev-shim.js sat on disk, was imported by bin/opera-local-dev.js, and was absent from the files list, so the dev binary shipped and died on its first import with ERR_MODULE_NOT_FOUND while this test passed.
// The list was only ever walked from one entry point, and a second entry point in the same directory is exactly the shape that hides.

test('every module the bin can reach is inside a published group', () => {
  const bins = readdirSync(join(local, 'bin')).filter((name) => name.endsWith('.js'));
  const entries = bins.map((name) => `bin/${name.replace(/\.js$/, '')}`);
  const needed = [...entries.flatMap((entry) => [...reachable(entry)])].map((name) => `${name}.js`);

  const covered = (name) => shipped.some((entry) => name === entry || name.startsWith(`${entry}/`));
  const missing = needed.filter((name) => !covered(name));
  assert.deepEqual(missing, [], `npx opera-local would install a package that dies on import: ${missing.join(', ')}`);
});

test('the list names nothing the package does not have', () => {
  const onDisk = filesUnder(local);

  const extra = shipped.filter((name) => !onDisk.some((file) => file === name || file.startsWith(`${name}/`)));
  assert.deepEqual(extra, [], `the package lists files it does not have: ${extra.join(', ')}`);
});

