// @last-edited: 2026-11-14 UTC+7.
// @title: pack-mcp - writes the extension protocol pair into the package, so a published install carries them.
// @state: the generated copies under local/lib, and the package's prepack step that refreshes them.
// @dependencies: node:fs, node:path, node:module.

// WHY THE COPIES ARE GENERATED AND NOT HAND-WRITTEN.
// The package has to carry every module it imports, and a hand-written second copy would drift from the first.
// So the protocol pair stays in one file in this tree — extension/lib/ — the copy is written here, and .gitignore keeps local/lib/ out of the repository.
// The former vendored core (bing-serp, tidy) moved into local/ as source; nothing else comes from shared/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(repo, 'local', 'lib');

const FILES = [
  { from: path.join('extension', 'lib'), names: ['socket-protocol.js', 'endpoints.js'] },
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

process.stderr.write(`pack-mcp: wrote ${written} modules into local/lib\n`);
