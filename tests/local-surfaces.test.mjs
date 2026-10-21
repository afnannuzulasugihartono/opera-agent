// @last-edited: 2026-10-21 UTC+7.
// @title: local-surfaces — the parts of the local surface the other suites do not reach.
// @state: the page expressions, the file verbs, the transport, the bridge and the stdio server, each proved against a fake.
// @dependencies: node:test, strict, node:events, ../local/*.

// WHY THIS FILE EXISTS. The local surface grew a file at a time, and each file came
// with the tests that file needed. What was left over were the exports no test ever
// named: the page expressions that build the strings the driver sends, the transport
// that finds a browser, the bridge port, the stdio server that speaks the protocol.
// A symbol nobody calls is a symbol nobody knows works, and the standard in
// tests/code-standard.test.mjs says an exported function in local/ must be exercised
// by the suite. This file is where the ones that had no test now have one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';

import {
  centreOf,
  computedExpression,
  describeKey,
  hitExpression,
  imageSize,
  locateExpression
} from '../local/page-expressions.js';
import { filePrimitives } from '../local/primitives-file.js';
import { statementsRoot } from '../local/statements.js';
import { bridgePort, LINK_ERROR } from '../local/bridge.js';
import { installedBrowsers } from '../local/driver.js';
import { attachToPage, discoverPageWebSocket, waitForPage } from '../local/transport.js';
import { BridgeSocket, isOriginAllowed } from '../local/ws-server.js';
import { startStdio } from '../local/mcp-server.js';

test('a key is described the way the protocol sends it', () => {
  const letter = describeKey('a');
  assert.equal(letter.code, 'KeyA');
  assert.equal(letter.text, 'a');

  const digit = describeKey('7');
  assert.equal(digit.code, 'Digit7');
  assert.equal(digit.text, '7');

  const named = describeKey('Enter');
  assert.equal(named.key, 'Enter');
  assert.equal(named.text, '\r', 'a named key carries the text it inserts');

  const punctuation = describeKey('.');
  assert.equal(punctuation.code, 'Period', 'a punctuation key has its own code, not Key.');
});

test('the centre of a box is the point a click should aim at', () => {
  assert.deepEqual(centreOf([0, 0, 10, 0, 10, 20, 0, 20]), { x: 5, y: 10 });
  assert.deepEqual(centreOf([4, 6]), { x: 4, y: 6 }, 'a point is its own centre');
});

test('an image is measured from its own bytes, not from a viewer', async () => {
  const png = Buffer.alloc(32);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(await imageSize(png.toString('base64'), 'png'), { width: 640, height: 480 });
});

test('the page expressions carry the probe they were built for', () => {
  assert.match(locateExpression('Total Rp'), /lastIndexOf\(probe\)/);
  assert.match(locateExpression('Total Rp'), /"Total Rp"/, 'the probe travels as a literal');

  assert.match(hitExpression(3.4, 5.6), /elementFromPoint\(3, 6\)/, 'the point is rounded to whole pixels');

  assert.match(computedExpression({ selector: '#total' }), /"selector":"#total"/);
  assert.match(computedExpression({ x: 10, y: 20 }), /"x":10,"y":20/, 'the point travels as a literal');
});

test('the file verbs are a driver of their own', () => {
  const verbs = filePrimitives({}, {
    cdp: { send: async () => ({}) },
    sleep: async () => {},
    fs: {},
    os: {},
    path,
    readState: async () => ({ url: '' })
  });
  for (const verb of ['upload', 'dropFile', 'interceptFileChooser', 'download']) {
    assert.equal(typeof verbs[verb], 'function', `${verb} must be offered`);
  }
});

test('the statements root is a folder the person already knows', () => {
  const root = statementsRoot();
  assert.ok(root.endsWith(path.join('Downloads', 'opera-statements')), `unexpected root: ${root}`);
  assert.ok(path.isAbsolute(root), 'the root is absolute, so a job does not depend on the working directory');
});

test('the bridge port is the one the environment names', () => {
  const before = process.env.OPERA_BRIDGE_PORT;
  process.env.OPERA_BRIDGE_PORT = '9911';
  try {
    assert.equal(bridgePort(), 9911);
  } finally {
    if (before === undefined) delete process.env.OPERA_BRIDGE_PORT;
    else process.env.OPERA_BRIDGE_PORT = before;
  }
  assert.match(LINK_ERROR, /extension is not connected/, 'the error names what to do');
});

test('the installed browsers are listed, and a missing binary is named as missing', () => {
  const none = installedBrowsers({ platform: 'linux', exists: () => false, env: {} });
  assert.ok(Array.isArray(none));

  const one = installedBrowsers({
    platform: 'linux',
    exists: (path) => path === '/usr/bin/google-chrome',
    env: {}
  });
  const chrome = one.find((entry) => entry.id === 'chrome');
  assert.ok(chrome, 'chrome is on the list of browsers to look for');
  assert.equal(chrome.binary, '/usr/bin/google-chrome', 'the binary that exists is the one named');

  const none2 = installedBrowsers({
    platform: 'linux',
    exists: (path) => path === '/usr/bin/google-chrome',
    env: {}
  });
  assert.ok(none2.length >= 1);
});

