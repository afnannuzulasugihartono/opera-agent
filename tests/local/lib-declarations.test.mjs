// @last-edited: 2026-11-13 UTC+7.
// @title: lib-declarations - the .d.ts stubs for the generated copies match the copies' exports, or the suite says so.
// @state: every name the library copies export is named in its declaration file; nothing claims a name that is not there.
// @dependencies: node:test, assert, fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = path.join(root, 'local', 'lib');

const exportNames = (text) => [...text.matchAll(/^export (?:async function|function|const|class) (\w+)/gm)].map((match) => match[1]);

for (const spec of [
  { js: 'endpoints.js', def: 'endpoints.d.ts' },
  { js: 'socket-protocol.js', def: 'socket-protocol.d.ts' },
]) {
  test(`${spec.def} declares every export ${spec.js} has`, () => {
    const js = readFileSync(path.join(dir, spec.js), 'utf8');
    const def = readFileSync(path.join(dir, spec.def), 'utf8');
    for (const name of exportNames(js)) {
      assert.match(def, new RegExp(`\\b${name}\\b`), `${spec.def} does not declare ${name}`);
    }
    for (const name of exportNames(def)) {
      assert.ok(exportNames(js).includes(name), `${spec.def} declares ${name}, which ${spec.js} does not export`);
    }
  });
}
