// @last-edited: 2026-11-14 UTC+7.
// @title: classic-scripts - the files MV3 loads as classic scripts parse as classic scripts.
// @state: every content_scripts entry and the two files the worker injects with chrome.scripting.executeScript carry no import, export or module marker; one that does is a SyntaxError in every tab it is injected into.
// @dependencies: node:test, node:assert/strict, node:fs, node:vm, extension/manifest.json.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// WHY THIS GATE EXISTS.
// The repo is a "type": "module" package and tsc compiles every source as a module, so the emitted classic scripts can carry a top-level `export {};` if the build did not strip it.
// A classic content script with any module syntax fails in every page the extension needs to read, and the failure carries no useful error in the console — the script simply never runs.

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root), 'utf8'));
const INJECTED = ['lib/statement-file.js', 'content/record-main.js'];

test('every file MV3 loads as a classic script parses as one', () => {
  const files = [...manifest.content_scripts.flatMap((entry) => entry.js), ...INJECTED];
  assert.ok(files.length >= 2, 'the manifest must name its content scripts');
  for (const rel of files) {
    const source = fs.readFileSync(new URL(`extension/${rel}`, root), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: rel }),
      `${rel} is named as a classic script by the manifest or the worker, and must parse as one`);
  }
});