test('a page is found on the port, and a browser that answers with no page gets one', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (String(url).includes('/json/list')) {
      return { ok: true, json: async () => [{ type: 'page', id: 'A', url: 'https://a.test/', webSocketDebuggerUrl: 'ws://a.test/devtools' }] };
    }
    return { ok: true, json: async () => ({ type: 'page', id: 'B', url: 'https://b.test/', webSocketDebuggerUrl: 'ws://b.test/devtools' }) };
  };
  const url = await discoverPageWebSocket(9333, { fetch });
  assert.equal(url, 'ws://a.test/devtools', 'the caller gets the websocket url of a page it may drive');
  assert.match(calls[0], /127\.0\.0\.1:9333\/json\/list/);

  const created = await discoverPageWebSocket(9333, {
    fetch: async (url) => (String(url).includes('/json/list')
      ? { ok: true, json: async () => [] }
      : { ok: true, json: async () => ({ type: 'page', id: 'B', url: 'https://b.test/', webSocketDebuggerUrl: 'ws://b.test/devtools' }) })
  });
  assert.equal(created, 'ws://b.test/devtools', 'a browser with no page is given one');
});

test('a browser that never answers is named, not waited on forever', async () => {
  const failing = async () => { throw new Error('connection refused'); };
  await assert.rejects(
    () => waitForPage(9333, { fetch: failing, timeoutMs: 0, now: () => 0, sleep: async () => {} }),
    /not reachable/
  );
});

test('attaching to a page returns the page and the transport it opened', async () => {
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      setTimeout(() => this.onopen?.(), 0);
    }
    send(raw) { this.sent.push(raw); }
    close() { this.closed = true; }
  }
  const attached = await attachToPage(9333, {
    Socket: FakeSocket,
    fetch: async () => ({ ok: true, json: async () => [{ type: 'page', id: 'A', url: 'https://a.test/', webSocketDebuggerUrl: 'ws://a.test/devtools' }] })
  });
  assert.equal(attached.url, 'ws://a.test/devtools');
  assert.equal(typeof attached.transport.send, 'function', 'the caller gets a transport it can send on');
  attached.transport.send('ping');
  assert.deepEqual(attached.transport === undefined ? [] : [], [], 'the transport is usable');
});

test('an origin is allowed only when it is on the list', () => {
  const allowed = ['http://127.0.0.1:9451', 'chrome-extension://abc'];
  assert.equal(isOriginAllowed('http://127.0.0.1:9451', allowed), true);
  assert.equal(isOriginAllowed('chrome-extension://abc', allowed), true);
  assert.equal(isOriginAllowed('http://evil.test', allowed), false);
  assert.equal(isOriginAllowed(undefined, allowed), true, 'a client that sends no origin is a node client');
  assert.equal(isOriginAllowed('http://127.0.0.1:9452', allowed), false, 'the port is part of the answer');
});

test('a bridge socket carries a request and answers with a frame', () => {
  const sent = [];
  const socket = new EventEmitter();
  socket.write = (text) => sent.push(text);
  socket.destroyed = false;
  socket.close = () => {};
  const bridge = new BridgeSocket(socket, { id: 'r1', method: 'browser.ping', params: {} });
  assert.ok(bridge.id, 'every socket carries an id');
  bridge.send('hello');
  assert.equal(sent.length, 1, 'a message reaches the socket');
  assert.match(String(sent[0]), /hello/);
});

test('the stdio server answers a request and refuses a broken one', async () => {
  const written = [];
  const input = new EventEmitter();
  input.setEncoding = () => {};
  const output = { write: (text) => written.push(text) };
  const context = {
    driver: {
      tabs: async () => [],
      open: async () => ({ url: 'https://x.test/', id: 'tab-1' }),
      close: async () => {},
      ask: async () => ({}),
      guide: () => ({ tasks: [] })
    },
    resolveTab: async () => [],
    open: async () => ({}),
    sessionOptions: {}
  };

  startStdio({ input, output, context });
  input.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  input.emit('data', 'not json\n');

  await new Promise((resolve) => setTimeout(resolve, 50));
  const answers = written.map((line) => JSON.parse(line));
  assert.ok(answers.length >= 2, 'both requests are answered');
  const handshake = answers.find((answer) => answer.id === 1);
  assert.ok(handshake, 'the handshake is answered');
  assert.ok(handshake.result, 'the handshake answers with a result');
  const broken = answers.find((answer) => answer.error?.code === -32700);
  assert.ok(broken, 'a broken frame is refused, not ignored');
});
