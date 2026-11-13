// @last-edited: 2026-11-13 UTC+7.
// @title: build-shared - compiles the one pure core both roads import.
// @state: cleans every emitted .js under shared/, then compiles the .ts sources; a removed source leaves no artefact.
// @dependencies: node:fs, node:path, node:module.

// @dependencies: node:fs, node:path, node:child_process, node:url.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(repo, 'shared');

if (!fs.existsSync(path.join(repo, 'node_modules', 'typescript'))) {
  console.error('build-shared: typescript is not installed; run npm ci first.');
  process.exit(1);
}

// WHY THE CLEAN RUNS FIRST, AND WHY IT REFUSES.
// tsc writes beside the sources, so a file deleted from the source tree would keep its old emitted twin forever, and a stale twin is a module the tests can still import and pass with.
// The clean therefore removes every emitted twin - and refuses to remove a .js that has no .ts source beside it, because that file is either a hand-written second copy (the drift this whole design removes) or a stale artefact whose source is gone, and both must stop the build rather than be deleted quietly.

const removed = [];
const refused = [];
for (const entry of fs.readdirSync(target)) {
  if (!entry.endsWith('.js')) continue;
  const hasSource = fs.existsSync(path.join(target, entry.replace(/\.js$/, '.ts')));
  if (hasSource) { fs.rmSync(path.join(target, entry)); removed.push(entry); }
  else refused.push(entry);
}

if (refused.length) {
  console.error(`build-shared: refusing to compile - these .js files have no .ts source beside them:\n  ${refused.join('\n  ')}`);
  process.exit(1);
}

execFileSync(process.execPath, [path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(repo, 'tsconfig.shared.json')], { cwd: repo, stdio: 'inherit' });
process.stderr.write('build-shared: compiled shared/ into bespoke .js beside each source\n');
