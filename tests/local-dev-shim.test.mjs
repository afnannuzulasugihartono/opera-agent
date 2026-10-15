// @last-edited: 2026-10-15 UTC+7.
// @title: local-dev-shim — the dev proxy forwards, swaps, and fails loudly, proven with fakes.
// @state: round trips, init replay, queued swap, named reload failures, crash budget.
// @dependencies: node:test, strict, ../local/dev-shim.js.

// WHY EVERYTHING IS FAKE HERE. A supervisor test that spawns real processes
// and watches real files tests the operating system's timing, not the
// supervisor: flaky where it should be exact. The seams are the contract —
// spawn, watch, pipes — so fakes behind those seams prove the behavior and a
// live drill below the tests proves the wiring.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupervisor } from '../local/dev-shim.js';

function fakeChild() {
  const listeners = {};
  const child = {
    written: [],
    killSignals: [],
    stdin: {
      write: (text) => {
        child.written.push(text);
      }
    },
    stdout: {
      on: (event, fn) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(fn);
      },
      setEncoding: () => {}
    },
    on: (event, fn) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(fn);
    },
    kill: (signal) => {
      child.killSignals.push(signal ?? 'SIGTERM');
      setTimeout(() => child.exit(0), 0);
    },
    emitStdout: (text) => {
      for (const fn of listeners.data ?? []) fn(text);
    },
    exit: (code) => {
      for (const fn of listeners.exit ?? []) fn(code);
    }
  };
  return child;
}

function fakePipe() {
  const listeners = {};
  const pipe = {
    written: [],
    on: (event, fn) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(fn);
    },
    write: (text) => {
      pipe.written.push(text);
    },
    setEncoding: () => {},
    emit: (text) => {
      for (const fn of listeners.data ?? []) fn(text);
    }
  };
  return pipe;
}

function harness(options = {}) {
  const children = [];
  const input = fakePipe();
  const output = fakePipe();
  const logs = [];
  let fireWatch = null;
  const server = createSupervisor({
    spawnWorker: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
    watchFiles: (onChange) => {
      fireWatch = onChange;
      return { close: () => {} };
    },
    input,
    output,
    log: (message) => logs.push(message),
    debounceMs: 5,
    settleMs: 60,
    ...options
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return { children, input, output, logs, fireWatch: () => fireWatch(), server, sleep };
}

const frame = (object) => `${JSON.stringify(object)}\n`;
const bodies = (pipe) => pipe.written.join('').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

test('a round trip crosses the proxy untouched in both directions', async () => {
  const h = harness();
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tabs' } };
  const answer = { jsonrpc: '2.0', id: 1, result: [] };

  h.input.emit(frame(call));
  assert.deepEqual(bodies({ written: h.children[0].written })[0], call);
  h.children[0].emitStdout(frame(answer));
  assert.deepEqual(bodies(h.output)[0], answer);
  await h.server.stop();
});

test('a reload replays the handshake to the new worker and swallows its answer', async () => {
  const h = harness();
  const init = { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} };
  h.input.emit(frame(init));
  h.children[0].emitStdout(frame({ jsonrpc: '2.0', id: 0, result: { ok: true } }));
  const before = h.output.written.join('').length;

  h.fireWatch();
  await h.sleep(80);

  assert.equal(h.children.length, 2, 'the old worker is replaced');
  assert.deepEqual(bodies({ written: h.children[1].written })[0], init, 'the new worker is shaken hands');
  h.children[1].emitStdout(frame({ jsonrpc: '2.0', id: 0, result: { ok: true } }));
  assert.equal(h.output.written.join('').length, before, 'the client never sees the second hello');
  assert.ok(h.logs.some((line) => line.includes('swapping')), 'the reload is announced on stderr');
  await h.server.stop();
});

test('calls placed mid-swap queue in order and the stranded fail by name', async () => {
  const h = harness();
  h.input.emit(frame({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }));
  h.input.emit(frame({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} }));
  h.fireWatch();
  await h.sleep(25);
  h.input.emit(frame({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: {} }));
  await h.sleep(120);

  const out = bodies(h.output);
  const failed = out.find((message) => message.id === 9);
  assert.equal(failed.error.code, -32000);
  assert.match(failed.error.message, /reloaded, retry/);
  const replayed = bodies({ written: h.children[1].written });
  assert.deepEqual(replayed.map((message) => message.id ?? message.method), [0, 10], 'handshake first, then the queued call');
  await h.server.stop();
});

test('garbage forwards blind in both directions instead of breaking the pipe', async () => {
  const h = harness();

  h.input.emit('not json\n');
  h.children[0].emitStdout('worker noise\n');

  assert.equal(h.children[0].written.join(''), 'not json\n');
  assert.equal(h.output.written.join(''), 'worker noise\n');
  await h.server.stop();
});

test('an unexpected death fails the in-flight by name and rebuilds', async () => {
  const h = harness();
  h.input.emit(frame({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }));
  h.input.emit(frame({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: {} }));
  h.children[0].exit(1);
  await h.sleep(20);

  const out = bodies(h.output);
  assert.match(out.find((message) => message.id === 11).error.message, /worker died, retry/);
  assert.equal(h.children.length, 2, 'a transient death rebuilds');
  assert.deepEqual(bodies({ written: h.children[1].written })[0].method, 'initialize');
  await h.server.stop();
});

test('a worker that keeps dying ends the shim instead of looping forever', async () => {
  let at = 0;
  let dead = 0;
  const h = harness({ now: () => at, onDead: () => { dead += 1; } });

  for (let round = 0; round < 4; round++) {
    h.children.at(-1).exit(1);
    at += 1000;
    await h.sleep(5);
  }

  assert.equal(h.children.length, 4, 'three rebuilds, then no fourth');
  assert.equal(dead, 1, 'the give-up is announced once');
  at += 31000;
  await h.server.stop();
});
