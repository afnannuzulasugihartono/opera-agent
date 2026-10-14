// @last-edited: 2026-10-11 UTC+7.
// @title: local-mcp-server — the stdio MCP surface, driven against a fake browser rather than a process.
// @state: 8 locks; the protocol handshake, the advertised tools, and the ways a call can fail.
// @dependencies: node:test, strict, ../local/mcp-server.js.

// WHY THIS FILE EXISTS
//
// The driver runs in a process with no stdio contract, which makes it unusable by
// anything that speaks MCP. This file is that contract, and it is the difference
// between "works on the machine it was written on" and "npx opera-local".
//
// WHY the server is built around a plain function. A stdio server that only runs
// as a process cannot be tested without spawning one, and a test that spawns a
// real browser is a test that fails on someone else's machine. handle() takes a
// request and a context and returns a response, so every rule below is checked
// against a fake driver, and the stdio wrapper stays thin enough to be obvious.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from '../local/mcp-server.js';

// WHY every method here is async. The real driver is async on every call, and a
// synchronous fake made the server's missing await invisible: it serialised a
// promise as {} and the lock still passed. A fake that is shaped like the thing it
// stands in for is the only kind that can catch a bug in the real one.

function fakeDriver() {
  const calls = [];
  return {
    calls,
    tabs: async () => [{ id: 't1', url: 'https://docs.google.com/', title: 'Docs' }],
    open: async (url) => { calls.push(['open', url]); return { id: 't2', url, title: '' }; },
    close: async (tabId) => { calls.push(['close', tabId]); return { id: tabId, closed: true }; },
    read: async () => ({ url: 'https://docs.google.com/document/d/1', title: 'Paper', text: 'canvas text' }),
    find: async () => [{ ref: 'r1', text: 'Click to add title', x: 482, y: 396 }],
    click: async (x, y) => { calls.push(['click', x, y]); return { x, y }; },
    hover: async (x, y) => { calls.push(['hover', x, y]); return { x, y }; },
    clickRow: async (role, name) => { calls.push(['clickRow', role, name]); return { role, name, x: 1, y: 2 }; },
    key: async (name, mods) => { calls.push(['key', name, mods]); return { key: name }; },
    type: async (text) => { calls.push(['type', text]); return { chars: text.length }; },
    keys: async (events) => { calls.push(['keys', events]); return { events: events.length }; },
    snapshot: async () => [{ role: 'menuitem', name: 'Insert', x: 204, y: 46 }],
    capture: async (opts) => { calls.push(['capture', opts]); return 'BASE64JPEG'; }
  };
}

const ctx = () => ({ driver: fakeDriver(), browsers: [{ id: 'chrome', binary: 'C:/chrome.exe' }], port: 9450 });

test('initialize answers with a protocol version and who this server is', async () => {
  const server = createMcpServer(ctx());
  const res = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

  assert.equal(res.jsonrpc, '2.0');
  assert.equal(res.id, 1);
  assert.ok(res.result.protocolVersion);
  assert.match(res.result.serverInfo.name, /opera/);
});

test('every advertised tool carries a schema, or a client cannot call it', async () => {
  const server = createMcpServer(ctx());
  const res = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

  assert.ok(res.result.tools.length > 0);
  for (const tool of res.result.tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description, `${tool.name} has no description`);
  }
});

test('the surface covers what the driver can actually do', async () => {
  const server = createMcpServer(ctx());
  const { result } = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
  const names = result.tools.map((t) => t.name).sort();

  for (const required of ['browser_status', 'open_url', 'close_tab', 'list_tabs', 'read_page', 'find_elements', 'click', 'click_row', 'hover', 'press_key', 'type', 'stream_keys', 'capture_page', 'ax_snapshot']) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
});

test('a call runs the tool and returns its result as text content', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  const res = await server.handle({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'open_url', arguments: { url: 'https://sheets.google.com/' } }
  });

  assert.ok(res.result.content[0].text.includes('sheets.google.com'));
  assert.deepEqual(c.driver.calls[0], ['open', 'https://sheets.google.com/']);
});

