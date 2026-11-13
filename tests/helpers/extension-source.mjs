// @last-edited: 2026-10-13 UTC+7.
// @title: extension-source — every source file the worker graph spans, in one string.
// @state: order is load-bearing — serialize before watch-registry, execute-pull last; both are asserted by extension-source.test.mjs.
// @dependencies: node:fs/promises.

import { readFile } from 'node:fs/promises';

const FILES = [
  'extension/background.ts',
  'extension/lib/log.ts',
  'extension/lib/serialize.ts',
  'extension/worker/watch-registry.ts',
  'extension/worker/utils.ts',
  'extension/worker/capture.ts',
  'extension/worker/private-tabs.ts',
  'extension/worker/tab-content.ts',
  'extension/worker/listen.ts',
  'extension/worker/capture-page.ts',
  'extension/worker/action-focus.ts',
  'extension/worker/burst.ts',
  'extension/worker/execute-pull.ts',
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
