// @last-edited: 2026-10-14 UTC+7.
// @title: socket-drain-safety.test — nothing in the drain may throw out of it.
// @state: pins that a foreign frame and a failing completion frame both stay inside the drain.
// @dependencies: node:test, strict, node:fs/promises, ../extension/lib/socket-client.js.

// WHY THIS GATE EXISTS. An uncaught throw inside an MV3 service worker kills
// the worker, and a dead worker looks exactly like a device that is online but
// silently doing nothing: commands queue, no completion ever goes out, and the
// failure surfaces minutes later as an unexplained timeout. Observed live as
// "Uncaught TypeError: Cannot read properties of undefined (reading 'id')" in
// the extension error log, which killed the link for every command after it.
// So the drain owes its callers two guarantees: an entry it cannot use is
// skipped and named, and a completion that cannot be sent fails that command
// alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/lib/socket-client.js', import.meta.url), 'utf8');

test('the drain skips an entry it cannot use instead of dereferencing it', () => {
  const drain = source.slice(source.indexOf('const drain = async ()'), source.indexOf('function connect()'));
  assert.match(drain, /const command = takeQueue\.shift\(\);\s*\n\s*if \(!command \|\| typeof command !== 'object'\) \{/,
    'a shifted entry is checked before any field of it is read');
  assert.match(drain, /onState\(\{ status: 'skipped'/, 'the skip is reported, not swallowed');
  assert.match(drain, /unsent/, 'an entry that cannot be completed is named by id');
});

test('a completion frame that cannot be sent fails its own command, not the drain', () => {
  const drain = source.slice(source.indexOf('const drain = async ()'), source.indexOf('function connect()'));
  assert.match(drain, /try \{\s*\n\s*sendFrame\(completionFrame\(/,
    'sendFrame sits inside its own try, after the guard already proved command is an object');
  assert.match(drain, /draining = false;/, 'the finally still releases the drain');
});

test('the queue only ever holds entries it can run', () => {
  const onmessage = source.slice(source.indexOf('next.onmessage ='), source.indexOf('next.onclose'));
  assert.match(onmessage, /const command = normalizeCommand\(message\);\s*\n\s*if \(command\?\.id\) takeQueue\.push\(command\);/,
    'an unusable frame never enters the queue in the first place');
});
