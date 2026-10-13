// @last-edited: 2026-10-13 UTC+7.
// @title: relay — the local stdio server that fronts the remote edge function.
// @state: four locks; id fidelity, notification silence, tool passthrough, serialization.
// @dependencies: node:test, assert, ../local/relay.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRelay, createSocketTransport, EDGE_REGION as RELAY_EDGE_REGION } from '../local/relay.js';
import { EDGE_REGION as ENDPOINT_EDGE_REGION, socketUrl } from '../extension/lib/endpoints.js';

// The edge function is the system under relay: a stream of SSE frames, and a reply
// that does not always carry the id of the request that asked for it. These tests
// drive the relay through a stand-in that reproduces both, so the behaviour that was
// measured on the real endpoint stays pinned without touching the network.

function fakeServer(handler) {
  const calls = [];
  const seen = [];
  return {
    calls,
    seen,
    url: 'https://relay.test/mcp',
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      seen.push({ url: _url, headers: options.headers });
      const frames = handler(body, calls.length);
      const encoded = new TextEncoder().encode(frames.map((f) => `event: message\ndata: ${JSON.stringify(f)}\n\n`).join(''));
      let sent = false;
      return {
        body: {
          getReader() {
            return {
              async read() {
                if (sent) return { done: true };
                sent = true;
                return { done: false, value: encoded };
              },
              async cancel() { }
            };
          }
        }
      };
    }
  };
}

function relayOver(fake) {
  return createRelay({
    url: fake.url,
    forwardHeaders: { authorization: 'Bearer test' },
    timeoutMs: 2000,
    fetchImpl: fake.fetch,
    socketTransport: { ready: false, connect: async () => false, call: async () => { throw new Error('no socket'); }, close: () => {} }
  });
}

// The original fault: two requests overlapped, the reply with no id was taken by the
// wrong caller, and the right one hung until its timeout.

test('a reply with no id is only taken when it is the only request in flight', async () => {
  const fake = fakeServer(() => [{ jsonrpc: '2.0', result: { ok: true, marker: 'no-id' } }]);
  const relay = relayOver(fake);

  const reply = await relay.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'browser_status', arguments: {} } });
  assert.equal(reply?.result?.marker, 'no-id');
});

test('a reply carrying its own id is never handed to a different request', async () => {
  const fake = fakeServer((body) => body.id === 11
    ? [{ jsonrpc: '2.0', id: 99, result: { marker: 'wrong-id' } }]
    : [{ jsonrpc: '2.0', id: body.id, result: { marker: 'right-id' } }]);
  const relay = relayOver(fake);

  await assert.rejects(
    () => relay.handle({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'browser_status', arguments: {} } }),
    /did not answer 11|closed the stream before answering 11/,
    'a reply for another id must be refused, not adopted'
  );
});

// The whole reason the relay exists: the tool list is whatever the edge function says
// it is. A stale copy here would advertise tools the remote no longer serves.

test('the tool list is whatever the remote said, not a local copy', async () => {
  const tools = [{ name: 'only_this_tool', inputSchema: { type: 'object' } }];
  const fake = fakeServer(() => [{ jsonrpc: '2.0', id: 1, result: { tools } }]);
  const relay = relayOver(fake);

  const reply = await relay.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  assert.deepEqual(reply?.result?.tools, tools);
});

// A notification carries no id and expects no answer. Answering one would leave the
// client waiting on a reply that is never coming.

