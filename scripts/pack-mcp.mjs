// @last-edited: 2026-11-08 UTC+7.
// @title: pack-mcp - writes the two shared modules into the package, so a published install carries them.
// @state: the generated copies under local/lib, and the package's prepack step that refreshes them.
// @dependencies: node:fs, node:path.

// WHY THE COPIES ARE GENERATED AND NOT HAND-WRITTEN.
// The package has to carry every module it imports, and the extension has to keep its own copy, because a Chrome extension cannot read a file outside its folder.
// A hand-written second copy would drift from the first, and a drifted copy is a bug nobody sees until an install breaks.
// So the source stays in extension/lib, the copy is written here, and a test says the two are the same file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(repo, 'local', 'lib');

const SHARED = ['socket-protocol.js', 'endpoints.js'];

fs.mkdirSync(target, { recursive: true });
for (const name of SHARED) {
  const source = fs.readFileSync(path.join(repo, 'extension', 'lib', name), 'utf8');
  fs.writeFileSync(path.join(target, name), source, 'utf8');
}

process.stderr.write(`pack-mcp: wrote ${SHARED.length} shared modules into local/lib\n`);