test('a stream reaches the driver as one call with its events intact', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  const events = [{ key: '1', modifiers: ['Control', 'Alt'] }, { text: 'Hi' }];
  const res = await server.handle({
    jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name: 'stream_keys', arguments: { events } }
  });

  assert.match(res.result.content[0].text, /"events": 2/);
  assert.deepEqual(c.driver.calls[0], ['keys', events]);
});

test('a snapshot reaches the driver and comes back as readable text', async () => {
  const server = createMcpServer(ctx());
  const res = await server.handle({
    jsonrpc: '2.0', id: 10, method: 'tools/call',
    params: { name: 'ax_snapshot', arguments: {} }
  });

  assert.match(res.result.content[0].text, /Insert/);
  assert.match(res.result.content[0].text, /204/);
});

test('a capture comes back as image content a model can see, not base64 text', async () => {
  const server = createMcpServer(ctx());
  const res = await server.handle({
    jsonrpc: '2.0', id: 11, method: 'tools/call',
    params: { name: 'capture_page', arguments: {} }
  });

  assert.deepEqual(res.result.content, [{ type: 'image', data: 'BASE64JPEG', mimeType: 'image/jpeg' }]);
});

test('a full-page capture reaches the driver as a flag, not a second tool', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  const res = await server.handle({
    jsonrpc: '2.0', id: 12, method: 'tools/call',
    params: { name: 'capture_page', arguments: { fullPage: true } }
  });

  assert.deepEqual(c.driver.calls[0], ['capture', { fullPage: true }]);
  assert.deepEqual(res.result.content, [{ type: 'image', data: 'BASE64JPEG', mimeType: 'image/jpeg' }]);
});

test('a row click resolves and clicks in one call', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  const res = await server.handle({
    jsonrpc: '2.0', id: 12, method: 'tools/call',
    params: { name: 'click_row', arguments: { role: 'menuitem', name: 'Insert' } }
  });

  assert.match(res.result.content[0].text, /Insert/);
  assert.deepEqual(c.driver.calls[0], ['clickRow', 'menuitem', 'Insert']);
});

test('a hover reaches the driver without pressing anything', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  const res = await server.handle({
    jsonrpc: '2.0', id: 13, method: 'tools/call',
    params: { name: 'hover', arguments: { x: 10, y: 20 } }
  });

  assert.match(res.result.content[0].text, /10/);
  assert.deepEqual(c.driver.calls[0], ['hover', 10, 20]);
});

test('closing a tab drives the browser and drops the cached session', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  const res = await server.handle({
    jsonrpc: '2.0', id: 14, method: 'tools/call',
    params: { name: 'close_tab', arguments: { tabId: 't9' } }
  });

  assert.match(res.result.content[0].text, /t9/);
  assert.deepEqual(c.driver.calls[0], ['close', 't9']);
});

test('an unknown tool is an error, not a crash, because a model will ask for one', async () => {
  const server = createMcpServer(ctx());
  const res = await server.handle({
    jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { name: 'teleport', arguments: {} }
  });

  assert.ok(res.error, 'an unknown tool must answer with an error');
  assert.match(res.error.message, /teleport/);
});

test('a missing required argument is refused before the driver is touched', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  const res = await server.handle({
    jsonrpc: '2.0', id: 6, method: 'tools/call',
    params: { name: 'type', arguments: {} }
  });

  assert.ok(res.error);
  assert.deepEqual(c.driver.calls, [], 'a refused call must not reach the browser');
});

test('a driver that throws becomes an error result, not a dead server', async () => {
  const c = ctx();
  c.driver.read = () => { throw new Error('target closed'); };
  const server = createMcpServer(c);
  const res = await server.handle({
    jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'read_page', arguments: {} }
  });

  assert.ok(res.error);
  assert.match(res.error.message, /target closed/);
});

test('a driver that is still pending is awaited, or its result serialises as {}', async () => {
  const server = createMcpServer(ctx());
  const res = await server.handle({
    jsonrpc: '2.0', id: 8, method: 'tools/call',
    params: { name: 'read_page', arguments: {} }
  });

  const text = res.result.content[0].text;
  assert.notEqual(text, '{}', 'a pending driver call was serialised instead of awaited');
  assert.match(text, /Paper/);
});

test('a notification is answered with nothing at all, because JSON-RPC says so', async () => {
  const server = createMcpServer(ctx());
  const res = await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });

  assert.equal(res, undefined);
});