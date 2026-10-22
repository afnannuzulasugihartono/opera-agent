// @last-edited: 2026-10-11 UTC+7.
// @title: local-mcp-server — the stdio MCP surface, driven against a fake browser rather than a process.
// @state: 8 locks; the protocol handshake, the advertised tools, and the ways a call can fail.
// @dependencies: node:test, strict, ../local/mcp-server.js.

// WHY THIS FILE EXISTS

// The driver runs in a process with no stdio contract, which makes it unusable by anything that speaks MCP.
// This file is that contract, and it is the difference between "works on the machine it was written on" and "npx opera-local".

// WHY the server is built around a plain function.
// A stdio server that only runs as a process cannot be tested without spawning one, and a test that spawns a real browser is a test that fails on someone else's machine.
// handle() takes a request and a context and returns a response, so every rule below is checked against a fake driver, and the stdio wrapper stays thin enough to be obvious.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMcpServer, TOOLS } from '../local/mcp-server.js';

// WHY every method here is async.
// The real driver is async on every call, and a synchronous fake made the server's missing await invisible: it serialised a promise as {} and the lock still passed.
// A fake that is shaped like the thing it stands in for is the only kind that can catch a bug in the real one.

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
    pageState: async () => ({ url: 'https://docs.google.com/document/d/1', title: 'Paper', textChars: 11, focus: null }),
    caretLine: async () => ({ line: 'Kajian pustaka mencakup', caretMoved: true, caretRestored: true }),
    capture: async (opts) => { calls.push(['capture', opts]); return 'BASE64JPEG'; },
    navigate: async (url) => { calls.push(['navigate', url]); return { url, waited: true }; },
    ensureFront: async (opts) => {
      calls.push(['ensureFront', opts]);
      return { window: 'the page hears input', checked: 'page' };
    },
    captureSized: async (opts) => {
      calls.push(['capture', opts]);
      return {
        data: 'BASE64JPEG',
        viewport: { width: 1186, height: 670 },
        dpr: 1.25,
        image: { width: 1483, height: 838 },
        note: 'image pixels are css pixels times 1.25'
      };
    },
  };
}

const ctx = (driver = fakeDriver()) => ({
  driver,
  browsers: [{ id: 'chrome', binary: 'C:/chrome.exe' }],
  port: 9450
});

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

  for (const required of ['browser_status', 'open_url', 'close_tab', 'list_tabs', 'read_page', 'find_elements', 'click', 'click_row', 'hover', 'press_key', 'type', 'append', 'scroll', 'get_computed', 'stream_keys', 'wait_for', 'caret_line', 'upload', 'drop_file', 'intercept_file_chooser', 'download', 'capture_page', 'ax_snapshot']) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
});

// WHY THIS ONE IS DRIVEN WITHOUT A BROWSER.
// A report that needs the browser open fails exactly when a bookkeeper wants it: at month end, on a laptop with no tab.
// The tool answers from the file, so the test proves the server does not reach for a driver it does not need.