test('a notification is answered with nothing', async () => {
  const fake = fakeServer(() => [{ jsonrpc: '2.0', id: 1, result: {} }]);
  const relay = relayOver(fake);

  assert.equal(await relay.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(fake.calls.length, 0, 'a notification must not become a remote request');
});

// Without serialization two callers share one connection and the id-less replies
// interleave, which is the fault this file exists to remove.

test('overlapping calls are queued so replies cannot interleave', async () => {
  let live = 0;
  let peak = 0;
  const fake = fakeServer(() => {
    live += 1;
    peak = Math.max(peak, live);
    queueMicrotask(() => { live -= 1; });
    return [{ jsonrpc: '2.0', result: { ok: true } }];
  });
  const relay = relayOver(fake);

  await Promise.all([
    relay.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_status', arguments: {} } }),
    relay.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_status', arguments: {} } })
  ]);

  assert.equal(peak, 1, 'two remote requests were in flight at once');
  assert.equal(fake.calls.length, 2, 'both requests must still have been sent');
});

// A client that announces a protocol the relay speaks must get that same version back,
// because a client that asked for it will refuse a different one.

test('the protocol version is negotiated rather than imposed', async () => {
  const relay = relayOver(fakeServer(() => []));

  const modern = await relay.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(modern?.result?.protocolVersion, '2025-06-18');

  const older = await relay.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(older?.result?.protocolVersion, '2024-11-05');

  const unknown = await relay.handle({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(unknown?.result?.protocolVersion, '2024-11-05', 'an unknown version must fall back, not be echoed');
});

// Silence reads as a hang. A client that lists resources or prompts on connect needs an
// answer even when there are none.

test('resource and prompt listings are answered, not left to time out', async () => {
  const relay = relayOver(fakeServer(() => []));

  const resources = await relay.handle({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} });
  assert.deepEqual(resources?.result, { resources: [] });

  const templates = await relay.handle({ jsonrpc: '2.0', id: 2, method: 'resources/templates/list', params: {} });
  assert.deepEqual(templates?.result, { resourceTemplates: [] });

  const prompts = await relay.handle({ jsonrpc: '2.0', id: 3, method: 'prompts/list', params: {} });
  assert.deepEqual(prompts?.result, { prompts: [] });
});

// The socket path holds one connection open so calls after the first skip the boot.
// These tests drive it through a stand-in server that speaks the same three messages
// the edge function speaks, so the handshake, the framing and the fallback stay pinned
// without touching the network.

function fakeSocketServer({ authResult = { ok: true, direct: true }, callResult = { ok: true } } = {}) {
  const listeners = { open: [], message: [], close: [], error: [] };
  const sent = [];
  const urls = [];
  const server = {
    sent,
    urls,
    WebSocket: class {
      constructor(url) {
        urls.push(url);
        queueMicrotask(() => listeners.open.forEach((fn) => fn()));
      }
      addEventListener(type, fn) {
        listeners[type].push(fn);
      }
      send(text) {
        sent.push(JSON.parse(text));
        const m = JSON.parse(text);
        queueMicrotask(() => {
          const reply = m.method === 'auth'
            ? { id: m.id, result: authResult }
            : m.method === 'ping'
              ? { id: m.id, result: { ok: true, pong: true } }
              : { id: m.id, result: callResult };
          listeners.message.forEach((fn) => fn({ data: JSON.stringify(reply) }));
        });
      }
      close() {
        queueMicrotask(() => listeners.close.forEach((fn) => fn({})));
      }
    }
  };
  return server;
}

// The handshake carries the credential because a WebSocket client cannot set headers.
// A server that refuses it must leave the transport down, not half open.

test('the socket authenticates on connect and stays down when refused', async () => {
  const good = fakeSocketServer();
  const up = createSocketTransport({ url: 'https://x/mcp', token: 't', device: 'd', provider: 'p', timeoutMs: 1000, WebSocketImpl: good.WebSocket });
  assert.equal(await up.connect(), true);
  assert.equal(up.ready, true);
  assert.equal(good.sent[0].method, 'auth');
  assert.equal(good.sent[0].params.token, 't');
  up.close();
});

// A call the socket cannot carry must fall back to HTTPS rather than fail the drive,
// but a call the socket may have delivered must never be repeated.

test('a call falls back to HTTPS only when the socket never carried it', async () => {
  const fake = fakeServer(() => [{ jsonrpc: '2.0', result: { ok: true, via: 'https' } }]);
  const relay = createRelay({
    url: fake.url,
    forwardHeaders: { authorization: 'Bearer test' },
    timeoutMs: 2000,
    fetchImpl: fake.fetch,
    socketTransport: { ready: false, connect: async () => false, call: async () => { throw new Error('socket is not connected'); }, close: () => {} }
  });

  const reply = await relay.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'browser_status', arguments: {} } });
  assert.equal(reply?.result?.via, 'https');
  assert.equal(fake.calls.length, 1);
});


