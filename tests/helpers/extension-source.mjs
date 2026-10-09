// @last-edited: 2026-10-09 UTC+7.
// @title: extension-source — every source file the worker graph spans, in one string.
// @state: order is load-bearing — serialize before watch-registry, execute-pull last; both are asserted by extension-source.test.mjs.
// @dependencies: node:fs/promises.

import { readFile } from 'node:fs/promises';

const FILES = [
  'extension/background.js',
  'extension/lib/log.js',
  'extension/lib/serialize.js',
  'extension/worker/utils.js',
  'extension/worker/capture.js',
  'extension/worker/private-tabs.js',
  'extension/worker/tab-content.js',
];

export async function extensionSource() {
  const parts = await Promise.all(FILES.map(
    (rel) => readFile(new URL(`../../${rel}`, import.meta.url), 'utf8'),
  ));
  return parts.join('\n');
}

export function extensionSourceFiles() {
  return [...FILES];
}
