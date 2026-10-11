// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: debugger-session-lifecycle.test — Test..
// @state: Test..
// @dependencies: node:test, strict, extension-source, deadline-race.

import test from 'node:test';
import assert from 'node:assert/strict';

import { raceWithTimeout } from '../extension/lib/deadline-race.js';
import { extensionSource } from './helpers/extension-source.mjs';

const background = await extensionSource();

function sliceBetween(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return background.slice(start, end);
}

test('a watch-fired trusted click releases its debugger session on every outcome', () => {
  const watchAction = sliceBetween('async function executeWatchAction(', 'async function handleWatchFire(');

  assert.match(watchAction, /debuggerSession:\s*\{\s*tabId:\s*entry\.tabId,\s*attached:\s*false\s*\}/);

  assert.match(watchAction, /releaseDebuggerSession\(/);

  assert.match(watchAction, /finally\s*\{[^}]*releaseDebuggerSession\(/s);
});

test('runBurst releases through the same helper rather than its own detach', () => {
  const burst = sliceBetween('async function runBurst(', 'function loopSummary(');
  assert.match(burst, /finally\s*\{/);
  assert.match(burst, /releaseDebuggerSession\(/);

  assert.doesNotMatch(burst, /chrome\.debugger\.detach\(\{ tabId \}\)/);
});

test('the extension listens for chrome.debugger.onDetach', () => {
  assert.match(background, /chrome\.debugger\.onDetach\.addListener\(/);
  assert.match(background, /chrome\.debugger\.onDetach\.addListener\(handleDebuggerDetach\)/);
});

test('withDebugger registers a shared session so onDetach can find it', () => {
  const fn = sliceBetween('async function withDebugger(', 'function codedError(');
  assert.match(fn, /registerDebuggerSession\(shared\)/);
  assert.match(fn, /shared\.attached\s*=\s*true/);
});

test('an unexpected detach clears the cached flag instead of leaving it attached', async () => {
  const { registerDebuggerSession, handleDebuggerDetach, getDebuggerSessions } = await import(
    '../extension/lib/debugger-session.js'
  );
  const session = { tabId: 4242, attached: true };
  registerDebuggerSession(session);
  assert.equal(getDebuggerSessions().get(4242), session);

  handleDebuggerDetach({ tabId: 4242 });
  assert.equal(session.attached, false, 'cached attached flag must be cleared');
  assert.equal(getDebuggerSessions().has(4242), false, 'stale session must be forgotten');
});

test('a detach for an unrelated tab leaves other sessions alone', async () => {
  const { registerDebuggerSession, handleDebuggerDetach, getDebuggerSessions } = await import(
    '../extension/lib/debugger-session.js'
  );
  const keep = { tabId: 11, attached: true };
  const other = { tabId: 22, attached: true };
  registerDebuggerSession(keep);
  registerDebuggerSession(other);
  handleDebuggerDetach({ tabId: 99 });
  assert.equal(keep.attached, true);
  assert.equal(other.attached, true);
  getDebuggerSessions().clear();
});

test('a detach event without a tab id is ignored rather than clearing everything', async () => {
  const { registerDebuggerSession, handleDebuggerDetach } = await import(
    '../extension/lib/debugger-session.js'
  );
  const session = { tabId: 33, attached: true };
  registerDebuggerSession(session);
  handleDebuggerDetach(undefined);
  handleDebuggerDetach({});
  assert.equal(session.attached, true, 'a malformed detach must not invalidate a live session');
  handleDebuggerDetach({ tabId: 33 });
});

test('raceWithTimeout resolves with the work result when work wins', async () => {
  const result = await raceWithTimeout(async () => 'done', 5000);
  assert.equal(result, 'done');
});

test('raceWithTimeout rejects with the supplied error when the deadline passes', async () => {
  await assert.rejects(
    raceWithTimeout(() => new Promise(() => {}), 5, () => new Error('COMMAND_TIMEOUT')),
    /COMMAND_TIMEOUT/
  );
});

test('raceWithTimeout clears its timer once the work wins', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fired = 0;
  await raceWithTimeout(async () => 'fast', 5000, () => {
    fired += 1;
    return new Error('should never fire');
  });

  t.mock.timers.tick(60000);
  assert.equal(fired, 0, 'the timeout callback must not run after the work has settled');
  t.mock.timers.reset();
});

test('raceWithTimeout clears its timer when the work rejects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fired = 0;
  await assert.rejects(
    raceWithTimeout(
      async () => {
        throw new Error('work failed');
      },
      5000,
      () => {
        fired += 1;
        return new Error('should never fire');
      }
    ),
    /work failed/
  );
  t.mock.timers.tick(60000);
  assert.equal(fired, 0, 'the timeout callback must not run after the work has rejected');
  t.mock.timers.reset();
});

test('raceWithTimeout still times out a work promise that never settles', async () => {
  await assert.rejects(
    raceWithTimeout(() => new Promise(() => {}), 5, () => new Error('deadline hit')),
    /deadline hit/
  );
});

test('executeCommand uses the clearing helper instead of a bare race', () => {
  const exec = sliceBetween('async function executeCommand(', 'async function pair(');
  assert.doesNotMatch(exec, /new Promise\(\(_\s*,\s*reject\)\s*=>\s*setTimeout/);

  assert.equal((exec.match(/runDispatch\(/g) || []).length, 2, 'both command paths must use it');

  const shared = sliceBetween('async function runDispatch(', 'async function executeCommand(');
  assert.doesNotMatch(shared, /new Promise\(\(_\s*,\s*reject\)\s*=>\s*setTimeout/);
  assert.equal((shared.match(/raceWithTimeout\(/g) || []).length, 1, 'the shared path must use the clearing helper');
});

test('withDebugger releases the previous session when a burst step switches tabs', () => {
  const fn = sliceBetween('async function withDebugger(', 'function codedError(');

  assert.doesNotMatch(fn, /cannot switch tabs/);
  assert.match(fn, /shared\.tabId !== tabId/);
  assert.match(fn, /releaseDebuggerSession\(shared, log\)/);

  assert.match(fn, /shared\.tabId = tabId/);
});

test('releaseDebuggerSession tolerates a session that is not attached', async () => {
  const { releaseDebuggerSession } = await import('../extension/lib/debugger-session.js');
  await assert.doesNotReject(releaseDebuggerSession(null));
  await assert.doesNotReject(releaseDebuggerSession({ tabId: 7, attached: false }));
});