test('report_build turns an exported sheet into a checked report without a browser', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-report-tool-'));
  const source = path.join(dir, 'penjualan-2026-09.csv');
  fs.writeFileSync(source, 'Tanggal,Kategori,Penjualan\r\n2026-09-01,Retail,1250000\r\n2026-09-02,Grosir,2000000\r\n');
  try {
    const server = createMcpServer(ctx());
    const res = await server.handle({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: {
        name: 'report_build',
        arguments: {
          source,
          client: 'Toko Sinar Jaya',
          title: 'Laporan Penjualan',
          period: '2026-09',
          periodColumn: 'Tanggal',
          groupBy: 'Kategori',
          valueColumn: 'Penjualan'
        }
      }
    });
    assert.equal(res.result.isError, undefined);
    const payload = JSON.parse(res.result.content[0].text);
    assert.equal(payload.verified.ok, true);
    assert.equal(payload.report.figures.find((figure) => figure.id === 'total').cents, 325000000);
    assert.ok(fs.existsSync(payload.out), 'the report file is written beside the source');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// WHY THE CAPTURE SAYS WHAT IT CANNOT DO.
// Measured live on a Google Doc: fullPage answered 2000x937 pixels for an 18-page document - one viewport, not the page - while its own note claimed the whole document.
// An agent that reads that note plans a one-shot review of a thesis and gets a screenshot of page one.
// The description states the boundary so the plan is paging, not hoping.

test('the capture says fullPage stops at the viewport on canvas pages', () => {
  const capture = TOOLS.find((tool) => tool.name === 'capture_page');

  assert.match(capture.description, /canvas/i);
  assert.match(capture.description, /viewport/i);
});

test('type says where the proof lives when its own placement check cannot see it', () => {
  const type = TOOLS.find((tool) => tool.name === 'type');

  assert.match(type.description, /placed/);
  assert.match(type.description, /read_page\(\)/);
});

// WHY THE APPEND'S DESCRIPTION CARRIES ITS OWN SCAR.
// An agent reads descriptions to decide whether to call a tool, and this one exists because a batch landed in a table cell: the measured failure is the argument for calling append instead of the click-then-End road, and a description without it is a description nobody trusts.

test('the append says how it decides it reached the end, and when it cannot know', () => {
  const append = TOOLS.find((tool) => tool.name === 'append');

  assert.match(append.description, /atEnd is measured, not assumed/);
  assert.match(append.description, /found:false/);
  assert.match(append.description, /table cell/);
  assert.deepEqual(Object.keys(append.inputSchema.properties).sort(), ['tabId', 'text']);
  assert.deepEqual(append.inputSchema.required, ['text']);
});

// WHY THE SCROLL'S ARGUMENTS ARE FOUR AND NOT ONE.
// An agent knows three different things - how far to move, that it wants the end, and the thing it wants to see - and merging them into one string argument would make every one of them a guess about which form was meant.
// Four optional arguments, each unambiguous.

// WHY THE COMPUTED READ IS DESCRIBED BY WHAT IT ANSWERS.
// An agent reads a tool description to decide whether a call can settle a question, so the description names the questions it settles - a button that turned blue, a modal that opened, text past the viewport - rather than the properties it returns.

test('the computed read is described by the questions it settles, not by its fields', () => {
  const tool = TOOLS.find((one) => one.name === 'get_computed');

  assert.match(tool.description, /turned blue/);
  assert.match(tool.description, /on screen/);
  assert.match(tool.description, /never changes anything/);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['selector', 'tabId', 'x', 'y']);
  assert.equal(tool.inputSchema.required, undefined);
});

test('the computed read reaches the driver and answers what it read', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  c.driver.computed = async (options) => { c.driver.calls.push(['computed', options]); return { found: true, tag: 'BUTTON', name: 'Bold', background: 'rgb(26, 115, 232)', rect: { onScreen: true } }; };

  const res = await server.handle({
    jsonrpc: '2.0', id: 99, method: 'tools/call',
    params: { name: 'get_computed', arguments: { selector: 'button.bold' } }
  });

  assert.deepEqual(c.driver.calls.filter(([name]) => name === 'computed'), [['computed', { selector: 'button.bold', x: undefined, y: undefined }]]);
  assert.match(res.result.content[0].text, /"name": "Bold"/);
});

test('scroll takes pixels, the end, a target text or a selector, and nothing is required', () => {
  const scroll = TOOLS.find((tool) => tool.name === 'scroll');

  assert.deepEqual(Object.keys(scroll.inputSchema.properties).sort(), ['end', 'selector', 'tabId', 'text', 'y']);
  assert.equal(scroll.inputSchema.required, undefined, 'a scroll needs no argument to be refused: it must be answerable either way');
  assert.match(scroll.description, /which scroll container moved/);
  assert.match(scroll.description, /travelPx/);
  assert.match(scroll.description, /no answer at all/, 'and it carries the measured reason the wheel road is not used');
});

