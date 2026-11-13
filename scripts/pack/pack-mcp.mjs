// @last-edited: 2026-11-13 UTC+7.
// @title: pack-mcp - writes the shared modules into the package, so a published install carries them.
// @state: the generated copies under local/lib, and the package's prepack step that refreshes them.
// @dependencies: node:fs, node:path, node:module.

// WHY THE COPIES ARE GENERATED AND NOT HAND-WRITTEN.
// The package has to carry every module it imports, and a hand-written second copy would drift from the first.
// So each shared module stays in one file in this tree - extension/lib/ for the protocol pair, shared/ for the pure core - the copy is written here, and .gitignore keeps local/lib/ out of the repository.
// One rule, one generator, one mode: byte copies, never a hand-edit, never a transform.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(repo, 'local', 'lib');

const FILES = [
  { from: path.join('extension', 'lib'), names: ['socket-protocol.js', 'endpoints.js'] },
  { from: path.join('shared'), names: ['bing-serp.js', 'tidy.js'] },
];

fs.mkdirSync(target, { recursive: true });
let written = 0;
for (const { from, names } of FILES) {
  for (const name of names) {
    const raw = fs.readFileSync(path.join(repo, from, name), 'utf8');
    fs.writeFileSync(path.join(target, name), raw, 'utf8');
    written += 1;
  }
}

process.stderr.write(`pack-mcp: wrote ${written} shared modules into local/lib\n`);
