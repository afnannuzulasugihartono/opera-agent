// @last-edited: 2026-11-13 UTC+7.
// @title: architecture - the map must equal the tree, or this fails.
// @state: the gate for ARCHITECTURE.md; a new roof without an entry fails the build.
// @dependencies: node:test, strict, node:fs, node:path, node:url.

// WHY THIS GATE EXISTS.
// AGENTS.md binds the agent to ARCHITECTURE.md as the map it must follow before creating anything.
// A map that quietly disagrees with the tree is worse than no map: it trains the reader not to trust it.
// So the tree is read, the map is read, and they must agree — by name, by path, by import direction.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const arch = fs.readFileSync(path.join(repo, 'ARCHITECTURE.md'), 'utf8');

// FORMAT OF THE MAP UNDER TEST.
// - Backtick paths in tables and fences: `dir/foo.js` or `dir/` — the gate checks each exists.
// - The root table: every line starting with `| \`name/\`` or `| \`name\`` names a top-level entry that must exist.
// - Root enumeration: every top-level file/dir (minus a written exemption list) must appear in the map.

const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8');

const PATH_RE = /`([A-Za-z0-9_./-]+\/[A-Za-z0-9_./-]*\.(?:js|mjs|cjs|ts|py|json|yml|yaml|toml|md|html|css|sql|cmd|bat|lock))`/g;
const DIR_RE = /`([A-Za-z0-9_.-]+\/)`/g;

test('ARCHITECTURE.md names files that exist', () => {
  const missing = [];
  for (const match of arch.matchAll(PATH_RE)) {
    const p = match[1];
    if (!fs.existsSync(path.join(repo, p))) missing.push(p);
  }
  for (const match of arch.matchAll(DIR_RE)) {
    const p = match[1];
    if (!fs.existsSync(path.join(repo, p))) missing.push(p);
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('ARCHITECTURE.md names directories that exist, including every top-level entry it claims', () => {
  for (const match of arch.matchAll(DIR_RE)) {
    const p = match[1];
    if (!fs.existsSync(path.join(repo, p))) {
      assert.fail(`ARCHITECTURE.md names a missing path: ${p}`);
    }
  }
});

const EXEMPT = new Set([
  '.agents', '.superpowers', '.serena', '.ruff_cache', '.kilo',
  'node_modules', '.git', '.github',
]);

test('every top-level entry is named by ARCHITECTURE.md', () => {
  const entries = fs.readdirSync(repo, { withFileTypes: true })
    .filter((entry) => entry.name !== '.' && entry.name !== '..')
    .map((entry) => entry.name)
    .filter((name) => !EXEMPT.has(name) && !name.startsWith('.') && !/^(tmp|coverage|dist|build|out)$/.test(name));
  const unnamed = entries.filter((name) => !arch.includes(`\`${name}`));
  assert.deepEqual(unnamed, [], `these top-level entries are not named in ARCHITECTURE.md: ${unnamed.join(', ')}`);
});

// IMPORT MATRIX — specified in the root table of the map, enforced here.

const IMPORT_RULES = [
  { root: 'extension', allowedPrefixes: ['extension/'], reason: 'extension may only import extension' },
  { root: 'local', allowedPrefixes: ['local/'], reason: 'local may only import local' },
  { root: 'shared', allowedPrefixes: ['shared/'] , reason: 'shared must not reach outside' },
];

const IMPORT_RE = /(?:^|\n|['"])(?:import|export)\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g;

function importsOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec.startsWith('node:') || spec.startsWith('npm:') || spec.startsWith('jsr:') || spec.startsWith('https:')) continue;
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
    const base = path.posix.dirname(path.relative(repo, file).split(path.sep).join('/'));
    out.push(path.posix.normalize(path.posix.join(base, spec)));
  }
  return out;
}

for (const { root, allowedPrefixes, reason } of IMPORT_RULES) {
  test(`${reason}`, () => {
    const offenders = [];
    const dir = path.join(repo, root);
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!/\.(?:js|mjs|cjs|ts|tsx)$/.test(entry.name)) continue;
        for (const target of importsOf(p)) {
          if (target.startsWith(root + '/') || allowedPrefixes.some((prefix) => target.startsWith(prefix))) continue;
          offenders.push(`${path.relative(repo, p)} -> ${target}`);
        }
      }
    };
    walk(dir);
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });
}

test('every function package imports only hosted or shared', () => {
  const offenders = [];
  for (const entry of fs.readdirSync(path.join(repo, 'hosted', 'functions'), { withFileTypes: true })) {
    if (entry.name === '_shared') continue;
    const p = path.join(repo, 'hosted', 'functions', entry.name);
    if (!entry.isDirectory()) continue;
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, f.name);
        if (f.isDirectory()) { walk(full); continue; }
        if (!/\.(?:js|ts)$/.test(f.name)) continue;
        for (const target of importsOf(full)) {
          if (target.startsWith('hosted/') || target.startsWith('shared/') || target.startsWith('../_shared/') || target.startsWith('../../_shared/')) continue;
          if (target.startsWith('node:')) continue;
          offenders.push(`${path.relative(repo, full)} -> ${target}`);
        }
      }
    };
    walk(p);
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('shared modules import only within shared/', () => {
  const offenders = [];
  for (const f of fs.readdirSync(path.join(repo, 'shared'), { withFileTypes: true })) {
    if (!f.isFile() || !/\.(?:js|mjs|cjs|ts)$/.test(f.name)) continue;
    const full = path.join(repo, 'shared', f.name);
    for (const target of importsOf(full)) {
      if (target.startsWith('shared/')) continue;
      offenders.push(`shared/${f.name} -> ${target}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});
