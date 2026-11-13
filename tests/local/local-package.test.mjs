// @last-edited: 2026-10-15 UTC+7.
// @title: local-package - the npm package has to carry every module the bin imports.
// @state: one lock; the file list is read from the import graph, not from memory.
// @dependencies: node:test, strict, ../local/package.json.

// WHY THIS FILE EXISTS.
// The package published seven modules and imported sixteen: the `files` list had never been touched since the first modules, so `npx opera-local` would have installed a package that dies on its first import with ERR_MODULE_NOT_FOUND.
// A release that ships that is worse than no release, because the error names a file the user never heard of.
// So the list is derived from the imports and compared here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const local = resolve(here, '..', '..', 'local').replace(/\\/g, '/');
const shipped = JSON.parse(readFileSync(join(local, 'package.json'), 'utf8')).files;

const IMPORT = /from '(\.{1,2}\/[^']+)'/g;

// An import that resolves outside the package does not exist on the machine the user installs to, and a run-time read of a file outside the package dies with ENOENT.
// The local server once died exactly this way on the vendored tidy copy.
// Skipping such an import silently let a package that cannot start keep the gate green, so they are collected and failed here instead.

const outside = [];

// WHY THE IMPORT IS RESOLVED AGAINST THE FILE THAT NAMES IT.
// A module in a folder imports its neighbour by a path relative to itself, so "./zip.js" inside office/ is office/zip.js and not a missing file at the package root.

// WHY THE PATHS ARE COMPARED WITH FORWARD SLASHES.
// A Windows path holds backslashes, and a check that looks for "local/" in "local\office\zip.js" finds nothing, so the walk stopped at the first folder on a Windows machine and the test passed on a package that dies on import.

const reachable = (entry) => {
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const file = join(local, `${name}.js`);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(IMPORT)) {
      const absolute = resolve(dirname(file), specifier).replace(/\\/g, '/');
      if (!absolute.startsWith(`${local}/`) && absolute !== local) {
        outside.push(`${name} imports ${specifier}`);
        continue;
      }
      const next = absolute.slice(local.length + 1).replace(/\.js$/, '');
      walk(next);
    }
  };
  walk(entry);
  return seen;
};

// WHY THE ENTRY POINT IS EXEMPT FROM THE MODULE LIST.
// npm ships a bin through the `bin` directory, not as a module anyone imports, so the entry point is covered by that name and every module below it is checked as a module.

// WHY EVERY FILE IN bin/ IS WALKED AND NOT ONLY opera-local.js.
// Measured: dev-shim.js sat on disk, was imported by bin/opera-local-dev.js, and was absent from the files list, so the dev binary shipped and died on its first import with ERR_MODULE_NOT_FOUND while this test passed.
// The list was only ever walked from one entry point, and a second entry point in the same directory is exactly the shape that hides.

test('every relative import stays inside the package, so an installed copy can boot', () => {
  const bins = readdirSync(join(local, 'bin')).filter((name) => name.endsWith('.js'));
  const entries = bins.map((name) => `bin/${name.replace(/\.js$/, '')}`);
  for (const entry of entries) reachable(entry);
  reachable('mcp-server');
  assert.deepEqual(outside, [], `these imports die on an installed copy:\n${outside.join('\n')}`);
});

test('every module the bin can reach is inside the published files', () => {
  const bins = readdirSync(join(local, 'bin')).filter((name) => name.endsWith('.js'));
  const entries = bins.map((name) => `bin/${name.replace(/\.js$/, '')}`);
  const needed = [...entries.flatMap((entry) => [...reachable(entry)]), ...reachable('mcp-server')].map((name) => `${name}.js`);

  // An entry point is carried by the "bin" directory itself rather than by a module name, so a file sitting directly in bin/ is exempt and nothing under it is.
  const missing = needed.filter((name) => !shipped.includes(name) && !(name.startsWith('bin/') && shipped.includes('bin')));
  assert.deepEqual(missing, [], `npx opera-local would install a package that dies on import: ${missing.join(', ')}`);
});

// WHY THE LIST IS COMPARED AGAINST THE DISK AND NOT AGAINST MEMORY.
// A module that lives in a folder is shipped by its path, so the check has to walk the folders too.
// A list that names a file which is not there ships an install that dies on import, which is the exact failure this file exists to prevent.

test('the list names nothing the package does not have', () => {
  const onDisk = new Set();
  for (const entry of readdirSync(local, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) onDisk.add(entry.name);
    if (!entry.isDirectory()) continue;
    for (const child of readdirSync(join(local, entry.name), { withFileTypes: true })) {
      if (child.isFile() && child.name.endsWith('.js')) onDisk.add(`${entry.name}/${child.name}`);
    }
  }

  const extra = shipped.filter((name) => name !== 'bin' && !onDisk.has(name));
  assert.deepEqual(extra, [], `the package lists files it does not have: ${extra.join(', ')}`);
});
