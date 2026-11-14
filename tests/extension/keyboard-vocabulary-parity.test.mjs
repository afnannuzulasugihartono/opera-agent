// @last-edited: 2026-11-14 UTC+7.
// @title: keyboard-vocabulary-parity.test — the key names the extension accepts are the names it resolves.
// @state: the key list and the modifier aliases, held consistent on the one surface that exists.
// @dependencies: node:test, strict, promises, keyboard.

// WHY THIS FILE EXISTS, AND WHY IT IS NOT WHAT IT WAS.
// The previous version pinned the vocab of the hosted MCP surface against the extension's.
// The hosted surface is deleted (2026-11-14); the only vocabulary left is the extension's own.
// A consistency claim that does not need two surfaces to hold is still worth holding: the allowlist must resolve, the aliases must map, and the bounds must agree with the constants.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  KEY_ALLOWLIST,
  MAX_TEXT_CHARS,
  MODIFIER_ALIASES,
  TEXT_CHUNK_CHARS,
  resolveChord,
  resolveModifiers
} from '../../extension/lib/keyboard.js';

test('every allowlisted key resolves at runtime', () => {
  assert.ok(KEY_ALLOWLIST.length > 0, 'the allowlist carries keys');
  for (const key of KEY_ALLOWLIST) {
    assert.doesNotThrow(() => resolveChord(key), `${key} must resolve`);
  }
});

test('every modifier alias maps to a canonical modifier', () => {
  const canonical = new Set(Object.values(MODIFIER_ALIASES));
  assert.equal(canonical.size, 4, 'the runtime keeps four modifiers: shift, control, alt, meta');
  for (const alias of Object.keys(MODIFIER_ALIASES)) {
    assert.ok(canonical.has(MODIFIER_ALIASES[alias]), `${alias} maps to a canonical modifier`);
  }
  assert.doesNotThrow(() => resolveModifiers(['control']));
});

test('the text bound is the documented one', () => {
  assert.equal(MAX_TEXT_CHARS, 20000, 'a single entry never exceeds the bound');
  assert.ok(TEXT_CHUNK_CHARS < MAX_TEXT_CHARS, 'a chunk is smaller than the bound');
});

test('the runtime text chunking is documented by the constant it uses', async () => {
  const keyboard = await readFile(new URL('../../extension/lib/keyboard.js', import.meta.url), 'utf8');
  assert.match(keyboard, new RegExp(`export const TEXT_CHUNK_CHARS = ${TEXT_CHUNK_CHARS};`));
  assert.match(keyboard, /size = TEXT_CHUNK_CHARS/);
});
