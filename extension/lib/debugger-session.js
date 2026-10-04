// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: debugger-session — session — Shared debugger session bookkeeping.
// @context: MV3 runtime library, shared with the Node suite.
// @state: module headers say what a module is, not which task added it.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

// Shared debugger session bookkeeping.
//
// A "shared session" is the `{ tabId, attached }` object a caller puts on its
// context so that several CDP operations inside one logical operation reuse a
// single attach. `runBurst` creates one; until this module existed, so did the
// watch-fired click path, which had no matching release. That left the debugger
// attached to the tab and Chrome's "started debugging this browser" bar stuck
// on it.
//
// The registry also exists so an *unexpected* detach can invalidate the cache.
// Nothing listened to `chrome.debugger.onDetach`, so when the user opened
// DevTools on the tab, or the tab closed, a cached `attached: true` survived
// and every later CDP call in that session failed against a dead debugger.
//
// `chrome` is referenced lazily inside the functions so this module can be
// imported, and its no-op paths exercised, outside a browser.

const sessions = new Map();

/** Live shared sessions, keyed by tab id. Exported for assertions. */

export function getDebuggerSessions() {
  return sessions;
}

/**
 * Record a session that has just been attached, so an unexpected detach can
 * find it. Safe to call with a falsy session.
 */

export function registerDebuggerSession(session) {
  if (!session || typeof session.tabId !== 'number') return;
  sessions.set(session.tabId, session);
}

/**
 * Detach a shared session and forget it. Idempotent: a session that is not
 * attached is a no-op, which is what makes it safe in a `finally`.
 */

export async function releaseDebuggerSession(session, log) {
  if (!session || !session.attached) return;
  session.attached = false;
  sessions.delete(session.tabId);
  try {
    await chrome.debugger.detach({ tabId: session.tabId });
  } catch (error) {
    const message = error?.message || String(error);
    if (log && typeof log.debug === 'function') log.debug('DEBUGGER_DETACH_FAILED', message);
  }
}

/**
 * `chrome.debugger.onDetach` handler. Fired when the tab closes or when the
 * user opens DevTools on it. Without this the cached `attached` flag lies.
 */

export function handleDebuggerDetach(source) {
  const tabId = source?.tabId;
  if (typeof tabId !== 'number') return;
  const session = sessions.get(tabId);
  if (session) session.attached = false;
  sessions.delete(tabId);
}