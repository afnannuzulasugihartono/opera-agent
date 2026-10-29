// @last-edited: 2026-10-28 UTC+7.
// @title: leases — which agent drives which tab, so two agents on one browser do not fight over one caret.
// @state: one claim per tab, held by name, released by its owner, expired by the clock.
// @dependencies: none.

// WHY A CLAIM AND NOT A LOCK.
// Two agents on one tab steal the caret from each other and no error names it, so the click simply lands off-target.
// A claim turns that into a sentence: who holds the tab, and until when.

// WHY THE CLOCK IS RENEWED BY EVERY CALL, NOT SET ONCE.
// A claim set at the open outlives a crashed agent and cuts off a long drive; renewing keeps it alive exactly as long as the work does.
// A silent agent then loses the tab to the next one on the clock, with nobody waiting on it.

// WHY A RELEASE IS THE OWNER'S OWN.
// Any agent releasing any claim lets one agent evict another by mistake, and the eviction is invisible: the tab just stops answering the agent that held it.
// Closing the tab is the one moment an agent gives a tab up on purpose.

const DEFAULT_TTL_MS = 60000;

export function createLeaseTable({
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now()
} = {}) {
  const table = new Map();

  // WHY THE READ ALSO FORGETS.
  // Reading an expired claim as held would strand the tab for the whole window after its agent went away, which is the case the expiry exists for.

  const held = (tabId) => {
    const entry = table.get(tabId);
    if (!entry) return null;
    if (now() - entry.renewedAt >= entry.ttlMs) {
      table.delete(tabId);
      return null;
    }
    return entry;
  };

  const row = (tabId) => {
    const entry = held(tabId);
    return entry ? {
      owner: entry.owner,
      expiresAt: entry.renewedAt + entry.ttlMs
    } : null;
  };

  const claim = (
    tabId,
    owner,
    ttl = ttlMs
  ) => {
    const key = String(tabId);
    const current = held(key);
    if (current && current.owner !== owner) return {
      granted: false,
      holder: row(key)
    };
    const span = Number(ttl) > 0 ? Number(ttl) : ttlMs;
    table.set(key, {
      owner,
      ttlMs: span,
      renewedAt: now()
    });
    return {
      granted: true,
      holder: row(key)
    };
  };

  const release = (
    tabId,
    owner
  ) => {
    const key = String(tabId);
    const current = table.get(key);
    if (!current) return false;
    if (owner && current.owner !== owner) return false;
    table.delete(key);
    return true;
  };

  return {
    claim,
    release,
    state: (tabId) => row(String(tabId)),
    live: (tabId) => held(String(tabId))
  };
}

export { DEFAULT_TTL_MS };
