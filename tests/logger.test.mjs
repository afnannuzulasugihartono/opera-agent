// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: logger.test — Enterprise Quality Phase 2 Task 5: shared extension logger contracts.
// @state: log previously silent catches in content script.
// @dependencies: node:test, strict, node:fs.

// Enterprise Quality Phase 2 Task 5: shared extension logger contracts.
//
// extension/lib/agent-log.js is a classic content script with no import/export
// statements, so it is imported here for its side effect and read off
// globalThis — the same R9-C pattern as role-reconcile.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

await import('../extension/lib/agent-log.js');
let Log = globalThis.OperaAgentLog;

test('logger: warn and error route to console at the default warn threshold, debug does not', () => {
  assert.ok(Log, 'OperaAgentLog is published on globalThis');
  Log.clear();
  const warned = [];
  const errored = [];
  const debugged = [];
  const origWarn = console.warn;
  const origError = console.error;
  const origDebug = console.debug;
  console.warn = (...args) => { warned.push(args.join(' ')); };
  console.error = (...args) => { errored.push(args.join(' ')); };
  console.debug = (...args) => { debugged.push(args.join(' ')); };
  try {
    Log.debug('DBG', 'debug message');
    Log.warn('WRN', 'warn message');
    Log.error('ERR', 'error message');
  } finally {
    console.warn = origWarn;
    console.error = origError;
    console.debug = origDebug;
  }
  assert.equal(debugged.length, 0, 'debug stays below the default warn threshold');
  assert.equal(warned.length, 1, 'warn reaches the console at the default threshold');
  assert.equal(errored.length, 1, 'error reaches the console at the default threshold');
  assert.match(warned[0], /WRN/);
  assert.match(errored[0], /ERR/);
});

test('logger: buffer records debug even when the console threshold is warn', () => {
  Log.clear();
  Log.configure({ level: 'warn' });
  const origDebug = console.debug;
  console.debug = () => {};
  try {
    Log.debug('DBG', 'buffered debug');
  } finally {
    console.debug = origDebug;
  }
  const found = Log.entries().filter((entry) => entry.code === 'DBG');
  assert.equal(found.length, 1);
  assert.equal(found[0].level, 'debug');
  assert.equal(found[0].message, 'buffered debug');
});

test('logger: buffer never exceeds 200 entries and retains the newest', () => {
  Log.clear();
  Log.configure({ level: 'error' });
  const origError = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 250; i += 1) Log.error('SEQ', `message-${i}`);
  } finally {
    console.error = origError;
  }
  const entries = Log.entries();
  assert.equal(entries.length, 200);
  assert.equal(entries[0].message, 'message-50');
  assert.equal(entries[199].message, 'message-249');
});

test('logger: commandId field is preserved on entries', () => {
  Log.clear();
  Log.configure({ level: 'error' });
  const origError = console.error;
  console.error = () => {};
  let entry;
  try {
    entry = Log.error('EXEC', 'ran command', { commandId: 'cmd-123' });
  } finally {
    console.error = origError;
  }
  assert.equal(entry.commandId, 'cmd-123');
  const plain = Log.log('warn', 'NO CMD', 'no fields');
  assert.equal(plain.commandId, null);
});

test('logger: entries() returns a copy that cannot mutate the buffer', () => {
  Log.clear();
  Log.configure({ level: 'error' });
  const origError = console.error;
  console.error = () => {};
  try {
    Log.error('ONE', 'first');
  } finally {
    console.error = origError;
  }
  const snapshot = Log.entries();
  assert.equal(snapshot.length, 1);
  snapshot.pop();
  snapshot.push({ t: 'fake', level: 'error', code: 'FAKE', message: 'fake', commandId: null });
  assert.equal(Log.entries().length, 1);
  assert.equal(Log.entries()[0].code, 'ONE');
});

test('logger: fresh module evaluation starts with an empty buffer', async () => {
  const saved = globalThis.OperaAgentLog;
  delete globalThis.OperaAgentLog;
  try {
    await import(`../extension/lib/agent-log.js?fresh=${Date.now()}`);
    assert.equal(globalThis.OperaAgentLog.entries().length, 0);
    Log = globalThis.OperaAgentLog;
  } finally {
    if (!globalThis.OperaAgentLog) globalThis.OperaAgentLog = saved;
    else Log = globalThis.OperaAgentLog;
  }
});

test('logger: configure rejects an invalid level', () => {
  assert.throws(() => Log.configure({ level: 'verbose' }), /Invalid log level/);
  assert.throws(() => Log.configure({}), /Invalid log level/);
});

test('logger: code and message are bounded like normalizeError', () => {
  Log.clear();
  Log.configure({ level: 'error' });
  const origError = console.error;
  console.error = () => {};
  let entry;
  try {
    entry = Log.error('C'.repeat(500), 'M'.repeat(5000));
  } finally {
    console.error = origError;
  }
  assert.ok(entry.code.length <= 100);
  assert.ok(entry.message.length <= 1000);
});

test('logger: hot path of 300 debug calls keeps a bounded 200-entry buffer with zero console output', () => {
  // Review-Focus spam pin (Enterprise Phase 2 Task 7): content.js hot paths
  // log per-iteration debug entries (selector probes, URL parses), so 300
  // rapid debug calls must leave the buffer at exactly 200 with the newest
  // retained and stay silent under the default warn threshold.
  Log.clear();
  Log.configure({ level: 'warn' });
  const debugged = [];
  const origDebug = console.debug;
  console.debug = (...args) => { debugged.push(args.join(' ')); };
  try {
    for (let i = 0; i < 300; i += 1) Log.debug('HOT', `hot-${i}`);
  } finally {
    console.debug = origDebug;
  }
  const entries = Log.entries();
  assert.equal(entries.length, 200);
  assert.equal(entries[0].message, 'hot-100');
  assert.equal(entries[199].message, 'hot-299');
  assert.equal(debugged.length, 0, 'debug stays silent under the default warn threshold');
});

test('content.js still throws Invalid CSS selector on unparseable selectors', () => {
  // Frozen-contract pin (Enterprise Phase 2 Task 7): pageQuery and wait_for
  // validate caller selectors by throwing the exact literal
  // `Invalid CSS selector.` A logged-catch conversion must warn first and
  // still throw rather than swallow, so the literal is asserted by exact
  // source-text match — intentional here because the message is the contract.
  const src = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
  const hits = src.match(/throw new Error\('Invalid CSS selector\.'\)/g) || [];
  assert.equal(hits.length, 2, 'pageQuery and wait_for each keep their Invalid CSS selector throw');
});
