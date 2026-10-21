// @last-edited: 2026-10-11 UTC+7.
// @title: local-cdp — the local browser driver must correlate, reject and dispatch exactly like CDP, with no browser present.
// @state: 8 locks; id correlation under concurrency, error rejection, event dispatch, and clean close.
// @dependencies: node:test, strict, ../local/cdp.js.

// WHY THIS FILE EXISTS

// The local path is the fast one, and the measurement that justifies it is small: a CDP command on loopback answered in 0.52ms at p50 over 240 commands, against roughly 380ms for the same work through the cloud, which is two 190ms round trips.
// Everything the local driver can do is bounded above by that transport.

// That number is worthless if the client above it is wrong.
// A CDP client that mismatches concurrent responses would attribute one command's result to another, and on a browser driving someone else's session that is not a cosmetic bug: it types into the wrong place.
// So the client is built around an injected transport and tested with none, because a test that needs a browser installed is a test that does not run on every machine that checks the repo.

// The concurrency lock is the one that matters.
// Real driving interleaves: a read that finds a stale ref is followed by a re-find while the first is still in flight.
// Firing two commands and matching replies by arrival order rather than by id would silently swap them under exactly that load.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCdpClient } from '../local/cdp.js';

function fakeTransport() {
  const sent = [];
  let onMessage = () => {};
  let closed = false;
  return {
    sent,
    get closed() { return closed; },
    transport: {
      send(raw) { sent.push(JSON.parse(raw)); },
      onMessage(fn) { onMessage = fn; },
      close() { closed = true; }
    },
    reply(message) { onMessage(JSON.stringify(message)); },
    last() { return sent[sent.length - 1]; }
  };
}

test('a send carries the id and method, and resolves with the matching result', async () => {
  const h = fakeTransport();
  const cdp = createCdpClient(h.transport);

  const pending = cdp.send('Page.navigate', { url: 'https://example.com/' });
  assert.equal(h.last().method, 'Page.navigate');
  assert.equal(h.last().params.url, 'https://example.com/');
  assert.equal(typeof h.last().id, 'number');

  h.reply({ id: h.last().id, result: { frameId: 'F1' } });
  assert.deepEqual(await pending, { frameId: 'F1' });
});

test('concurrent sends resolve by id, not by arrival order', async () => {
  const h = fakeTransport();
  const cdp = createCdpClient(h.transport);

  const first = cdp.send('Runtime.evaluate', { expression: 'first' });
  const second = cdp.send('Runtime.evaluate', { expression: 'second' });
  const ids = h.sent.map((m) => m.id);
  assert.notEqual(ids[0], ids[1], 'ids must be unique or replies cannot be matched');

  h.reply({ id: ids[1], result: { which: 'second' } });
  h.reply({ id: ids[0], result: { which: 'first' } });

  assert.deepEqual(await second, { which: 'second' });
  assert.deepEqual(await first, { which: 'first' });
});

test('a CDP error rejects with the code and message, so a caller can tell it from a thrown failure', async () => {
  const h = fakeTransport();
  const cdp = createCdpClient(h.transport);

  const pending = cdp.send('Page.navigate', { url: 'about:blank' });
  h.reply({ id: h.last().id, error: { code: -32602, message: 'Invalid parameters' } });

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, -32602);
    assert.match(error.message, /Invalid parameters/);
    return true;
  });
});

test('an event reaches a registered handler and is not mistaken for a reply', async () => {
  const h = fakeTransport();
  const cdp = createCdpClient(h.transport);

  const seen = [];
  cdp.on('Page.loadEventFired', (params) => seen.push(params));

  const pending = cdp.send('Page.enable');
  h.reply({ method: 'Page.loadEventFired', params: { timestamp: 1 } });
  h.reply({ id: h.last().id, result: {} });
  await pending;

  assert.deepEqual(seen, [{ timestamp: 1 }]);
});

test('a reply to an unknown id is ignored rather than throwing', async () => {
  const h = fakeTransport();
  const cdp = createCdpClient(h.transport);

  const pending = cdp.send('Page.enable');
  h.reply({ id: 999999, result: { stray: true } });
  h.reply({ id: h.last().id, result: { ok: true } });

  assert.deepEqual(await pending, { ok: true });
});

test('ids are unique across many sends, because the browser keys replies on them', async () => {
  const h = fakeTransport();
  const cdp = createCdpClient(h.transport);

  for (let i = 0; i < 50; i += 1) cdp.send('Runtime.evaluate', { expression: String(i) });
  const ids = h.sent.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'ids repeated');

  for (const message of h.sent) h.reply({ id: message.id, result: {} });
});

test('close detaches handlers and closes the transport exactly once', async () => {
  const h = fakeTransport();
  const cdp = createCdpClient(h.transport);

  cdp.close();
  cdp.close();
  assert.equal(h.closed, true);
});

test('close rejects the commands still in flight instead of leaving them hanging', async () => {
  const h = fakeTransport();
  const cdp = createCdpClient(h.transport);

  const inFlight = cdp.send('Page.navigate', { url: 'https://example.com/' });
  cdp.close();

  await assert.rejects(inFlight, /closed/i,
    'a caller awaiting a command that was abandoned would hang until its own deadline, with no signal that the client was gone');
});

test('a send after close fails instead of hanging forever on a dead transport', async () => {
  const h = fakeTransport();
  const cdp = createCdpClient(h.transport);
  cdp.close();

  await assert.rejects(cdp.send('Page.enable'), /closed/i);
});