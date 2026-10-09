// @last-edited: 2026-10-09 UTC+7.
// @title: boundary-locks — every frozen hash is checked, not just the public surface.
// @state: pins the three lock arrays exported by helpers/boundary-locks.mjs; a stale hash fails here instead of drifting silently.
// @dependencies: node:test, strict, node:crypto, promises, helpers/boundary-locks.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  PUBLIC_SURFACE_LOCKS,
  OBSERVATION_STACK_LOCKS,
  RELEVANCE_STACK_LOCKS,
} from './helpers/boundary-locks.mjs';

function sha1Blob(bytes) {
  // git blob hash of the committed LF bytes; strip checkout-added CR so
  // autocrlf checkouts hash identically to CI.
  const content = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1').update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
}

for (const [label, locks] of [
  ['public surface', PUBLIC_SURFACE_LOCKS],
  ['observation stack', OBSERVATION_STACK_LOCKS],
  ['relevance stack', RELEVANCE_STACK_LOCKS],
]) {
  test(`${label} pins stay byte-for-byte unchanged`, async () => {
    for (const [relativePath, expected] of new Map(locks)) {
      const bytes = await readFile(new URL(relativePath, import.meta.url));
      assert.equal(sha1Blob(bytes), expected, `${relativePath} must remain byte-for-byte unchanged`);
    }
  });
}
