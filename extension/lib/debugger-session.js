// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: debugger-session — session — Shared debugger session bookkeeping.
// @state: module headers say what a module is, not which task added it.
// @dependencies: none.

// A "shared session" is the `{ tabId, attached }` object a caller puts on its context so that several CDP operations inside one logical operation reuse a single attach.
// `runBurst` creates one; until this module existed, so did the watch-fired click path, which had no matching release.
// That left the debugger attached to the tab and Chrome's "started debugging this browser" bar stuck on it.

// WHY an idle session is released instead of held.
// The bridge holds one session per driven tab so repeat calls skip the attach, which left the debugging bar pinned on every tab the agent ever touched.
// Every shared use stamps the session, and anything quiet past the caller's bound is detached: the bar shows while the agent works and leaves when it stops, and the next command re-attaches for the price of one round trip.

// The registry also exists so an *unexpected* detach can invalidate the cache.
// Nothing listened to `chrome.debugger.onDetach`, so when the user opened DevTools on the tab, or the tab closed, a cached `attached: true` survived and every later CDP call in that session failed against a dead debugger.

// `chrome` is referenced lazily inside the functions so this module can be imported, and its no-op paths exercised, outside a browser.

const sessions = new Map();

export function getDebuggerSessions() {
  return sessions;
}

export function registerDebuggerSession(session) {
  if (!session || typeof session.tabId !== 'number') return;
  sessions.set(session.tabId, session);
}

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

export function handleDebuggerDetach(source) {
  const tabId = source?.tabId;
  if (typeof tabId !== 'number') return;
  const session = sessions.get(tabId);
  if (session) session.attached = false;
  sessions.delete(tabId);
}

export function touchDebuggerSession(session, now = Date.now()) {
  if (!session || typeof session.tabId !== 'number') return;
  session.lastUsedAt = now;
}

export async function releaseIdleDebuggerSessions({ maxIdleMs = 60000, now = Date.now(), log } = {}) {
  let released = 0;
  for (const session of [...sessions.values()]) {
    if (!session?.attached) continue;
    if (now - (session.lastUsedAt ?? 0) < maxIdleMs) continue;
    await releaseDebuggerSession(session, log);
    released += 1;
  }
  return released;
}