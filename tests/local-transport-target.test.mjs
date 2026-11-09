// @last-edited: 2026-10-21 UTC+7.
// @title: local-transport-target.test — a drive names its tab, because the first page is not a target.
// @state: the tab a target names, and the socket it is looked up in.
// @dependencies: none.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { listPageWebSockets, pageWebSocketById } from '../local/transport.js';
import { openSession } from '../local/driver.js';
import { closeBridge } from '../local/bridge.js';

const PAGES = [
  { id: 'AAA', type: 'page', title: 'Untitled document', url: 'https://docs.google.com/a', webSocketDebuggerUrl: 'ws://x/aaa' },
  { id: 'BBB', type: 'page', title: 'Create account', url: 'https://auth.wikimedia.org/b', webSocketDebuggerUrl: 'ws://x/bbb' },
  { id: 'CCC', type: 'iframe', title: 'frame', webSocketDebuggerUrl: 'ws://x/ccc' },
  { id: 'DDD', type: 'page', title: 'no socket', webSocketDebuggerUrl: undefined }
];

const fakeFetch = (body) => async () => ({ ok: true, json: async () => body });

test('only page targets with a websocket are listed', async () => {
  const pages = await listPageWebSockets(1, { fetch: fakeFetch(PAGES) });
  assert.deepEqual(pages.map((p) => p.id), ['AAA', 'BBB']);
});

test('a named tab resolves to its own socket', async () => {
  const chosen = await pageWebSocketById(1, 'BBB', { fetch: fakeFetch(PAGES) });
  assert.equal(chosen.url, 'ws://x/bbb');
  assert.equal(chosen.targetId, 'BBB');
});

test('no name resolves to the first page, and says so', async () => {
  const chosen = await pageWebSocketById(1, undefined, { fetch: fakeFetch(PAGES) });
  assert.equal(chosen.targetId, 'AAA');
});

test('an unknown tab is refused with the open tabs named', async () => {
  await assert.rejects(
    () => pageWebSocketById(1, 'NOPE', { fetch: fakeFetch(PAGES) }),
    (error) => {
      assert.match(error.message, /No page target NOPE/);
      assert.match(error.message, /AAA/);
      assert.match(error.message, /BBB/);
      return true;
    }
  );
});

test('a browser with no page target fails loudly', async () => {
  await assert.rejects(
    () => pageWebSocketById(1, 'AAA', { fetch: fakeFetch([{ id: 'Z', type: 'iframe', webSocketDebuggerUrl: 'ws://x/z' }]) }),
    /no page target to drive/
  );
});

// A session that names its tab must land on that tab's socket, not the first page's.
// Measured live: every tabId call before this fix drove the same first tab, because the session resolved before it looked at the name.

function stubBrowser(sockets, { reachable = true, urls = [] } = {}) {
  const realFetch = globalThis.fetch;
  const realSocket = globalThis.WebSocket;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (!reachable) throw new Error('connection refused');
    return fakeFetch(PAGES)(url);
  };
  globalThis.WebSocket = class {
    constructor(url) {
      sockets.push(url);
      queueMicrotask(() => this.onopen?.());
    }
    send() {}
    close() {}
  };
  return () => {
    globalThis.fetch = realFetch;
    globalThis.WebSocket = realSocket;
  };
}

// WHY THE PORT ROAD IS GONE AND THE LINK IS THE ONLY WAY.
// Chrome refuses a debugging port on the profile the person is signed into, so that road could only ever open a fresh profile with nothing in it.
// The bridge reaches the everyday profile at the same speed, over the same commands, and it is the road the plan is metered on.

test('a session with no extension linked fails with the link error that names the extension', async () => {
  const sockets = [];
  const restore = stubBrowser(sockets, { reachable: false });
  try {
    await assert.rejects(() => openSession({}), /extension is not connected/);
    assert.deepEqual(sockets, [], 'no socket is opened when there is no extension to talk to');
  } finally {
    restore();
  }
});

test('a session never opens a debugging port', async () => {
  const sockets = [];
  const urls = [];
  const restore = stubBrowser(sockets, { reachable: false, urls });
  try {
    await assert.rejects(() => openSession({}), /extension is not connected/);
    assert.equal(urls.some((url) => url.includes(':9333')), false, 'no debugging port is asked for');
  } finally {
    restore();
  }
});

test('the driver has no port road left in it', () => {
  const driver = fs.readFileSync(new URL('../local/driver.js', import.meta.url), 'utf8');
  assert.doesNotMatch(driver, /OPERA_LOCAL_TRANSPORT/, 'the transport switch is gone');
  assert.doesNotMatch(driver, /remote-debugging-port/, 'the driver launches no browser');
  assert.doesNotMatch(driver, /spawnBrowser/, 'and it spawns nothing');
});
test.after(async () => { await closeBridge(); });