test('scroll reaches the driver with the arguments it was given', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  c.driver.scroll = async (options) => { c.driver.calls.push(['scroll', options]); return { movedPx: 1400, from: { x: 0, y: 0 }, to: { x: 0, y: 1400 }, atEnd: false, root: 'document', target: { found: false, visible: false, y: 0, text: '' }, why: '' }; };

  const res = await server.handle({
    jsonrpc: '2.0', id: 98, method: 'tools/call',
    params: { name: 'scroll', arguments: { y: 1400 } }
  });

  assert.deepEqual(c.driver.calls.filter(([name]) => name === 'scroll'), [['scroll', { y: 1400, end: false, text: undefined, selector: undefined }]]);
  assert.match(res.result.content[0].text, /"movedPx": 1400/);
});

test('append reaches the driver as one call with the text intact', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  c.driver.append = async (text) => { c.driver.calls.push(['append', text]); return { chars: text.length, landed: true, atEnd: true, placed: { found: true, index: 9 } }; };

  const res = await server.handle({
    jsonrpc: '2.0', id: 97, method: 'tools/call',
    params: { name: 'append', arguments: { text: 'one more line' } }
  });

  assert.deepEqual(c.driver.calls.filter(([name]) => name === 'append'), [['append', 'one more line']]);
  assert.match(res.result.content[0].text, /"atEnd": true/);
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
  assert.deepEqual(c.driver.calls.filter(([name]) => name !== 'ensureFront'), [['keys', events]]);
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

  // WHY THE CAPTURE SAYS WHAT SPACE IT IS IN.
  // Measured live by resizing the window: viewport 1144x714 -> 1186x670, capture 1430x963 -> 1483x838, scale steady at 1.25.
  // An agent handed a picture and nothing else divides by eye and clicks the wrong thing while every answer says the click landed.

// WHY AN INPUT ACTION BRINGS ITS OWN WINDOW.
// Measured live on this product's own author, repeatedly: with the browser behind another window, clicks and typing went nowhere, Google Docs took the keys and dropped them, and every answer said the click was delivered.
// Asking the human to press a key in the middle of a drive is the one thing this product promised not to need - so the check happens where the action happens, and every input answer says which of the two things happened.

test('an input action brings the window forward and says so', async () => {
  const c = ctx();
  const server = createMcpServer(c);

  const res = await server.handle({
    jsonrpc: '2.0', id: 81, method: 'tools/call',
    params: { name: 'click', arguments: { x: 100, y: 200 } }
  });

  assert.ok(c.driver.calls.some(([name]) => name === 'ensureFront'), 'the click asked about the window first');
  const out = JSON.parse(res.result.content[0].text);
  assert.equal(out.window.window, 'the page hears input', 'and the answer says what it found');
});

test('a read pays nothing for the window, because it changes nothing about it', async () => {
  const c = ctx();
  const server = createMcpServer(c);

  await server.handle({
    jsonrpc: '2.0', id: 82, method: 'tools/call',
    params: { name: 'read_page', arguments: {} }
  });

  assert.ok(!c.driver.calls.some(([name]) => name === 'ensureFront'), 'reading does not steal the human attention');
});

// WHY THESE CLAIMS EXIST.
// Measured live on this machine: browser_status answered focused true with Brave in front while the drive was on a Chrome tab, because the answer asked "is any browser in front" and the machine had three browsers on it.
// An agent that reads that never learns the window it is driving is somewhere else, so the answer now names the browser in front and means "ours" by the titles of the tabs we actually drive.

const statusCtx = (foreground, titles) => {
  const driver = fakeDriver();
  driver.windowState = async () => ({ platform: 'win32', foreground, windows: [foreground, 'Paper - Google Chrome'], focused: false, why: '' });
  driver.tabs = async () => titles.map((title, index) => ({ id: `t${index}`, url: `https://docs.google.com/${index}`, title }));
  return { driver, browsers: [{ id: 'chrome', name: 'Google Chrome' }, { id: 'brave', name: 'Brave' }], port: 9450 };
};

const statusOf = async (context) => {
  const server = createMcpServer(context);
  const res = await server.handle({ jsonrpc: '2.0', id: 90, method: 'tools/call', params: { name: 'browser_status', arguments: {} } });
  return JSON.parse(res.result.content[0].text).window;
};

test('another browser in front is not our window, and the answer says which one it is', async () => {
  const window = await statusOf(statusCtx('syarat franchise gacoan - Brave', ['Untitled document - Google Docs']));

  assert.equal(window.focused, false, 'a browser we are not driving does not count');
  assert.equal(window.browser, 'Brave', 'and the answer names it instead of saying yes');
  assert.match(window.why, /Brave is in front/);
  assert.equal(window.title, '', 'a window that is not ours names no title');
});

test('the window holding the tab we are driving is the one that counts', async () => {
  const window = await statusOf(statusCtx('Untitled document - Google Docs - Google Chrome', ['Untitled document - Google Docs']));

  assert.equal(window.focused, true);
  assert.equal(window.browser, 'Google Chrome');
  assert.equal(window.title, 'Untitled document - Google Docs - Google Chrome');
  assert.equal(window.why, '', 'a window that is ours has nothing left to explain');
});

test('an application that is not a browser says what is in front instead of guessing', async () => {
  const window = await statusOf(statusCtx('Project 1 - Visual Studio Code', ['Untitled document - Google Docs']));

  assert.equal(window.focused, false);
  assert.equal(window.browser, '', 'there is no browser to name');
  assert.match(window.why, /another window is in front/);
});

// WHY THESE CLAIMS EXIST.
// An agent holds an eight-digit id it copied from a list and cannot read it back off anything; it can read a title.
// So a tab may be named, an answer says which tab that turned out to be, and a name that fits two tabs is refused with both - because typing into the wrong document while saying nothing is the worst thing this product can do.

const namedCtx = (tabs) => {
  const driver = fakeDriver();
  driver.tabs = async () => tabs;
  return {
    driver,
    browsers: [{ id: 'chrome', name: 'Google Chrome' }],
    port: 9450,
    resolveTab: async () => tabs.map((page) => page.id),
    open: async () => driver
  };
};

const PAGES = [
  { id: '111', url: 'https://opera-agent.pages.dev/beranda', title: 'Opera Agent' },
  { id: '222', url: 'https://docs.google.com/document/d/one', title: 'Thesis - Google Docs' },
  { id: '333', url: 'https://docs.google.com/document/d/two', title: 'Notes - Google Docs' }
];

const clickOn = async (context, tabId) => {
  const server = createMcpServer(context);
  const res = await server.handle({
    jsonrpc: '2.0', id: 95, method: 'tools/call',
    params: { name: 'click', arguments: { tabId, x: 10, y: 20 } }
  });
  if (res.error) return { failed: String(res.error.message) };
  return JSON.parse(res.result.content[0].text);
};

test('a tab named by its title is found, and the answer says which tab it was', async () => {
  const c = namedCtx(PAGES);

  const out = await clickOn(c, 'Thesis');

  assert.deepEqual(out.tab, { id: '222', title: 'Thesis - Google Docs', named: true });
  assert.ok(c.driver.calls.some(([name]) => name === 'ensureFront'), 'and the click went through the window check with that tab in hand');
});

test('a tab named by part of its address is found too, because urls are what a list shows', async () => {
  const c = namedCtx(PAGES);

  const out = await clickOn(c, 'document/d/two');

  assert.equal(out.tab.id, '333');
});

test('a name that fits two tabs is refused with both, rather than one of them', async () => {
  const c = namedCtx(PAGES);

  const out = await clickOn(c, 'Google Docs');

  assert.match(out.failed, /"Google Docs" is 2 tabs: 222 Thesis - Google Docs \| 333 Notes - Google Docs/);
  assert.match(out.failed, /Name it more closely, or use its id/);
  assert.ok(!c.driver.calls.some(([name]) => name === 'click'), 'and nothing was clicked in either of them');
});

test('a number that is not a tab fails as a number, because a wrong id is not a name', async () => {
  const c = namedCtx(PAGES);

  const out = await clickOn(c, '999');

  assert.match(out.failed, /No page target 999\. Open pages: 111 \| 222 \| 333/);
});

test('a number that is a tab is used as itself and says nothing about names', async () => {
  const c = namedCtx(PAGES);

  const out = await clickOn(c, '333');

  assert.deepEqual(out.tab, { id: '333', title: 'Notes - Google Docs', named: false });
});

// WHY A NAMED TAB IS NAVIGATED.
// Measured live on this machine: `open_url` with a tabId answered "driver.open is not a function", because a per-tab driver cannot open anything - and a caller who names a tab means "this tab goes here", not "open one more".
// So a named tab is navigated in place and the answer names the tab it moved.

test('open_url with a named tab navigates that tab instead of opening another one', async () => {
  const c = namedCtx(PAGES);
  const server = createMcpServer(c);

  const res = await server.handle({
    jsonrpc: '2.0', id: 96, method: 'tools/call',
    params: { name: 'open_url', arguments: { tabId: '333', url: 'https://example.com/beranda' } }
  });

  const out = JSON.parse(res.result.content[0].text);
  assert.deepEqual(c.driver.calls.filter(([name]) => name === 'navigate'), [['navigate', 'https://example.com/beranda']]);
  assert.equal(out.action.navigated.url, 'https://example.com/beranda');
  assert.equal(out.action.tab, '333', 'and the answer says which tab it moved');
  assert.ok(!c.driver.calls.some(([name]) => name === 'open'), 'no second tab was opened');
});

test('a capture comes back as image content a model can see, not base64 text', async () => {
  const server = createMcpServer(ctx());
  const res = await server.handle({
    jsonrpc: '2.0', id: 11, method: 'tools/call',
    params: { name: 'capture_page', arguments: {} }
  });

  assert.deepEqual(res.result.content[0], { type: 'image', data: 'BASE64JPEG', mimeType: 'image/jpeg' });
  assert.match(res.result.content.at(-1).text, /^[0-9]+ ms$/);
  const geometry = JSON.parse(res.result.content.at(-2).text);
  assert.deepEqual(geometry.viewport, { width: 1186, height: 670 });
  assert.equal(geometry.dpr, 1.25);
  assert.deepEqual(geometry.image, { width: 1483, height: 838 });
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
  assert.deepEqual(c.driver.calls.filter(([name]) => name !== 'ensureFront'), [['clickRow', 'menuitem', 'Insert']]);
});

test('a hover reaches the driver without pressing anything', async () => {
  const c = ctx();
  const server = createMcpServer(c);
  const res = await server.handle({
    jsonrpc: '2.0', id: 13, method: 'tools/call',
    params: { name: 'hover', arguments: { x: 10, y: 20 } }
  });

  assert.match(res.result.content[0].text, /10/);
  assert.deepEqual(c.driver.calls.filter(([name]) => name !== 'ensureFront'), [['hover', 10, 20]]);
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

// WHY THIS CLAIM EXISTS.
// An agent that has to ask for the page after every action spends two calls on one decision, and the looking half is the one that costs.
// On the reference implementation roughly thirty per cent of all tool calls were snapshots, nearly all of them right after something the agent had just done.
// Handing the page back with the action makes one decision cost one call — and this fails the moment an action returns something flat, because the model would then be reasoning about a page it cannot see.

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
    assert.ok(payload.page, `${name} returned no page state with the action`);
    assert.equal(payload.page.url, 'https://docs.google.com/document/d/1', `${name} lost the url`);
    assert.equal(payload.page.rows, 1, `${name} lost the row count`);
    assert.ok(payload.changed, `${name} returned no change set`);
  }
});

