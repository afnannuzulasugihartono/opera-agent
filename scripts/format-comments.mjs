// @last-edited: 2026-10-21 UTC+7.
// @title: format-comments — apply the structural comment rule to the tree, and report the files that are not in it.
// @state: `--write` rewrites every source file to the canonical form, and `--check` exits non-zero when any file is not canonical.
// @dependencies: node:fs/promises, node:path, node:url, tests/helpers/comment-format.mjs.

// WHY THIS PROGRAM EXISTS.
// The rule is a formatter, so the gate is an equality: format(file) === file.
// That is checkable by anyone, and a file the formatter cannot read is a file it does not touch.
// The list of files it reads is written down here, once, and the hygiene gate calls this program rather than walking the tree a second way.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatComments } from '../tests/helpers/comment-format.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.sql', '.css', '.html', '.htm', '.py',
  '.yml', '.yaml', '.toml', '.example', '.cmd', '.bat',
]);

const NAMES = new Set([
  '.gitignore', '.gitattributes', '.dockerignore', '.npmignore',
  '.assetsignore', '.vercelignore', 'CODEOWNERS', 'Dockerfile', 'Makefile',
]);

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.kilo', 'dist', 'build', 'tmp', 'coverage',
  '.next', '.vercel', '__pycache__', '.temp',
]);

// WHY landing/_headers IS NOT HERE.
// Cloudflare parses that file block by block, and a blank line inside a rule block is the host's business, not ours.
// Its comments are written in the canonical shape by hand, and the file stays out of the formatter's reach.

const SKIP_FILES = new Set(['LICENSE', 'landing/_headers']);

async function walk(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(dir, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

function shouldFormat(file) {
  if (SKIP_FILES.has(file) || file.startsWith('supabase/.temp/')) return false;
  const ext = path.extname(file).toLowerCase();
  if (ext) return EXTENSIONS.has(ext);
  return NAMES.has(path.basename(file));
}

async function targets() {
  const files = (await walk(root)).filter(shouldFormat).sort();
  return files.map((file) => ({ file, ext: path.extname(file).toLowerCase() }));
}

async function apply(write) {
  const files = await targets();
  const changed = [];
  for (const { file, ext } of files) {
    const text = await readFile(path.join(root, file), 'utf8');
    const next = formatComments(text, ext);
    if (next === text) continue;
    changed.push(file);
    if (write) await writeFile(path.join(root, file), next);
  }
  return { total: files.length, changed };
}

// WHY THIS IS EXPOSED.
// The hygiene gate asserts the equality over the whole tree, and it must walk the same files this program walks.

export async function checkFormat() {
  return apply(false);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  const { total, changed } = await apply(write);

  if (changed.length === 0) {
    console.log(`comment format ok: ${total} files`);
    process.exit(0);
  }

  if (write) {
    console.log(`comment format wrote ${changed.length} of ${total} files`);
    process.exit(0);
  }

  console.error(`comment format: ${changed.length} of ${total} files are not canonical`);
  for (const file of changed.slice(0, 40)) console.error(`  ${file}`);
  if (changed.length > 40) console.error(`  ... and ${changed.length - 40} more`);
  console.error('run: node scripts/format-comments.mjs --write');
  process.exit(1);
}
