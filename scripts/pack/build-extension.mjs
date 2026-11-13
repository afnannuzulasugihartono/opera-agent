// @last-edited: 2026-11-13 UTC+7.
// @title: build-extension - compiles the browser half into the ESM modules MV3 loads.
// @state: cleans every emitted .js under extension/, then compiles the .ts sources; a removed source leaves no artefact.
// extension/icons, extension/_locales and extension/css (if present) carry assets, not code, and hold no .ts sources; the clean never touches them.
// @dependencies: node:fs, node:path, node:child_process, node:url.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(repo, 'extension');

if (!fs.existsSync(path.join(repo, 'node_modules', 'typescript'))) {
  console.error('build-extension: typescript is not installed; run npm ci first.');
  process.exit(1);
}

// WHY THE CLEAN RUNS FIRST, AND WHY IT REFUSES.
// tsc writes beside the sources, so a file deleted from the source tree would keep its old emitted twin forever, and a stale twin is a module the browser would load instead of the source.
// The clean therefore removes every .js file under extension/ that carries no .ts source beside it (an artefact of the build, never the source), and refuses to remove a .js that has no .ts source beside it, because that file is either a hand-written second copy (the drift this whole design removes) or a stale artefact whose source is gone, and both must stop the build rather than be deleted quietly.

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
  console.error('build-extension: refusing to compile - extension/ carries no .ts sources yet; the folder converts fully or not at all.');
  process.exit(1);
}

for (const file of walk(target)) {
  if (!file.endsWith('.js')) continue;
  const hasSource = fs.existsSync(file.replace(/\.js$/, '.ts'));
  if (hasSource) { fs.rmSync(file); removed.push(path.relative(target, file).split(path.sep).join('/')); }
  else refused.push(path.relative(target, file).split(path.sep).join('/'));
}

if (refused.length) {
  console.error(`build-extension: refusing to compile - these .js files have no .ts source beside them:\n  ${refused.join('\n  ')}`);
  process.exit(1);
}

execFileSync(process.execPath, [path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(repo, 'tsconfig.extension.json')], { cwd: repo, stdio: 'inherit' });

// WHY THE STRIP RUNS LAST, AND WHY IT READS THE MANIFEST.
// The repo is a "type": "module" package, so tsc compiles every source as an ES module and appends a bare `export {};` to a module with nothing to export.
// The service worker loads as a module and keeps it; the content_scripts and the files the worker injects with chrome.scripting.executeScript load as CLASSIC scripts, and a classic script with a top-level `export` is a SyntaxError at parse time - the whole content half would be dead in every tab it is injected into.
// The strip list is the manifest's own content_scripts js list plus the two files the worker injects by name; tests/extension/classic-scripts.test.mjs holds the same set parseable as classic scripts.

const CLASSIC_EXTRAS = ['lib/statement-file.js', 'content/record-main.js'];
const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
const classicScripts = [...CLASSIC_EXTRAS];
for (const entry of manifest.content_scripts ?? []) {
  for (const js of entry.js ?? []) classicScripts.push(js);
}
for (const rel of classicScripts) {
  const file = path.join(target, rel);
  if (!fs.existsSync(file)) {
    console.error(`build-extension: refusing to finish - the classic script ${rel} is named by the manifest but is missing from the emit`);
    process.exit(1);
  }
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const withoutMarker = text.replace(/\nexport \{\};\s*$/, '\n');
  if (withoutMarker !== text) fs.writeFileSync(file, withoutMarker, 'utf8');
}

process.stderr.write('build-extension: compiled extension/ into bespoke .js beside each source\n');