test('an action on a sixty-row page answers in a thousand characters, not five thousand', async () => {
  const c = ctx();
  const rows = Array.from({ length: 60 }, (_, i) => ({
    role: 'button', name: `Row number ${i} with a name`, x: 10, y: 20 + i * 30
  }));
  c.driver.snapshot = async () => rows;
  const server = createMcpServer(c);

  const res = await server.handle({ jsonrpc: '2.0', id: 91, method: 'tools/call', params: { name: 'click', arguments: { x: 1, y: 1 } } });
  const text = res.result.content[0].text;
  const out = JSON.parse(text);

  assert.ok(text.length < 1500, `an action answered with ${text.length} characters`);
  assert.equal(out.page.rows, 60, 'the count still says how much the page holds');
  assert.equal(out.changed.added.length, 8, 'eight rows ride along; the rest are one snapshot away');
  assert.equal(out.changed.baseline, true);
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

// WHY THIS CLAIM EXISTS.
// A Chrome tab id is a number, the tool schema says string, and an agent copies the id straight out of the tab list it was just handed.
// Comparing with === refused the id the product itself printed — so a drive that could see six tabs decided none of them was real.

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

// WHY A WAIT IS TESTED AGAINST READS, NOT TIME.
// The contract is evidential: the wait ends on the same text a read would show, and a wait that runs out of budget reports instead of failing — found:false with the page as it stands, which is what the next decision needs.

test('a wait ends on the same evidence a read would show', async () => {
  const c = ctx();
  const texts = ['nothing yet', 'nothing yet', 'the outline now holds Heading'];
  c.driver.read = async () => ({ url: 'https://x/', title: 't', text: texts.shift() ?? '' });
  const server = createMcpServer(c);

  const res = await server.handle({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'wait_for', arguments: { text: 'Heading', timeoutMs: 2000, intervalMs: 100 } } });
  const payload = JSON.parse(res.result.content[0].text);

  assert.equal(payload.action.found, true);
  assert.ok(payload.page && payload.changed, 'the page state comes back with the verdict');
});

test('a wait that runs out of budget reports instead of failing', async () => {
  const c = ctx();
  c.driver.read = async () => ({ url: 'https://x/', title: 't', text: 'never the text' });
  const server = createMcpServer(c);

  const res = await server.handle({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'wait_for', arguments: { text: 'Heading', timeoutMs: 500, intervalMs: 100 } } });
  const payload = JSON.parse(res.result.content[0].text);

  assert.equal(payload.action.found, false);
  assert.ok(payload.action.ms >= 500, 'the full budget was spent before admitting it');
  assert.ok(payload.page && payload.changed, 'the page state comes back with the verdict');
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
  assert.match(byName.press_key.inputSchema.properties.key.description, /Enter.*ArrowLeft.*ArrowRight.*single printable ASCII/s);
});

