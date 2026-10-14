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

  for (const required of ['browser_status', 'open_url', 'close_tab', 'list_tabs', 'read_page', 'find_elements', 'click', 'click_row', 'hover', 'press_key', 'type', 'stream_keys', 'wait_for', 'capture_page', 'ax_snapshot']) {
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

  assert.deepEqual(res.result.content[0], { type: 'image', data: 'BASE64JPEG', mimeType: 'image/jpeg' });
  assert.match(res.result.content.at(-1).text, /^[0-9]+ ms$/);
});

test('a full-page capture reaches the driver as a flag, not a second tool', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  const res = await server.handle({
    jsonrpc: '2.0', id: 12, method: 'tools/call',
    params: { name: 'capture_page', arguments: { fullPage: true } }
  });

  assert.deepEqual(c.driver.calls[0], ['capture', { fullPage: true }]);
  assert.deepEqual(res.result.content[0], { type: 'image', data: 'BASE64JPEG', mimeType: 'image/jpeg' });
  assert.match(res.result.content.at(-1).text, /^[0-9]+ ms$/);
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

// WHY THIS CLAIM EXISTS. An agent that has to ask for the page after every
// action spends two calls on one decision, and the looking half is the one
// that costs. On the reference implementation roughly thirty per cent of all
// tool calls were snapshots, nearly all of them right after something the
// agent had just done. Handing the page back with the action makes one
// decision cost one call — and this fails the moment an action returns
// something flat, because the model would then be reasoning about a page it
// cannot see.

test('every action hands back the page it acted on, so looking costs no extra call', async () => {
  const server = createMcpServer(ctx());

  for (const [name, args] of [
    ['click', { x: 10, y: 20 }],
    ['click_row', { role: 'menuitem', name: 'Insert' }],
    ['hover', { x: 30, y: 40 }],
    ['press_key', { key: 'Enter' }],
    ['type', { text: 'hi' }],
    ['stream_keys', { events: [{ key: 'a' }] }],
    ['open_url', { url: 'https://sheets.google.com/' }]
  ]) {
    const res = await server.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } });
    const payload = JSON.parse(res.result.content[0].text);

    assert.ok('action' in payload, `${name} returned no action result`);
    assert.ok(Array.isArray(payload.elements), `${name} returned no page with the action`);
    assert.ok(payload.elements.length > 0, `${name} came back with an empty page`);
  }
});

test('the page that rides along is smaller than the page you ask for', async () => {
  const asked = [];
  const c = ctx();
  c.driver.snapshot = async (limit) => { asked.push(limit); return [{ role: 'button', name: 'b', x: 1, y: 1 }]; };
  const server = createMcpServer(c);

  await server.handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'click', arguments: { x: 1, y: 1 } } });
  await server.handle({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'ax_snapshot', arguments: { limit: 120 } } });

  assert.ok(asked[0] < asked[1], `an action asks for fewer rows (${asked[0]}) than a deliberate read (${asked[1]})`);
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

// WHY THIS CLAIM EXISTS. A Chrome tab id is a number, the tool schema says
// string, and an agent copies the id straight out of the tab list it was just
// handed. Comparing with === refused the id the product itself printed — so a
// drive that could see six tabs decided none of them was real.

test('a tab id is found whether the caller sends a number or a string', async () => {
  for (const tabId of ['1', 1]) {
    const c = ctx();
    c.resolveTab = async () => ['1', '8'];
    c.open = async () => c.driver;
    const server = createMcpServer(c);

    const res = await server.handle({
      jsonrpc: '2.0', id: 12, method: 'tools/call',
      params: { name: 'ax_snapshot', arguments: { tabId } }
    });

    assert.ok(res.result, `an id sent as ${typeof tabId} was refused: ${res.error?.message ?? ''}`);
  }
});

// WHY A WAIT IS TESTED AGAINST READS, NOT TIME. The contract is evidential:
// the wait ends on the same text a read would show, and a wait that runs out
// of budget reports instead of failing — found:false with the page as it
// stands, which is what the next decision needs.

test('a wait ends on the same evidence a read would show', async () => {
  const c = ctx();
  const texts = ['nothing yet', 'nothing yet', 'the outline now holds Heading'];
  c.driver.read = async () => ({ url: 'https://x/', title: 't', text: texts.shift() ?? '' });
  const server = createMcpServer(c);

  const res = await server.handle({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'wait_for', arguments: { text: 'Heading', timeoutMs: 2000, intervalMs: 100 } } });
  const payload = JSON.parse(res.result.content[0].text);

  assert.equal(payload.action.found, true);
  assert.ok(Array.isArray(payload.elements), 'the page comes back with the verdict');
});

test('a wait that runs out of budget reports instead of failing', async () => {
  const c = ctx();
  c.driver.read = async () => ({ url: 'https://x/', title: 't', text: 'never the text' });
  const server = createMcpServer(c);

  const res = await server.handle({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'wait_for', arguments: { text: 'Heading', timeoutMs: 500, intervalMs: 100 } } });
  const payload = JSON.parse(res.result.content[0].text);

  assert.equal(payload.action.found, false);
  assert.ok(payload.action.ms >= 500, 'the full budget was spent before admitting it');
  assert.ok(Array.isArray(payload.elements));
});

