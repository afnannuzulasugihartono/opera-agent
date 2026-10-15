// @last-edited: 2026-10-12 UTC+7.
// @title: transport tests — a drive names its tab, because "the first page" is not a target.
// @dependencies: none.

import test from 'node:test';
import assert from 'node:assert/strict';

import { listPageWebSockets, pageWebSocketById } from '../local/transport.js';
import { openSession } from '../local/driver.js';

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

// A session that names its tab must land on that tab's socket, not the first
// page's. Measured live: every tabId call before this fix drove the same first
// tab, because the session resolved before it looked at the name.

function stubBrowser(sockets) {
  const realFetch = globalThis.fetch;
  const realSocket = globalThis.WebSocket;
  globalThis.fetch = fakeFetch(PAGES);
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

test('a session that names its tab connects to that tab, never the first page', async () => {
  const sockets = [];
  const restore = stubBrowser(sockets);
  try {
    const session = await openSession({ port: 1, targetId: 'BBB', launch: false, env: { OPERA_LOCAL_TRANSPORT: 'cdp' } });
    assert.deepEqual(sockets, ['ws://x/bbb']);
    assert.equal(session.reused, true);
    session.close();
  } finally {
    restore();
  }
});

test('a session that names nothing keeps the first page', async () => {
  const sockets = [];
  const restore = stubBrowser(sockets);
  try {
    const session = await openSession({ port: 1, launch: false, env: { OPERA_LOCAL_TRANSPORT: 'cdp' } });
    assert.deepEqual(sockets, ['ws://x/aaa']);
    session.close();
  } finally {
    restore();
  }
});

test('a session that names an unknown tab fails without launching anything', async () => {
  const sockets = [];
  const restore = stubBrowser(sockets);
  let spawned = 0;
  try {
    await assert.rejects(
      () => openSession({ port: 1, targetId: 'NOPE', launch: true, spawnBrowser: () => { spawned += 1; }, env: { OPERA_LOCAL_TRANSPORT: 'cdp' } }),
      /No page target NOPE/
    );
    assert.equal(spawned, 0);
    assert.deepEqual(sockets, []);
  } finally {
    restore();
  }
});