// WHY THE CHANGE SET IS TESTED AS A HINT, NOT A TRUTH.
// The full page rides every action so the agent is never stranded; changed names what moved since the last look at the same tab.
// Rows match by value — role, name, position — and the first look reports null, because its elements ARE the baseline.

const ROW_FILE = { role: 'menuitem', name: 'File', x: 73, y: 46 };
const ROW_INSERT = { role: 'menuitem', name: 'Insert', x: 204, y: 46 };
const ROW_TABLE = { role: 'menuitem', name: 'Table', x: 312, y: 180 };

async function actOn(server, pages) {
  const res = await server.handle({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'click', arguments: { x: 1, y: 1 } } });
  return JSON.parse(res.result.content[0].text);
}

test('the first look at a tab carries the baseline rows, because there is nothing to compare', async () => {
  const c = ctx();
  c.driver.snapshot = async () => [ROW_FILE];
  const out = await actOn(createMcpServer(c));

  assert.equal(out.changed.baseline, true);
  assert.deepEqual(out.changed.added, [ROW_FILE]);
  assert.equal(out.page.rows, 1);
});

test('an unchanged page reports nothing changed', async () => {
  const c = ctx();
  c.driver.snapshot = async () => [ROW_FILE, ROW_INSERT];
  const server = createMcpServer(c);
  await actOn(server);

  const out = await actOn(server);

  assert.deepEqual(out.changed.added, []);
  assert.deepEqual(out.changed.moved, []);
  assert.equal(out.changed.removed, 0);
  assert.equal(out.changed.reshaped, false);
  assert.equal(out.changed.baseline, false);
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
  assert.deepEqual(out.changed.added, [], 'read the rows instead: everything moved');
  assert.equal(out.page.rows, 2, 'the count says what the page holds now');
});