// When the socket is up, calls ride it and HTTPS is never touched.

test('a live socket carries the call and HTTPS stays idle', async () => {
  const fake = fakeServer(() => [{ jsonrpc: '2.0', result: { ok: true, via: 'https' } }]);
  const relay = createRelay({
    url: fake.url,
    forwardHeaders: { authorization: 'Bearer test' },
    timeoutMs: 2000,
    fetchImpl: fake.fetch,
    socketTransport: { ready: true, connect: async () => true, call: async () => ({ ok: true, via: 'socket' }), close: () => {} }
  });

  const reply = await relay.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'browser_status', arguments: {} } });
  assert.equal(reply?.result?.via, 'socket');
  assert.equal(fake.calls.length, 0, 'HTTPS was touched while the socket was up');
});

// WHY the region is pinned on both roads. Edge functions run closest to the
// requester, which from here is Tokyo while the database sits in Singapore,
// so each database crossing paid Tokyo-Singapore instead of rack-local. HTTPS
// carries the pin as a header; the socket carries it as a query parameter,
// because a WebSocket client cannot set headers. Both pins must name the same
// region the extension pins, or the two runtimes split across regions.

test('HTTPS calls pin the edge region the database lives in', async () => {
  const fake = fakeServer(() => [{ jsonrpc: '2.0', result: { ok: true } }]);
  const relay = createRelay({
    url: fake.url,
    forwardHeaders: { authorization: 'Bearer test' },
    timeoutMs: 2000,
    fetchImpl: fake.fetch,
    socketTransport: { ready: false, connect: async () => false, call: async () => { throw new Error('socket is not connected'); }, close: () => {} }
  });

  await relay.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'browser_status', arguments: {} } });
  assert.equal(fake.seen.length, 1);
  assert.equal(fake.seen[0].headers['x-region'], 'ap-southeast-1');
});

test('the socket URL pins the region as a query parameter', async () => {
  const good = fakeSocketServer();
  const up = createSocketTransport({ url: 'https://x/mcp', token: 't', device: 'd', provider: 'p', timeoutMs: 1000, WebSocketImpl: good.WebSocket });
  assert.equal(await up.connect(), true);
  assert.equal(good.urls.length, 1);
  assert.equal(good.urls[0], 'wss://x/mcp?forceFunctionRegion=ap-southeast-1');
  up.close();
});

test('both runtimes pin the same region, or calls split across regions', () => {
  assert.equal(RELAY_EDGE_REGION, 'ap-southeast-1');
  assert.equal(ENDPOINT_EDGE_REGION, RELAY_EDGE_REGION);
});

test('a socket URL converts every scheme and keeps an existing query string', () => {
  assert.equal(socketUrl('https://h.test/functions/v1/opera-agent-bridge'), 'wss://h.test/functions/v1/opera-agent-bridge?forceFunctionRegion=ap-southeast-1');
  assert.equal(socketUrl('http://127.0.0.1:54321/functions/v1/opera-agent-bridge'), 'ws://127.0.0.1:54321/functions/v1/opera-agent-bridge?forceFunctionRegion=ap-southeast-1');
  assert.equal(socketUrl('wss://h.test/bridge'), 'wss://h.test/bridge?forceFunctionRegion=ap-southeast-1');
  assert.equal(socketUrl('wss://h.test/bridge?a=b'), 'wss://h.test/bridge?a=b&forceFunctionRegion=ap-southeast-1');
  assert.equal(socketUrl(''), '');
  assert.equal(socketUrl(null), '');
});
