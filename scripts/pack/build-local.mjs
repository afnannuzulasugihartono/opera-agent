// @last-edited: 2026-11-13 UTC+7.
// @title: build-local - compiles the npm product both roads ship from this tree.
// @state: cleans every emitted .js under local/, then compiles the .ts sources; a removed source leaves no artefact.
// local/lib is deliberate: the pack-mcp program owns it, compiles nothing into it, and the clean never touches it.
// @dependencies: node:fs, node:path, node:child_process, node:url.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(repo, 'local');

if (!fs.existsSync(path.join(repo, 'node_modules', 'typescript'))) {
  console.error('build-local: typescript is not installed; run npm ci first.');
  process.exit(1);
}

// WHY THE CLEAN RUNS FIRST, AND WHY IT REFUSES.
// tsc writes beside the sources, so a file deleted from the source tree would keep its old emitted twin forever, and a stale twin is a module the tests can still import and pass with.
// The clean therefore removes every emitted twin under local/ except the lockstep-copied module copies under local/lib (owned by pack-mcp), and refuses to remove a .js that has no .ts source beside it, because that file is either a hand-written second copy (the drift this whole design removes) or a stale artefact whose source is gone, and both must stop the build rather than be deleted quietly.

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const removed = [];
const refused = [];
const sourceCount = (() => {
  let n = 0;
  for (const file of walk(target)) if (file.endsWith('.ts')) n += 1;
  return n;
})();

if (sourceCount === 0) {
  console.error('build-local: refusing to compile - local/ carries no .ts sources yet; the folder converts fully or not at all.');
  process.exit(1);
}

for (const file of walk(target)) {
  if (!file.endsWith('.js')) continue;
  const relative = path.relative(target, file).split(path.sep).join('/');
  if (relative.startsWith('lib/')) continue;
  const hasSource = fs.existsSync(file.replace(/\.js$/, '.ts'));
  if (hasSource) { fs.rmSync(file); removed.push(relative); }
  else refused.push(relative);
}

if (refused.length) {
  console.error(`build-local: refusing to compile - these .js files have no .ts source beside them:\n  ${refused.join('\n  ')}`);
  process.exit(1);
}

execFileSync(process.execPath, [path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(repo, 'tsconfig.local.json')], { cwd: repo, stdio: 'inherit' });
process.stderr.write('build-local: compiled local/ into bespoke .js beside each source\n');