// WHY THE FLOOR IS ASSERTED, NOT THE CEILING.
// setTimeout fires at or after its delay, never before, so "took at least a hundred" cannot flake under load — and it is the floor that matters, because the point is the page getting its beat before the snapshot, not the call being fast.

test('an action lets the page stand before looking at it', async () => {
  const server = createMcpServer(ctx());

  const res = await server.handle({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'click', arguments: { x: 1, y: 1 } } });
  const ms = Number(res.result.content.at(-1).text.replace(' ms', ''));

  assert.ok(ms >= 100, `the page gets its beat before the snapshot (took ${ms} ms)`);
});

test('caret_line reports the line without moving past it', async () => {
  const server = createMcpServer(ctx());

  const res = await server.handle({ jsonrpc: '2.0', id: 32, method: 'tools/call', params: { name: 'caret_line', arguments: {} } });

  assert.deepEqual(JSON.parse(res.result.content[0].text), {
    line: 'Kajian pustaka mencakup',
    caretMoved: true,
    caretRestored: true
  });
});

// WHY A PAGE WITH NO FILE INPUT IS A FAILURE.
// Measured live on Google Docs: upload answered inputFound: false as a successful tool call, so an agent reading it as done moved on with nothing in the document, and the road in - a drop - was fill.
// So it fails, names that, and carries the drop with it.

