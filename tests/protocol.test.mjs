// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: protocol.test — Test.
// @state: lock the page.fill value rule on the real site and in the protocol test.
// @dependencies: node:test, strict, protocol.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_METHODS, EXECUTION_MODES, METHOD_SPECS, validateCommand, validateBurst, safeUrl, normalizeError, PRODUCT_VERSION, PROTOCOL_VERSION } from '../extension/lib/protocol.js';

test('version and protocol are stable', () => {
  assert.equal(PRODUCT_VERSION, '1.6.17');
  assert.equal(PROTOCOL_VERSION, 1);
});

test('method allowlist contains only named primitives', () => {
  assert.ok(ALLOWED_METHODS.length >= 20);
  assert.ok(ALLOWED_METHODS.includes('page.read'));
  assert.ok(ALLOWED_METHODS.includes('page.click'));
  assert.ok(ALLOWED_METHODS.includes('page.pointer'));
  assert.ok(ALLOWED_METHODS.includes('page.capture'));
  assert.ok(ALLOWED_METHODS.includes('browser.burst'));
  assert.ok(ALLOWED_METHODS.includes('media.seek'));
  assert.equal(ALLOWED_METHODS.some((x) => x.includes('youtube')), false);
  for (const [method, spec] of Object.entries(METHOD_SPECS)) {
    assert.match(method, /^[a-z]+\.[a-z_]+$/);
    assert.ok(spec.timeoutMs >= 500 && spec.timeoutMs <= 55000);
  }
});

test('bounded browser burst accepts only linear page actions', () => {
  assert.equal(validateBurst({ steps: [{ action: 'fill', ref: 'oa-1', value: 'query' }, { action: 'key', key: 'Enter' }] }).ok, true);
  assert.equal(validateBurst({ executionMode: 'background', steps: [{ action: 'read' }] }).ok, true);
  assert.equal(validateBurst({ executionMode: 'foreground', steps: [{ action: 'pointer', pointerAction: 'click', x: 1, y: 2 }] }).ok, true);
  assert.equal(validateBurst({ executionMode: 'auto', steps: [{ action: 'read' }] }).ok, false);
  assert.equal(validateBurst({ steps: [] }).ok, false);
  assert.equal(validateBurst({ steps: Array.from({ length: 9 }, () => ({ action: 'read' })) }).ok, false);

  // Phase D: a step may now name its own tab. This line previously
  // asserted the opposite and was the same-tab guarantee at the schema layer;
  // it is superseded by the per-step tabId, which stays optional so a step
  // without one still resolves to the burst tab.
  assert.equal(validateBurst({ steps: [{ action: 'click', ref: 'oa-1', tabId: 9 }] }).ok, true);

  // Still strict: a malformed tab is rejected, and the burst-level tabId is
  // still required to be a non-negative integer.
  assert.equal(validateBurst({ steps: [{ action: 'click', ref: 'oa-1', tabId: -1 }] }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'read' }], tabId: -1 }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'read' }], output: { arbitrary: true } }).ok, false);

  // navigate joined the burst vocabulary (maps to tabs.navigate; the http/https
  // gate stays at dispatch). Bare navigate still fails closed on the missing URL.
  assert.equal(validateBurst({ steps: [{ action: 'navigate' }] }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'navigate', url: 'https://example.com' }] }).ok, true);
  assert.equal(validateBurst({ steps: [{ action: 'pointer', pointerAction: 'drag', x: 1, y: 2 }] }).ok, false);
  const command = validateCommand({ id: 'burst-123', method: 'browser.burst', params: { steps: [{ action: 'read' }] }, timeoutMs: 30000 });
  assert.equal(command.ok, true);
  assert.equal(command.command.timeoutMs, 12000);
});

test('command validation rejects unknown methods and malformed params', () => {
  assert.equal(validateCommand(null).ok, false);
  assert.equal(validateCommand({ id: '12345678', method: 'youtube.magic', params: {} }).ok, false);
  assert.equal(validateCommand({ id: '12345678', method: 'page.read', params: [] }).ok, false);
  const ok = validateCommand({ id: 'abcdefgh', method: 'page.read', params: { limit: 6000 }, timeoutMs: 999999 });
  assert.equal(ok.ok, true);
  assert.equal(ok.command.timeoutMs, 55000);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.pointer', params: { action: 'drag', x: 5, y: 6 } }).ok, false);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.pointer', params: { action: 'drag', x: 5, y: 6, endX: 7, endY: 8 } }).ok, true);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.pointer', params: { action: 'click', x: 5, y: 6, executionMode: 'auto' } }).ok, false);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.capture', params: { tabId: 1, quality: 60, maxWidth: 1280, maxHeight: 900 } }).ok, true);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.capture', params: { tabId: 1, crop: { x: 0, y: 0, width: 320, height: 240 }, previousHash: 'a'.repeat(64) } }).ok, true);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.capture', params: { quality: 90 } }).ok, false);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.capture', params: { crop: { x: 0, y: 0, width: -1, height: 2 } } }).ok, false);

  // A fill with no value used to be dispatched as an empty string, which pressed
  // Backspace in the field and still answered ok:true. Found by misspelling the
  // parameter in the live suite. An explicit "" stays legal: clearing is an intent.
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.fill', params: { ref: 'oa_1_1', text: 'typo' } }).ok, false);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.fill', params: { ref: 'oa_1_1' } }).ok, false);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.fill', params: { ref: 'oa_1_1', value: null } }).ok, false);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.fill', params: { ref: 'oa_1_1', value: '' } }).ok, true);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.fill', params: { ref: 'oa_1_1', value: 'kucing' } }).ok, true);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.fill', params: { ref: 'oa_1_1', value: 'x'.repeat(20001) } }).ok, false);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.capture', params: { previousHash: 'not-a-hash' } }).ok, false);
  assert.equal(validateCommand({ id: 'abcdefgh', method: 'page.capture', params: { fullPage: true } }).ok, false);
});

test('execution modes are explicit and structured foreground errors survive normalization', () => {
  assert.deepEqual(EXECUTION_MODES, ['background', 'foreground']);
  const error = new Error('Foreground permission is required.');
  error.code = 'FOREGROUND_REQUIRED';
  error.details = { targetTabId: 42, requiredExecutionMode: 'foreground' };
  assert.deepEqual(normalizeError(error), {
    code: 'FOREGROUND_REQUIRED',
    message: 'Foreground permission is required.',
    details: { targetTabId: 42, requiredExecutionMode: 'foreground' }
  });
});

test('safeUrl accepts only http/https', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('file:///tmp/x'), null);
  assert.match(safeUrl('https://example.com/a'), /^https:\/\/example\.com/);
});
