import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_METHODS, METHOD_SPECS, validateCommand, validateBurst, safeUrl, PRODUCT_VERSION, PROTOCOL_VERSION } from '../extension/lib/protocol.js';

test('version and protocol are stable', () => {
  assert.equal(PRODUCT_VERSION, '1.2.0');
  assert.equal(PROTOCOL_VERSION, 1);
});

test('method allowlist contains only named primitives', () => {
  assert.ok(ALLOWED_METHODS.length >= 20);
  assert.ok(ALLOWED_METHODS.includes('page.read'));
  assert.ok(ALLOWED_METHODS.includes('page.click'));
  assert.ok(ALLOWED_METHODS.includes('page.pointer'));
  assert.ok(ALLOWED_METHODS.includes('browser.burst'));
  assert.ok(ALLOWED_METHODS.includes('media.seek'));
  assert.equal(ALLOWED_METHODS.some((x) => x.includes('youtube')), false);
  for (const [method, spec] of Object.entries(METHOD_SPECS)) {
    assert.match(method, /^[a-z]+\.[a-z_]+$/);
    assert.ok(spec.timeoutMs >= 500 && spec.timeoutMs <= 55000);
  }
});

test('bounded browser burst accepts only linear same-tab page actions', () => {
  assert.equal(validateBurst({ steps: [{ action: 'fill', ref: 'oa-1', value: 'query' }, { action: 'key', key: 'Enter' }] }).ok, true);
  assert.equal(validateBurst({ steps: [] }).ok, false);
  assert.equal(validateBurst({ steps: Array.from({ length: 9 }, () => ({ action: 'read' })) }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'click', ref: 'oa-1', tabId: 9 }] }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'read' }], output: { arbitrary: true } }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'navigate', url: 'https://example.com' }] }).ok, false);
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
});

test('safeUrl accepts only http/https', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('file:///tmp/x'), null);
  assert.match(safeUrl('https://example.com/a'), /^https:\/\/example\.com/);
});
