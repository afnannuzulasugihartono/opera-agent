// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: debugger-session-lifecycle.test — Test..
// @state: Test..
// @dependencies: node:test, strict, node:fs, deadline-race.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { raceWithTimeout } from '../extension/lib/deadline-race.js';

// Phase B Task 2: debugger and timer lifecycle in the service
// worker.
//
// Three defects were confirmed by reading the source:
//
// 1. `executeWatchAction` builds `{ debuggerSession: { tabId, attached: false } }`
//    for a watch-fired trusted click (background.js:1330). `withDebugger` takes
//    the shared-session path for any context carrying `debuggerSession`, and that
//    path never detaches. `runBurst` has a `finally` that releases the session;
//    the watch path had none, so a single ad-overlay click left the debugger
//    attached to the tab for the tab's lifetime. The user sees Chrome's
//    "started debugging this browser" bar stuck on that tab.
//
// 2. Nothing in the extension listens to `chrome.debugger.onDetach`. If the
//    session ends without our detach -- the user opens DevTools on the tab, or
//    the tab closes -- a cached `attached: true` is never cleared, so every
//    later CDP call in that session fails against a dead debugger.
//
// 3. `executeCommand` races `dispatch` against a `setTimeout` rejection and
//    never clears that timer. Every command left a live timer behind that
//    fired later and rejected an already-settled promise.
//
// This file locks the repair. The timer helper is a pure module so both
// directions are testable; the debugger wiring is asserted structurally
// because background.js cannot execute outside a browser.

const background = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return background.slice(start, end);
}

// --- 1. the watch-fired click must release the debugger ---------------------

test('a watch-fired trusted click releases its debugger session on every outcome', () => {
  const watchAction = sliceBetween('async function executeWatchAction(', 'async function handleWatchFire(');
  // The shared session is created for the click path...
  assert.match(watchAction, /debuggerSession:\s*\{\s*tabId:\s*entry\.tabId,\s*attached:\s*false\s*\}/);
  // ...and must be released, not just abandoned.
  assert.match(watchAction, /releaseDebuggerSession\(/);
  // The release must sit in a finally so a throw still detaches.
  assert.match(watchAction, /finally\s*\{[^}]*releaseDebuggerSession\(/s);
});

test('runBurst releases through the same helper rather than its own detach', () => {
  const burst = sliceBetween('async function runBurst(', 'async function dispatch(');
  assert.match(burst, /finally\s*\{/);
  assert.match(burst, /releaseDebuggerSession\(/);
  // The old inline detach is gone, so there is one release path to audit.
  assert.doesNotMatch(burst, /chrome\.debugger\.detach\(\{ tabId \}\)/);
});

// --- 2. an unexpected detach must invalidate the cached session -------------

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

  // This is the DevTools-opened-on-the-tab case: Chrome ended the session, so
  // the cached flag must go false or withDebugger would skip the re-attach.
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

// --- 3. the timeout race must clear its timer ------------------------------

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
  // Without the finally-clear, advancing past the deadline would still run the
  // rejection callback against an already-settled promise.
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
  assert.equal((exec.match(/raceWithTimeout\(/g) || []).length, 2, 'both command paths must use it');
});

// --- guard: the shared-session contract itself is unchanged -----------------

test('withDebugger releases the previous session when a burst step switches tabs', () => {
  const fn = sliceBetween('async function withDebugger(', 'function codedError(');
  // Phase D superseded the blanket refusal. Chrome permits one
  // debugger attachment per tab but not two at once, so a switch must detach
  // before attaching the next, or the banner stays on the first tab.
  assert.doesNotMatch(fn, /cannot switch tabs/);
  assert.match(fn, /shared\.tabId !== tabId/);
  assert.match(fn, /releaseDebuggerSession\(shared, log\)/);
  // And the re-key must happen on attach, so the next switch is detected.
  assert.match(fn, /shared\.tabId = tabId/);
});

test('releaseDebuggerSession tolerates a session that is not attached', async () => {
  const { releaseDebuggerSession } = await import('../extension/lib/debugger-session.js');
  await assert.doesNotReject(releaseDebuggerSession(null));
  await assert.doesNotReject(releaseDebuggerSession({ tabId: 7, attached: false }));
});