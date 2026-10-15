// @last-edited: 2026-10-15 UTC+7.
// @title: local-package - the npm package has to carry every module the bin imports.
// @state: one lock; the file list is read from the import graph, not from memory.
// @dependencies: node:test, strict, ../local/package.json.

// WHY THIS FILE EXISTS. The package published seven modules and imported sixteen: the
// `files` list had never been touched since the first modules, so `npx opera-local`
// would have installed a package that dies on its first import with ERR_MODULE_NOT_FOUND.
// A release that ships that is worse than no release, because the error names a file
// the user never heard of. So the list is derived from the imports and compared here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const local = resolve(here, '..', 'local');
const shipped = JSON.parse(readFileSync(join(local, 'package.json'), 'utf8')).files;

const IMPORT = /from '\.{1,2}\/([a-z-]+(?:\/[a-z-]+)?)\.js'/g;

const reachable = (entry) => {
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const source = readFileSync(join(local, `${name}.js`), 'utf8');
    for (const [, next] of source.matchAll(IMPORT)) walk(next);
  };
  walk(entry);
  return seen;
};

// WHY THE ENTRY POINT IS EXEMPT FROM THE MODULE LIST. npm ships a bin through the
// `bin` directory, not as a module anyone imports, so the entry point is covered by
// that name and every module below it is checked as a module.

test('every module the bin can reach is inside the published files', () => {
  const needed = [...reachable('bin/opera-local'), ...reachable('mcp-server')].map((name) => `${name}.js`);

  const missing = needed.filter((name) => !shipped.includes(name) && !(name === 'bin/opera-local.js' && shipped.includes('bin')));
  assert.deepEqual(missing, [], `npx opera-local would install a package that dies on import: ${missing.join(', ')}`);
});

test('the list names nothing the package does not have', () => {
  const onDisk = readdirSync(local).filter((name) => name.endsWith('.js'));

  const extra = shipped.filter((name) => name !== 'bin' && !onDisk.includes(name));
  assert.deepEqual(extra, [], `the package lists files it does not have: ${extra.join(', ')}`);
});