test('upload on a page with no file input fails and says which road is left', async () => {
  const without = fakeDriver();
  without.upload = async () => ({ inputFound: false, filename: 'a.png' });
  const server = createMcpServer(ctx(without));

  const res = await server.handle({
    jsonrpc: '2.0',
    id: 71,
    method: 'tools/call',
    params: { name: 'upload', arguments: { filename: 'a.png', data: 'x' } }
  });

  assert.match(res.error.message, /inputFound: false/);
  assert.match(res.error.message, /drop_file/, 'and the road that does work is in the answer');
});

test('upload carries a file without touching the native dialog', async () => {
  const c = ctx();
  c.driver.upload = async (options) => ({ inputFound: true, filename: options.filename, bytes: 5 });
  const server = createMcpServer(c);

  const res = await server.handle({ jsonrpc: '2.0', id: 33, method: 'tools/call', params: { name: 'upload', arguments: { filename: 'pic.png', path: '/files/pic.png' } } });
  const payload = JSON.parse(res.result.content[0].text);

  assert.deepEqual(payload.action, { inputFound: true, filename: 'pic.png', bytes: 5 });
  assert.ok(payload.page && payload.changed, 'the page state comes back with the result');
});

test('intercept_file_chooser toggles without touching the page', async () => {
  const c = ctx();
  c.driver.interceptFileChooser = async (enabled) => ({ intercepting: enabled });
  const server = createMcpServer(c);

  const res = await server.handle({ jsonrpc: '2.0', id: 34, method: 'tools/call', params: { name: 'intercept_file_chooser', arguments: { enabled: true } } });

  assert.deepEqual(JSON.parse(res.result.content[0].text), { intercepting: true });
});

// WHY THE STRAY TAB IS CLOSED AND NAMED, NOT LEFT.
// A drop the page refused is answered by Chrome the only way it can be: the file opens in a tab.
// Every rejected drop in the live drill left one behind and every accepted drop left none, so the tab is the failure signal as well as the litter — and the answer says so instead of quietly opening windows on the person screen.

// WHY THE TAB APPEARS ONLY AFTER THE DROP.
// Chrome opens the file when the page refuses the drop, so the stray tab exists between the look before and the look after, and not one moment earlier — a stub that had it from the start would prove nothing about which look found it.

