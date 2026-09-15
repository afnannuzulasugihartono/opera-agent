import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contract = JSON.parse(await readFile(new URL('./fixtures/mcp-contract-v1.json', import.meta.url), 'utf8'));
const fallback = JSON.parse(await readFile(new URL('./fixtures/chat-control-fallback-v1.json', import.meta.url), 'utf8'));

const expectedMethods = new Set([
  'browser.ping', 'browser.burst', 'tabs.list', 'tabs.open', 'tabs.activate', 'tabs.navigate', 'tabs.close',
  'page.read', 'page.capture', 'page.find', 'page.click', 'page.fill', 'page.key', 'page.scroll', 'page.pointer'
]);

test('Chat fallback covers the locked MCP browser surface exactly', () => {
  assert.equal(fallback.schemaVersion, 1);
  assert.equal(fallback.transport, 'supabase-rpc-fallback');
  assert.deepEqual(Object.keys(fallback.tools), contract.tools);
  assert.equal(Object.keys(fallback.tools).length, contract.toolCount);
});

test('Chat fallback is constrained to the existing durable command queue', () => {
  assert.equal(fallback.enqueueFunction, 'public.opera_enqueue');
  assert.equal(fallback.awaitFunction, 'public.opera_await');
  assert.equal(fallback.deviceName, 'opera');

  for (const [tool, entry] of Object.entries(fallback.tools)) {
    assert.ok(expectedMethods.has(entry.method), `${tool} maps to unexpected method ${entry.method}`);
    assert.ok(Number.isInteger(entry.timeoutMs), `${tool} timeout must be an integer`);
    assert.ok(entry.timeoutMs >= 500 && entry.timeoutMs <= 15000, `${tool} timeout is outside fallback bounds`);
    assert.doesNotMatch(entry.method, /(sql|shell|javascript|eval|exec|secret|pair)/i);
  }
});

test('Chat fallback does not invent a second browser runtime or transport', () => {
  const serialized = JSON.stringify(fallback);
  assert.doesNotMatch(serialized, /websocket|eventsource|stdio|localhost|service_role|bearer|token/i);
  assert.doesNotMatch(serialized, /opera_complete_command|opera_pair_device|opera_create_pairing_code/i);
});
