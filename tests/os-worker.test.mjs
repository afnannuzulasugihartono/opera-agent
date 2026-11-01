// @last-edited: 2026-11-01 UTC+7.
// @title: os-worker — one PowerShell process answers every window read, instead of one shell per read.
// @state: 4 locks; one child for many commands, base64 arguments, a token, death falls back.
// @dependencies: node:test, strict, node:events, ../local/os-worker.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createOsWorker } from '../local/os-worker.js';

// WHY THE FAKE CHILD ANSWERS LIKE THE REAL SHELL.
// The shell prints READY on stdout once its listener is up, and every request carries its own answer; the fake does the same, so the test drives the same bytes the real process writes.

function fakeChild() {
  const child = new EventEmitter();
  child.writes = [];
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('exit');
  };
  return child;
}

const b64 = (text) => Buffer.from(String(text), 'utf8').toString('base64');

// WHY THE FIRST CLAIM IS THAT ONE PROCESS SERVES MANY READS.
// Measured live: one powershell.exe start costs about 0.8 s and compiling the window class another 0.3 s, so a drive that asks the machine per step pays 1.7 s each; a process that stays up answers in about a millisecond.

test('one child answers many commands, and every request carries the token and the arguments', async () => {
  const children = [];
  const asked = [];
  const worker = createOsWorker({
    port: 4711,
    token: 'test-token',
    spawn: () => {
      const child = fakeChild();
      children.push(child);
      setTimeout(() => child.stdout.emit('data', 'READY\n'), 0);
      return child;
    },
    fetch: async (url) => {
      asked.push(url);
      return {
        ok: true,
        text: async () => 'FOREGROUND Tool bench - Google Chrome'
      };
    },
    readyTimeoutMs: 1000
  });

  const first = await worker.ask('read');
  const second = await worker.ask('focus', [
    'Tool bench',
    'Google Chrome',
    '1'
  ]);

  assert.equal(first, 'FOREGROUND Tool bench - Google Chrome');
  assert.equal(second, 'FOREGROUND Tool bench - Google Chrome');
  assert.equal(children.length, 1, 'both commands went to the same process');
  assert.equal(asked.length, 2);
  assert.match(asked[0], /t=test-token/, 'the request carries the token');
  assert.match(asked[0], /m=read/);
  assert.match(asked[1], /a0=VG9vbCBiZW5jaA%3D%3D/, 'the arguments travel base64, so no title can break the line');
  assert.match(asked[1], /a1=R29vZ2xlIENocm9tZQ%3D%3D/);
  assert.match(asked[1], /a2=MQ%3D%3D/);
  worker.close();
});

// WHY A REQUEST WITHOUT THE RIGHT TOKEN GETS NOTHING.
// The listener can raise a window, so it answers only to a caller that knows the token made for this process.

test('a request that is refused answers null', async () => {
  const worker = createOsWorker({
    port: 4712,
    token: 'test-token',
    spawn: () => {
      const child = fakeChild();
      setTimeout(() => child.stdout.emit('data', 'READY\n'), 0);
      return child;
    },
    fetch: async () => ({
      ok: false,
      text: async () => ''
    }),
    readyTimeoutMs: 1000
  });

  assert.equal(await worker.ask('read'), null);
  worker.close();
});

// WHY A SCRIPT REQUEST PUTS ITS SOURCE IN THE BODY.
// The dialog script is several kilobytes of PowerShell and a request line has a length limit, so the source travels in the body and only the small arguments travel in the query.

test('a script request carries its source in the body and its arguments in the query', async () => {
  const calls = [];
  const worker = createOsWorker({
    port: 4715,
    token: 'test-token',
    spawn: () => {
      const child = fakeChild();
      setTimeout(() => child.stdout.emit('data', 'READY\n'), 0);
      return child;
    },
    fetch: async (
      url,
      options
    ) => {
      calls.push({
        url,
        options
      });
      return {
        ok: true,
        text: async () => '{"open":false}'
      };
    },
    readyTimeoutMs: 1000
  });

  const answer = await worker.ask('script', [
    'Write-Output "hi"',
    'state',
    'a path',
    'Open'
  ]);

  assert.equal(answer, '{"open":false}');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, 'Write-Output "hi"', 'the source travels in the body');
  const query = new URL(calls[0].url).searchParams;
  assert.equal(query.get('m'), 'script');
  assert.equal(query.get('a0'), b64('state'), 'the arguments travel base64 in the query');
  assert.equal(query.get('a1'), b64('a path'));
  assert.equal(query.get('a2'), b64('Open'));
  worker.close();
});

// WHY DEATH IS A NULL AND NOT A THROW.
// The caller keeps the one-shot shell as its fallback, so the worker only has to say "I cannot" - a dead process must not take the drive down with it.

test('a shell that dies answers null and never starts again', async () => {
  let spawns = 0;
  let child = null;
  const worker = createOsWorker({
    port: 4713,
    spawn: () => {
      spawns += 1;
      child = fakeChild();
      setTimeout(() => child.stdout.emit('data', 'READY\n'), 0);
      return child;
    },
    fetch: async () => {
      throw new Error('ECONNREFUSED');
    },
    readyTimeoutMs: 1000
  });

  assert.equal(await worker.ask('read'), null, 'a refused request is a null answer');
  assert.equal(await worker.ask('read'), null, 'and the worker stays down');
  assert.equal(spawns, 1, 'no respawn after death');
  assert.equal(child.killed, true, 'the dead shell is cleaned up');
  worker.close();
});

test('a shell that never says it is ready answers null', async () => {
  let child = null;
  const worker = createOsWorker({
    port: 4714,
    spawn: () => {
      child = fakeChild();
      return child;
    },
    fetch: async () => ({
      ok: true,
      text: async () => ''
    }),
    readyTimeoutMs: 120
  });

  assert.equal(await worker.ask('read'), null, 'no listener within the budget is a null');
  assert.equal(child.killed, true);
  worker.close();
});
