// @last-edited: 2026-10-13 UTC+7.
// @title: local-poll-server — the held poll, the queue and the liveness clock, proven on loopback.
// @state: the whole module, driven by real HTTP requests from this process.
// @dependencies: node:test, strict, ../local/poll-server.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPollBridge, LINK_ERROR, POLL_STALE_MS } from '../local/poll-server.js';

async function poll(port) {
  const response = await fetch(`http://127.0.0.1:${port}/poll`, { method: 'POST' });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

test('an empty poll holds instead of answering, so a command costs one request', async () => {
  const bridge = createPollBridge({ port: 0 });
  await bridge.listen();
  const { port } = bridge.address();

  const held = poll(port);
  await new Promise((r) => setTimeout(r, 80));
  bridge.enqueue({ id: 1, tabs: { op: 'list' } });

  const answer = await held;
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { id: 1, tabs: { op: 'list' } });

  await bridge.close();
});

test('a command queued before the poll arrives is waiting when it does', async () => {
  const bridge = createPollBridge({ port: 0 });
  await bridge.listen();
  const { port } = bridge.address();

  bridge.enqueue({ id: 7, method: 'Page.bringToFront' });
  const answer = await poll(port);

  assert.equal(answer.status, 200);
  assert.equal(answer.body.method, 'Page.bringToFront');
  await bridge.close();
});

test('a reply settles the caller waiting on that id', async () => {
  const bridge = createPollBridge({ port: 0 });
  await bridge.listen();
  const { port } = bridge.address();

  const settled = new Promise((resolve) => bridge.settleWhen('42', resolve));
  const answer = poll(port);
  bridge.enqueue({ id: 42, tabs: { op: 'list' } });
  await answer;

  await fetch(`http://127.0.0.1:${port}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 42, result: [{ id: 5 }] })
  });

  assert.deepEqual((await settled).result, [{ id: 5 }]);
  await bridge.close();
});

test('a worker is live while it polls and stale once it stops', async () => {
  const bridge = createPollBridge({ port: 0 });
  await bridge.listen();
  const { port } = bridge.address();

  assert.equal(bridge.linked(), false, 'nothing has polled yet');
  void poll(port).catch(() => {});
  const deadline = Date.now() + 2000;
  while (!bridge.linked() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.equal(bridge.linked(), true);

  const settledAt = bridge.polledAt();
  assert.equal(bridge.linked(settledAt + POLL_STALE_MS - 1000), true);
  assert.equal(bridge.linked(settledAt + POLL_STALE_MS + 1000), false, 'a silent worker goes stale');

  await bridge.close();
});

test('waiting for a worker that never comes says so instead of hanging', async () => {
  const bridge = createPollBridge({ port: 0 });
  await bridge.listen();
  assert.equal(await bridge.waitForLink({ timeoutMs: 120 }), false);
  await bridge.close();
});

test('a GET is refused: this conversation speaks POST or nothing', async () => {
  const bridge = createPollBridge({ port: 0 });
  await bridge.listen();
  const { port } = bridge.address();
  const response = await fetch(`http://127.0.0.1:${port}/poll`);
  assert.equal(response.status, 405);
  await bridge.close();
});

test('closing settles what is still waiting, which is the only humane way to stop', async () => {
  const bridge = createPollBridge({ port: 0 });
  await bridge.listen();
  const settled = new Promise((resolve) => bridge.settleWhen('9', resolve));
  bridge.enqueue({ id: 9, tabs: { op: 'list' } });
  await bridge.close();
  assert.equal((await settled).error.message, 'bridge closed');
});

test('the dead-link sentence names the one fix a person can perform', () => {
  assert.match(LINK_ERROR, /not connected/);
  assert.match(LINK_ERROR, /driver/);
});