// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: keyboard-vocabulary-parity.test — vocabulary-parity.test — Keyboard vocabulary parity.
// @state: drop the milestone prefix from the interaction test family.
// @dependencies: node:test, strict, promises, keyboard.

// The public MCP surface and the extension runtime keep two copies of the key
// and modifier vocabularies. That duplication is architecturally forced — the
// MCP is a Deno edge function and the runtime is a browser bundle, and neither
// can import the other — but it can still DRIFT, and a drifted public schema
// would reject calls the runtime happily accepts, or advertise keys that do not
// resolve.
//
// The existing surface test pinned the expected list as a literal, so it
// detected a CHANGE but never proved AGREEMENT with the implementation. This
// test closes that gap: the public schema is checked against the real resolver
// exports, so adding a key to lib/keyboard.js without adding it to the public
// schema fails here.

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
} from '../extension/lib/keyboard.js';

const mcp = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');

function enumMembers(name) {
  const body = mcp.match(new RegExp(`const ${name} = z\\.enum\\(\\[([\\s\\S]*?)\\]\\)`))?.[1];
  assert.ok(body, `${name} must be a declared enum`);
  const members = [];
  for (const entry of body.split(',')) {
    const trimmed = entry.trim();
    if (trimmed.startsWith('"')) {
      members.push(trimmed.replace(/^"|"$/g, ''));
    } else {

      const source = trimmed.replace(/^\.\.\./, '');
      const literal = mcp.match(new RegExp(`const ${source} = "([^"]*)"`))?.[1];
      assert.ok(literal !== undefined, `${source} must be a declared string literal`);
      members.push(...literal.split(''));
    }
  }
  return members;
}

test('the public key enum is exactly the runtime allowlist', () => {
  const declared = enumMembers('navigationKeySchema');
  assert.deepEqual(
    [...declared].sort(),
    [...KEY_ALLOWLIST].sort(),
    'the public key enum and the runtime key allowlist must be the same set'
  );

  assert.equal(new Set(declared).size, declared.length, 'the public enum must not contain duplicates');
  assert.equal(new Set(KEY_ALLOWLIST).size, KEY_ALLOWLIST.length, 'the runtime allowlist must not contain duplicates');
});

test('the public modifier enum is exactly the runtime alias set', () => {
  const declared = enumMembers('modifierSchema');
  const runtime = Object.keys(MODIFIER_ALIASES);
  assert.deepEqual([...declared].sort(), [...runtime].sort());
  assert.equal(new Set(declared).size, declared.length, 'the public enum must not contain duplicates');

  const canonical = new Set(Object.values(MODIFIER_ALIASES));
  for (const alias of Object.keys(MODIFIER_ALIASES)) {
    assert.ok(canonical.has(MODIFIER_ALIASES[alias]), `${alias} must map to a canonical modifier`);
  }

  assert.equal(canonical.size, 4);
});

test('the public text bound matches the runtime bound, on both entry points', () => {
  assert.equal(MAX_TEXT_CHARS, 20000);

  const pressKey = mcp.slice(mcp.indexOf('server.registerTool("press_key"'));
  assert.match(pressKey.slice(0, 1500), new RegExp(`text: z\\.string\\(\\)\\.min\\(1\\)\\.max\\(${MAX_TEXT_CHARS}\\)`));

  const burstKeyStep = mcp.match(/z\.object\(\{\s*action: z\.literal\("key"\)[\s\S]*?\}\)\.strict\(\)/)?.[0];
  assert.ok(burstKeyStep, 'the burst key step must be declared publicly');
  assert.match(burstKeyStep, new RegExp(`text: z\\.string\\(\\)\\.min\\(1\\)\\.max\\(${MAX_TEXT_CHARS}\\)`));
});

test('the runtime text chunking is documented by the constant it uses', async () => {

  const keyboard = await readFile(new URL('../extension/lib/keyboard.js', import.meta.url), 'utf8');
  assert.match(keyboard, new RegExp(`export const TEXT_CHUNK_CHARS = ${TEXT_CHUNK_CHARS};`));
  assert.match(keyboard, new RegExp(`size = TEXT_CHUNK_CHARS`));
  assert.ok(TEXT_CHUNK_CHARS < MAX_TEXT_CHARS, 'a single entry must be split into more than one chunk');
});

test('the public surface does not promise a key the runtime would reject', () => {

  for (const key of enumMembers('navigationKeySchema')) {
    assert.doesNotThrow(() => resolveChord(key), `public key ${key} must resolve at runtime`);
  }

  for (const modifier of enumMembers('modifierSchema')) {
    assert.doesNotThrow(() => resolveModifiers([modifier]), `public modifier ${modifier} must resolve`);
  }
});
