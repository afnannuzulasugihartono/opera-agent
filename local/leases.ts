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

export interface LeaseOptions {
  ttlMs?: number;
  now?: () => number;
}

export interface LeaseEntry {
  owner: string;
  ttlMs: number;
  renewedAt: number;
}

export interface LeaseHolder {
  owner: string;
  expiresAt: number;
}

export interface LeaseClaimResult {
  granted: boolean;
  holder: LeaseHolder | null;
}

export interface LeaseTable {
  claim(tabId: unknown, owner: string, ttl?: number): LeaseClaimResult;
  release(tabId: unknown, owner?: string): boolean;
  state(tabId: unknown): LeaseHolder | null;
  live(tabId: unknown): LeaseEntry | null;
}

export function createLeaseTable({
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now()
}: LeaseOptions = {}): LeaseTable {
  const table = new Map<string, LeaseEntry>();

  // WHY THE READ ALSO FORGETS.
  // Reading an expired claim as held would strand the tab for the whole window after its agent went away, which is the case the expiry exists for.

  const held = (tabId: string): LeaseEntry | null => {
    const entry = table.get(tabId);
    if (!entry) return null;
    if (now() - entry.renewedAt >= entry.ttlMs) {
      table.delete(tabId);
      return null;
    }
    return entry;
  };

  const row = (tabId: unknown): LeaseHolder | null => {
    const entry = held(String(tabId));
    return entry ? { owner: entry.owner, expiresAt: entry.renewedAt + entry.ttlMs } : null;
  };

  const claim = (tabId: unknown, owner: string, ttl: number = ttlMs): LeaseClaimResult => {
    const key = String(tabId);
    const current = held(key);
    if (current && current.owner !== owner) return { granted: false, holder: row(key) };
    const span = Number(ttl) > 0 ? Number(ttl) : ttlMs;
    table.set(key, { owner, ttlMs: span, renewedAt: now() });
    return { granted: true, holder: row(key) };
  };

  const release = (tabId: unknown, owner?: string): boolean => {
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
    state: (tabId: unknown) => row(String(tabId)),
    live: (tabId: unknown) => held(String(tabId))
  };
}

export { DEFAULT_TTL_MS };
