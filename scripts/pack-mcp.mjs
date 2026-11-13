// @last-edited: 2026-11-13 UTC+7.
// @title: pack-mcp - writes the shared modules into the package, so a published install carries them.
// @state: the generated copies under local/lib, and the package's prepack step that refreshes them.
// @dependencies: node:fs, node:path, node:module.

// WHY THE COPIES ARE GENERATED AND NOT HAND-WRITTEN.
// The package has to carry every module it imports, and a hand-written second copy would drift from the first.
// So each shared module stays in one file in this tree, the copy is written here, and .gitignore keeps the generated copy out of the repository.
// tidy.ts is TypeScript with types only on the surface, so it is stripped here, at build time, instead of being read at run time from a path the installed package does not have.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(repo, 'local', 'lib');

const FILES = [
  { from: path.join('extension', 'lib'), names: ['socket-protocol.js', 'endpoints.js'] },
  { from: path.join('supabase', 'functions', 'opera-agent-mcp'), names: ['tidy.ts'], strip: true, as: 'tidy.js' },
];

fs.mkdirSync(target, { recursive: true });
let written = 0;
for (const { from, names, strip, as } of FILES) {
  for (const name of names) {
    const raw = fs.readFileSync(path.join(repo, from, name), 'utf8');
    const out = strip ? stripTypeScriptTypes(raw) : raw;
    const outName = as ?? name;
    fs.writeFileSync(path.join(target, outName), out, 'utf8');
    written += 1;
  }
}

process.stderr.write(`pack-mcp: wrote ${written} shared modules into local/lib\n`);