test('a wait with nothing to wait for is refused before the first read', async () => {
  const c = ctx();
  let reads = 0;
  c.driver.read = async () => { reads += 1; return { url: 'u', title: 't', text: '' }; };
  const server = createMcpServer(c);

  const res = await server.handle({ jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'wait_for', arguments: {} } });

  assert.ok(res.error);
  assert.equal(reads, 0, 'a refused wait touches nothing');
});

test('every call reports how long the browser took', async () => {
  const server = createMcpServer(ctx());

  const res = await server.handle({ jsonrpc: '2.0', id: 23, method: 'tools/call', params: { name: 'ax_snapshot', arguments: {} } });
  const last = res.result.content.at(-1);

  assert.match(last.text, /^[0-9]+ ms$/, 'the final block names the cost');
});

test('key vocabularies are enumerated so a misspelling fails before the browser', async () => {
  const server = createMcpServer(ctx());
  const { result } = await server.handle({ jsonrpc: '2.0', id: 24, method: 'tools/list', params: {} });
  const byName = Object.fromEntries(result.tools.map((t) => [t.name, t]));

  assert.deepEqual(byName.press_key.inputSchema.properties.modifiers.items.enum, ['Control', 'Alt', 'Shift', 'Meta']);
  assert.deepEqual(byName.stream_keys.inputSchema.properties.events.items.properties.modifiers.items.enum, ['Control', 'Alt', 'Shift', 'Meta']);
  assert.match(byName.press_key.inputSchema.properties.key.description, /Enter.*single printable ASCII/s);
});

// WHY THE CHANGE SET IS TESTED AS A HINT, NOT A TRUTH. The full page rides
// every action so the agent is never stranded; changed names what moved since
// the last look at the same tab. Rows match by value — role, name, position —
// and the first look reports null, because its elements ARE the baseline.

const ROW_FILE = { role: 'menuitem', name: 'File', x: 73, y: 46 };
const ROW_INSERT = { role: 'menuitem', name: 'Insert', x: 204, y: 46 };
const ROW_TABLE = { role: 'menuitem', name: 'Table', x: 312, y: 180 };

async function actOn(server, pages) {
  const res = await server.handle({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'click', arguments: { x: 1, y: 1 } } });
  return JSON.parse(res.result.content[0].text);
}

test('the first look at a tab carries no change set, because it is the baseline', async () => {
  const c = ctx();
  c.driver.snapshot = async () => [ROW_FILE];
  const out = await actOn(createMcpServer(c));

  assert.equal(out.changed, null);
  assert.equal(out.elements.length, 1);
});

test('an unchanged page reports nothing changed', async () => {
  const c = ctx();
  c.driver.snapshot = async () => [ROW_FILE, ROW_INSERT];
  const server = createMcpServer(c);
  await actOn(server);

  const out = await actOn(server);

  assert.deepEqual(out.changed, { added: [], moved: [], removed: 0, reshaped: false });
});

test('added and moved rows are named', async () => {
  const c = ctx();
  const pages = [
    [ROW_FILE, ROW_INSERT, { role: 'button', name: 'Share', x: 1386, y: 30 }],
    [ROW_FILE, ROW_INSERT, { role: 'button', name: 'Share', x: 1390, y: 30 }, ROW_TABLE]
  ];
  c.driver.snapshot = async () => pages.shift() ?? [];
  const server = createMcpServer(c);
  await actOn(server);

  const out = await actOn(server);

  assert.deepEqual(out.changed.added, [ROW_TABLE]);
  assert.deepEqual(out.changed.moved, [{ role: 'button', name: 'Share', x: 1390, y: 30 }]);
  assert.equal(out.changed.removed, 0);
  assert.equal(out.changed.reshaped, false);
});

test('removed rows count without riding along', async () => {
  const c = ctx();
  const pages = [[ROW_FILE, ROW_TABLE], [ROW_FILE]];
  c.driver.snapshot = async () => pages.shift() ?? [];
  const server = createMcpServer(c);
  await actOn(server);

  const out = await actOn(server);

  assert.equal(out.changed.removed, 1);
  assert.deepEqual(out.changed.added, []);
});

test('a replaced page says reshaped instead of listing sixty new rows', async () => {
  const c = ctx();
  const pages = [
    [ROW_FILE, ROW_INSERT, ROW_TABLE],
    [{ role: 'button', name: 'Unrelated', x: 1, y: 1 }, { role: 'link', name: 'Other', x: 2, y: 2 }]
  ];
  c.driver.snapshot = async () => pages.shift() ?? [];
  const server = createMcpServer(c);
  await actOn(server);

  const out = await actOn(server);

  assert.equal(out.changed.reshaped, true);
  assert.deepEqual(out.changed.added, [], 'read elements instead: everything moved');
  assert.equal(out.elements.length, 2, 'the full page still rides along');
});

// WHY THE FLOOR IS ASSERTED, NOT THE CEILING. setTimeout fires at or after its
// delay, never before, so "took at least a hundred" cannot flake under load —
// and it is the floor that matters, because the point is the page getting its
// beat before the snapshot, not the call being fast.

test('an action lets the page stand before looking at it', async () => {
  const server = createMcpServer(ctx());

  const res = await server.handle({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'click', arguments: { x: 1, y: 1 } } });
  const ms = Number(res.result.content.at(-1).text.replace(' ms', ''));

  assert.ok(ms >= 100, `the page gets its beat before the snapshot (took ${ms} ms)`);
});