test('a drop Chrome answered by opening the file closes that tab and says so', async () => {
  const c = ctx();
  let refused = false;
  const base = [{ id: 't1', url: 'https://docs.google.com/', title: 'Docs' }];
  c.driver.tabs = async () => (refused
    ? [...base, { id: 't9', url: 'file:///files/pic.png', title: 'pic.png' }]
    : base);
  c.driver.dropFile = async () => {
    refused = true;
    return { dropped: true, filename: 'pic.png', bytes: 5, x: 1, y: 2, mimeType: 'image/png' };
  };
  c.resolveTab = async () => ['t1'];
  c.open = async () => c.driver;
  const server = createMcpServer(c);

  const res = await server.handle({
    jsonrpc: '2.0', id: 41, method: 'tools/call',
    params: { name: 'drop_file', arguments: { tabId: 't1', x: 1, y: 2, filename: 'pic.png', path: '/files/pic.png' } }
  });
  const payload = JSON.parse(res.result.content[0].text);

  assert.equal(payload.action.dropped, true);
  assert.equal(payload.action.openedInstead, true, 'the drop did not land and says so');
  assert.deepEqual(c.driver.calls.filter((call) => call[0] === 'close'), [['close', 't9']], 'and the tab it opened is closed');
});

test('a drop the page took leaves no tab and reports a clean drop', async () => {
  const c = ctx();
  c.resolveTab = async () => ['t1'];
  c.open = async () => c.driver;
  c.driver.dropFile = async () => ({ dropped: true, filename: 'pic.png', bytes: 5, x: 1, y: 2, mimeType: 'image/png' });
  const server = createMcpServer(c);

  const res = await server.handle({
    jsonrpc: '2.0', id: 42, method: 'tools/call',
    params: { name: 'drop_file', arguments: { tabId: 't1', x: 1, y: 2, filename: 'pic.png', path: '/files/pic.png' } }
  });
  const payload = JSON.parse(res.result.content[0].text);

  assert.equal(payload.action.openedInstead, false);
  assert.ok(!c.driver.calls.some((call) => call[0] === 'close'), 'nothing to close, nothing closed');
});

// WHY THE ALLOWLIST IS PINNED AS A REFUSAL.
// The whole value of asking the browser a question is lost the moment the question can also be an action, so the boundary is tested by what it refuses: no script in the page, no input, no navigation, no storage.
// A method outside the list must be refused by name and with the list, because an agent that is told "no" can act on it and an agent that is told "unknown" can only guess.

test('ask_page returns a raw read and hands the method its own params', async () => {
  const c = ctx();
  c.driver.ask = async (method, params) => ({ asked: method, params });
  c.resolveTab = async () => ['t1'];
  c.open = async () => c.driver;
  const server = createMcpServer(c);

  const res = await server.handle({
    jsonrpc: '2.0', id: 51, method: 'tools/call',
    params: { name: 'ask_page', arguments: { tabId: 't1', method: 'Page.getFrameTree' } }
  });
  const payload = JSON.parse(res.result.content[0].text);

  assert.deepEqual(payload, { method: 'Page.getFrameTree', result: { asked: 'Page.getFrameTree', params: {} } });
});

test('ask_page defaults a screenshot to png, which is how a test image is made', async () => {
  const c = ctx();
  c.driver.ask = async (method, params) => ({ asked: method, params });
  c.resolveTab = async () => ['t1'];
  c.open = async () => c.driver;
  const server = createMcpServer(c);

  const res = await server.handle({
    jsonrpc: '2.0', id: 52, method: 'tools/call',
    params: { name: 'ask_page', arguments: { tabId: 't1', method: 'Page.captureScreenshot' } }
  });
  const payload = JSON.parse(res.result.content[0].text);

  assert.equal(payload.result.params.format, 'png');
});

test('ask_page refuses anything that could act, and says what it may ask', async () => {
  const c = ctx();
  c.driver.ask = async () => ({ never: true });
  c.resolveTab = async () => ['t1'];
  c.open = async () => c.driver;
  const server = createMcpServer(c);

  for (const method of ['Runtime.evaluate', 'Input.dispatchKeyEvent', 'Page.navigate', 'DOM.setFileInputFiles']) {
    const res = await server.handle({
      jsonrpc: '2.0', id: 53, method: 'tools/call',
      params: { name: 'ask_page', arguments: { tabId: 't1', method } }
    });
    assert.match(res.error?.message ?? '', /read-only/, `${method} must be refused as an action`);
    assert.match(res.error?.message ?? '', /Page.getFrameTree/, 'and the refusal lists what is allowed');
  }
  assert.ok(!c.driver.calls.some((call) => call[0] === 'ask'), 'nothing reached the browser');
});

