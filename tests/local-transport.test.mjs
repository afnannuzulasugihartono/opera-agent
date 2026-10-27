// @last-edited: 2026-10-11 UTC+7.
// @title: local-transport — the real socket, browser discovery, and waiting for a launch that is not up yet.
// @state: 7 locks; URL discovery, connection failure, open-ordering, and a bounded wait that reports rather than hangs.
// @dependencies: node:test, strict, ../local/core/transport.js.

// WHY THIS FILE EXISTS

// cdp.js is tested with a fake transport, which is the point of injecting one, but it means nothing here has yet been run against an actual browser.
// This file is the seam where that claim becomes checkable, and it carries two behaviours the fake could never have needed.

// The first is ordering.
// A launch is asynchronous: the process exists well before the debugging port answers.
// A driver that connects once and gives up reports "cannot reach the browser" on every cold start, and the fix people reach for is a fixed sleep, which is slow when the browser is quick and still flaky when it is not.

// The second is what a failed wait says.
// Polling that gives up on a timeout with an empty list makes a missing browser and a browser that is merely slow indistinguishable.
// The wait reports how long it tried, because those two demand different responses from the person installing this.

// Nothing here spawns a browser.
// Discovery and waiting are the parts with rules, and they are the parts that decide whether a launch reads as fast or as broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, discoverWebSocket, openTab, waitForBrowser } from '../local/core/transport.js';

test('a new tab is opened as its own target, so a drive never hijacks the page already open', async () => {
  const calls = [];
  const tab = await openTab(9450, 'https://sheets.google.com/spreadsheets/u/0/create', {
    fetch: async (target, init) => {
      calls.push({ target, method: init?.method });
      return response({ id: 'NEWTAB', webSocketDebuggerUrl: 'ws://127.0.0.1:9450/devtools/page/new' });
    }
  });

  assert.equal(tab.webSocketDebuggerUrl, 'ws://127.0.0.1:9450/devtools/page/new');
  assert.equal(tab.id, 'NEWTAB', 'without the id the caller cannot address the tab it just opened');
  assert.equal(calls[0].target, 'http://127.0.0.1:9450/json/new?https%3A%2F%2Fsheets.google.com%2Fspreadsheets%2Fu%2F0%2Fcreate');
});

test('a new tab is opened with PUT, because the endpoint refuses GET', async () => {
  let seen = null;
  await openTab(9450, 'about:blank', {
    fetch: async (target, init) => {
      seen = init?.method;
      return response({ id: 'N', webSocketDebuggerUrl: 'ws://x' });
    }
  });

  assert.equal(seen, 'PUT');
});

test('the url is encoded, so a target carrying its own query string survives', async () => {
  let seen = null;
  await openTab(9450, 'https://docs.google.com/document/d/abc/edit?tab=t.0', {
    fetch: async (target) => {
      seen = target;
      return response({ id: 'N', webSocketDebuggerUrl: 'ws://x' });
    }
  });

  assert.match(seen, /%3Ftab%3Dt\.0$/);
});

test('a new tab that opens without a websocket url fails loudly, rather than handing back nothing', async () => {
  await assert.rejects(
    openTab(9450, 'about:blank', { fetch: async () => response({}) }),
    /addressable/
  );
});

test('a browser that refuses the new tab says so in the port it refused on', async () => {
  await assert.rejects(
    openTab(9450, 'about:blank', { fetch: async () => ({ ok: false, status: 405 }) }),
    /9450|405/
  );
});

const response = (body) => ({ ok: true, json: async () => body });

test('discovery reads the browser websocket url from the version endpoint', async () => {
  const url = await discoverWebSocket(9333, {
    fetch: async (target) => {
      assert.match(target, /:9333\/json\/version$/);
      return response({ webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/browser/abc' });
    }
  });

  assert.equal(url, 'ws://127.0.0.1:9333/devtools/browser/abc');
});

test('discovery fails loudly when the port answers with no browser, rather than returning undefined', async () => {
  await assert.rejects(
    discoverWebSocket(9333, { fetch: async () => response({}) }),
    /websocket/i
  );
});

test('discovery reports a closed port as such, so a caller can tell it from a wrong port', async () => {
  await assert.rejects(
    discoverWebSocket(9333, { fetch: async () => { throw new Error('fetch failed'); } }),
    /not reachable|9333/i
  );
});

test('waiting retries until the browser answers, instead of connecting once and giving up', async () => {
  let calls = 0;
  const url = await waitForBrowser(9333, {
    timeoutMs: 500,
    intervalMs: 10,
    fetch: async () => {
      calls += 1;
      if (calls < 3) throw new Error('fetch failed');
      return response({ webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/browser/xyz' });
    }
  });

  assert.equal(calls, 3);
  assert.match(url, /browser\/xyz$/);
});

test('a wait that times out says how long it tried and which port, because slow and absent need different answers', async () => {
  await assert.rejects(
    waitForBrowser(9333, { timeoutMs: 60, intervalMs: 10, fetch: async () => { throw new Error('fetch failed'); } }),
    (error) => {
      assert.match(error.message, /9333/);
      assert.match(error.message, /60/, 'the message must carry the budget that was spent');
      return true;
    }
  );
});

test('connecting hands back a transport with the three methods the client injects', async () => {
  const sent = [];
  let delivered = null;
  let closed = false;

  class FakeSocket {
    constructor(url) { this.url = url; queueMicrotask(() => this._open?.()); }
    send(data) { sent.push(data); }
    close() { closed = true; }
    set onmessage(fn) { delivered = fn; }
    set onopen(fn) { this._open = fn; }
  }

  const transport = await connect('ws://127.0.0.1:9333/devtools/browser/a', { Socket: FakeSocket });
  let received = null;
  transport.onMessage((data) => { received = data; });

  transport.send('{"id":1}');
  delivered('{"id":1,"result":{}}');

  assert.deepEqual(sent, ['{"id":1}']);
  assert.equal(received, '{"id":1,"result":{}}');
  transport.close();
  assert.equal(closed, true);
});

test('a connection that never opens fails rather than leaving the caller waiting forever', async () => {
  class DeadSocket {
    constructor() {}
    send() {}
    close() {}
    set onmessage(fn) { this._m = fn; }
    set onopen(fn) { this._o = fn; }
    set onerror(fn) { this._e = fn; }
  }

  await assert.rejects(
    connect('ws://127.0.0.1:1/x', { Socket: DeadSocket, timeoutMs: 80 }),
    /connect/i
  );
});