// @last-edited: 2026-11-09 UTC+7.
// @title: device - which browser answers, on what evidence.
// @state: a pinned device wins while it is fresh; otherwise the freshest fresh device wins; otherwise nobody.
// @dependencies: none.

// WHY THIS FILE EXISTS The caller pinned Browser Agent's device by name once - opencode's config says X-Opera-Device: "opera" - and the account's device by that name fell silent seven hours ago while Chrome and Brave sat open with fresh heartbeats.
// Every command enqueued to the silent device waited for its full timeout and answered AWAIT_OUTCOME_UNKNOWN, so the local loopback road worked and the relay looked broken end to end.
// The presence answer already knew how to tell a live device from a stored flag: freshness within the same window.
// This module is that judgement as a small pure function, so the rule is testable in Node instead of only in the deployed isolate.

// WHY THE WINDOW IS TWO MINUTES.
// The extension heartbeats every thirty seconds; a device that misses four beats in a row is gone for any purpose that involves waiting on it.
// The same window already names a device "online" in the presence answer, so resolution and presence cannot disagree about what "now" means.

export const LIVE_WINDOW_MS = 120_000;

export type DeviceRow = {
  device_name?: unknown;
  last_seen_at?: unknown;
  status?: unknown;
};

export type DeviceResolution = {
  name: string | null;
  source: 'pin' | 'freshest' | null;
  pinned: string | null;
  ageMs: number | null;
};

const freshRows = (devices: DeviceRow[], now: number, windowMs: number) => {
  const out: { name: string; ageMs: number }[] = [];
  for (const device of Array.isArray(devices) ? devices : []) {
    const name = String(device?.device_name ?? '').trim();
    if (!name) continue;
    if (String(device?.status ?? '').trim().toLowerCase() === 'disabled') continue;
    const seen = device?.last_seen_at ? Date.parse(String(device.last_seen_at)) : Number.NaN;
    if (!Number.isFinite(seen)) continue;
    const ageMs = Math.max(0, now - seen);
    if (ageMs <= windowMs) out.push({ name, ageMs });
  }
  out.sort((a, b) => a.ageMs - b.ageMs);
  return out;
};

export function resolveDevice({ pin = null, devices, now = Date.now(), windowMs = LIVE_WINDOW_MS }: {
  pin?: string | null;
  devices: DeviceRow[];
  now?: number;
  windowMs?: number;
}): DeviceResolution {
  const pinned = String(pin || '').trim() || null;
  const live = freshRows(devices, now, windowMs);
  if (pinned) {
    const match = live.find((row) => row.name.toLowerCase() === pinned.toLowerCase());
    if (match) return { name: match.name, source: 'pin', pinned, ageMs: match.ageMs };
  }
  const next = live[0] ?? null;
  return {
    name: next?.name ?? null,
    source: next ? 'freshest' : null,
    pinned,
    ageMs: next?.ageMs ?? null
  };
}
