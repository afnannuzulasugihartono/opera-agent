// @last-edited: 2026-10-29 UTC+7.
// @title: content-source — every content script the manifest loads, in load order, in one string.
// @state: the manifest is the source of truth, so this helper reads it instead of repeating it.
// @dependencies: node:fs.

import { readFileSync } from 'node:fs';

// WHY THE MANIFEST AND NOT A LIST HERE.
// A second list is a list that drifts: the injection order is already written twice in the tree (manifest and worker/tab-content.js), and a third copy in the tests would be a third thing to keep true.
// Reading the manifest makes the helper follow whatever the product actually loads.

// WHY IT IS READ SYNCHRONOUSLY.
// The seventeen call sites that used to read content.js sit in two shapes: some at module scope, some inside an async test.
// A sync read makes every one of them a single-line swap, whatever scope it sits in; an async helper would force a before() hook into the files that declare at the top, and that is a structural change the move does not need.

export function contentSource() {
  const manifest = JSON.parse(
    readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8')
  );
  return manifest.content_scripts
    .flatMap((entry) => entry.js ?? [])
    .map((rel) => readFileSync(new URL(`../../extension/${rel}`, import.meta.url), 'utf8'))
    .join('\n');
}
