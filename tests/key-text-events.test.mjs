// @last-edited: 2026-10-14 UTC+7.
// @title: key-text-events.test — editor text travels as key events, not IME inserts.
// @state: locks the per-character mapping, the newline shape, and the burst flag.
// @dependencies: node:test, strict, ../extension/lib/keyboard.js, ../extension/lib/protocol.js.

// WHY key events for editor text. Input.insertText emulates an IME insert with
// no key events, and editors that key their commit pipeline off key-event
// sequences (Docs canvas included) drop it silently: executed-ok, nothing
// painted. One keyDown carrying text plus keyUp per character is what such
// editors commit. Native inputs keep insertText; the flag opts in per call.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTextKeys } from '../extension/lib/keyboard.js';
import { BURST_STEP_KEYS } from '../extension/lib/protocol.js';

test('lowercase, upper, digit, and space map to US key events', () => {
  const [a, bigA, one, space] = resolveTextKeys('aA1 ');

  assert.deepEqual(a, { key: 'a', code: 'KeyA', vk: 65, shift: false, text: 'a' });
  assert.deepEqual(bigA, { key: 'A', code: 'KeyA', vk: 65, shift: true, text: 'A' });
  assert.deepEqual(one, { key: '1', code: 'Digit1', vk: 49, shift: false, text: '1' });
  assert.deepEqual(space, { key: ' ', code: 'Space', vk: 32, shift: false, text: ' ' });
});

test('punctuation maps with its shift state', () => {
  const [period, comma, bang, colon] = resolveTextKeys('.,!:');

  assert.equal(period.shift, false);
  assert.equal(comma.code, 'Comma');
  assert.deepEqual([bang.key, bang.shift], ['!', true]);
  assert.deepEqual([colon.key, colon.shift], [':', true]);
});

test('a newline becomes Enter carrying carriage return', () => {
  const [enter] = resolveTextKeys('\n');

  assert.deepEqual(enter, { key: 'Enter', code: 'Enter', vk: 13, shift: false, text: '\r' });
});

test('unmapped characters fail naming the code point', () => {
  assert.throws(() => resolveTextKeys('caf\u00e9'), /U\+00E9/);
  assert.throws(() => resolveTextKeys('\u4e2d'), /U\+4E2D/);
});

test('text beyond the shared bound is rejected', () => {
  assert.throws(() => resolveTextKeys('x'.repeat(20001)), /at most 20000/);
});

test('burst key steps allow the keyEvents flag', () => {
  assert.ok(BURST_STEP_KEYS.key.includes('keyEvents'), 'key steps carry keyEvents');
});
