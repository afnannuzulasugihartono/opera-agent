// @last-edited: 2026-10-13 UTC+7.
// @title: local-bridge — the local bridge end, proven against a scripted worker over loopback.
// @state: tab ops, CDP round trip, error surfacing, a deaf worker, teardown.
// @dependencies: node:test, strict, ../local/bridge.js, ../local/cdp.js.

// WHY a scripted worker and not the real module here. The extension worker polls
// one fixed port, so two test files that both import it fight over the same
// replies — observed, and a green run would have meant nothing. The worker's own
// half of the conversation is proven in tests/bridge-link.test.mjs against the
// real module; this file proves the local API against a worker that behaves the
// way the real one does: poll, answer, report.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bridgeAddress,
  closeBridge,
  closeBridgeTarget,
  connectBridgeTarget,
  listBridgeTargets,
  openBridgeTarget,
  waitForBridgeLink
} from '../local/bridge.js';
import { createCdpClient } from '../local/cdp.js';

process.env.OPERA_BRIDGE_PORT = '0';

// WHY the poll is abortable. A held poll does not come back for twenty seconds,
// so a worker told to stop would keep answering the next test's commands for
// twenty seconds — observed, and it looks exactly like a flaky bridge.

async function scriptedWorker(port, handle, { answerProof = true, deaf = false } = {}) {
  let alive = true;
  let abort = null;
  const post = (id, payload) => fetch(`http://127.0.0.1:${port}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, ...payload })
  });

  const loop = (async () => {
    while (alive) {
      abort = new AbortController();
      let response;
      try {
        response = await fetch(`http://127.0.0.1:${port}/poll`, { method: 'POST', signal: abort.signal });
      } catch {
        continue;
      }
      if (response.status !== 200) continue;
      const command = await response.json();
      if (deaf) continue;
      if (command.bridge === 'ping') {
        if (answerProof) await post(command.id, { result: { pong: true } });
        continue;
      }
      let answer;
      try {
        answer = { result: await handle(command) };
      } catch (error) {
        answer = { error: { message: error?.message || String(error) } };
      }
      await post(command.id, answer);
    }
  })();
  loop.catch(() => {});

  return {
    async stop() {
      alive = false;
      abort?.abort();
      await Promise.race([loop, new Promise((resolve) => setTimeout(resolve, 250))]);
    }
  };
}

// A worker is not live until it has polled once, and the local side measures
// liveness from exactly that. Waiting here is the same wait a driver does.

async function startWorker(handle, options) {
  const { port } = await bridgeAddress();
  const worker = await scriptedWorker(port, handle, options);
  const deadline = Date.now() + 3000;
  while (!(await waitForBridgeLink({ timeoutMs: 100 })) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await waitForBridgeLink({ timeoutMs: 200 }), true, 'the worker came up');
  return worker;
}

test('a session waits for its worker instead of failing a slow extension', async () => {
  const { port } = await bridgeAddress();
  assert.equal(await waitForBridgeLink({ timeoutMs: 60 }), false);

  const worker = await scriptedWorker(port, () => []);
  const deadline = Date.now() + 3000;
  while (!(await waitForBridgeLink({ timeoutMs: 100 })) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await waitForBridgeLink({ timeoutMs: 200 }), true);

  await worker.stop();
  await closeBridge();
});

test('tab operations round-trip through the worker', async () => {
  const seen = [];
  const worker = await startWorker((command) => {
    seen.push(command);
    if (command.tabs.op === 'list') return [{ id: 7, url: 'https://x/', title: 'X' }];
    if (command.tabs.op === 'open') return { id: 8, url: command.tabs.url, title: '' };
    return { id: 8, closed: true };
  });

  assert.deepEqual(await listBridgeTargets(), [{ id: 7, url: 'https://x/', title: 'X' }]);
  assert.equal((await openBridgeTarget('https://y/')).id, 8);
  assert.deepEqual(await closeBridgeTarget(8), { id: 8, closed: true });
  assert.ok(seen.every((command) => command.id !== undefined), 'every command carries its id');
  assert.ok(!seen.some((command) => command.bridge === 'ping'), 'the liveness proof never becomes a tab op');

  await worker.stop();
  await closeBridge();
});

test('a CDP client drives through the bridge transport untouched', async () => {
  const seen = [];
  const worker = await startWorker((command) => {
    seen.push(command);
    return { value: 42 };
  });

  const transport = connectBridgeTarget(77);
  const cdp = createCdpClient(transport);
  const out = await cdp.send('Runtime.evaluate', { expression: '6*7' });

  assert.deepEqual(out, { value: 42 });
  assert.equal(seen.at(-1).tab, 77);
  assert.equal(seen.at(-1).method, 'Runtime.evaluate');
  cdp.close();

  await worker.stop();
  await closeBridge();
});

test('an extension error arrives as a CDP error rather than silence', async () => {
  const worker = await startWorker(() => {
    throw new Error('No such tab');
  });

  const transport = connectBridgeTarget(99);
  const cdp = createCdpClient(transport);
  await assert.rejects(() => cdp.send('Page.bringToFront', {}), /No such tab/);
  cdp.close();

  await worker.stop();
  await closeBridge();
});

test('a command survives a worker that went away mid-call', async () => {
  const first = await startWorker(() => [{ id: 7, url: 'https://x/', title: 'X' }]);
  await first.stop();

  const pending = listBridgeTargets({ timeoutMs: 20000 });
  const { port } = await bridgeAddress();
  const second = await scriptedWorker(port, () => [{ id: 9, url: 'https://y/', title: 'Y' }]);
  const deadline = Date.now() + 5000;
  while (!(await waitForBridgeLink({ timeoutMs: 100 })) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.deepEqual(await pending, [{ id: 9, url: 'https://y/', title: 'Y' }], 'the command waited for the next worker');

  await second.stop();
  await closeBridge();
});

test('a worker that answers nothing is named, not waited out silently', async () => {
  const { port } = await bridgeAddress();
  const worker = await scriptedWorker(port, () => [], { answerProof: false, deaf: true });
  const deadline = Date.now() + 3000;
  while (!(await waitForBridgeLink({ timeoutMs: 100 })) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const started = Date.now();
  await assert.rejects(() => listBridgeTargets({ timeoutMs: 2000 }), /no answer for tabs.list/);
  const waited = Date.now() - started;
  assert.ok(waited < 6000, `the failure was named in ${waited} ms`);

  await worker.stop();
  await closeBridge();
});

test('teardown settles the pending and drops the server', async () => {
  const worker = await startWorker(() => new Promise(() => {}));

  const transport = connectBridgeTarget(1);
  const cdp = createCdpClient(transport);
  const hanging = cdp.send('Page.bringToFront', {});
  await new Promise((r) => setTimeout(r, 120));
  await worker.stop();
  await closeBridge();

  await assert.rejects(() => hanging, /bridge closed|not connected/);
  cdp.close();
});