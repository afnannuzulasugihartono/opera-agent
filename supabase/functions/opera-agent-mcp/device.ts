// @last-edited: 2026-11-11 UTC+7.
// @title: device - which browser answers, on what evidence.
// @state: a pinned device answers while it is live; a pin that names a sleeping browser is a named refusal, never a silent switch to another browser.
// @dependencies: none.

// WHY THIS FILE EXISTS The caller pinned Opera Agent's device by name once - opencode's config says X-Opera-Device: "opera" - and the account's device by that name fell silent seven hours ago while Chrome and Brave sat open with fresh heartbeats.
// Every command enqueued to the silent device waited for its full timeout and answered AWAIT_OUTCOME_UNKNOWN, so the local loopback road worked and the relay looked broken end to end.
// The presence answer already knew how to tell a live device from a stored flag: freshness within the same window.
// This module is that judgement as a small pure function, so the rule is testable in Node instead of only in the deployed isolate.

// WHY THE PIN NEVER GOES SILENTLY TO ANOTHER BROWSER.
// A pin names one browser.
// Tab ids live inside one browser: a tab id minted on the everyday profile is unknown to the test profile, so a relay that answers one call on the pinned browser and the next on another browser hands the agent a tab id that exists on neither.
// That is not a slow call; it is a wrong call that looks healthy until it fails.
// So the pin decides: while the pinned browser is live it answers every call, and when it is not the relay says so by name, with the live alternatives and the header that would reach one.
// The old fallback - drive whatever browser happens to be freshest - is still there, but the caller has to ask for it with X-Opera-Device: any.
// Availability the caller asked for, not availability the relay decided.

// WHY THE WINDOW IS TWO MINUTES.
// The extension heartbeats every thirty seconds; a device that misses four beats in a row is gone for any purpose that involves waiting on it.
// The same window already names a device "online" in the presence answer, so resolution and presence cannot disagree about what "now" means.

const LIVE_WINDOW_MS = 120_000;

export type DeviceRow = {
  device_name?: unknown;
  last_seen_at?: unknown;
  status?: unknown;
};

export type DevicePinState = 'none' | 'live' | 'stale' | 'missing';

export type DeviceResolution = {
  name: string | null;
  source: 'pin' | 'freshest' | null;
  pinned: string | null;
  ageMs: number | null;
  alternatives: string[];
  pinState: DevicePinState;
};

type NamedRow = { name: string; ageMs: number | null; live: boolean };

const namedRows = (devices: DeviceRow[], now: number, windowMs: number): NamedRow[] => {
  const out: NamedRow[] = [];
  for (const device of Array.isArray(devices) ? devices : []) {
    const name = String(device?.device_name ?? '').trim();
    if (!name) continue;
    if (String(device?.status ?? '').trim().toLowerCase() === 'disabled') continue;
    const seen = device?.last_seen_at ? Date.parse(String(device.last_seen_at)) : Number.NaN;
    const ageMs = Number.isFinite(seen) ? Math.max(0, now - seen) : null;
    out.push({ name, ageMs, live: ageMs !== null && ageMs <= windowMs });
  }
  return out;
};

export function resolveDevice({ pin = null, devices, now = Date.now(), windowMs = LIVE_WINDOW_MS }: {
  pin?: string | null;
  devices: DeviceRow[];
  now?: number;
  windowMs?: number;
}): DeviceResolution {
  const requested = String(pin || '').trim() || null;
  const rows = namedRows(devices, now, windowMs);
  const live = rows.filter((row) => row.live).sort((a, b) => (a.ageMs ?? 0) - (b.ageMs ?? 0));
  const liveNames = live.map((row) => row.name);
  const isAny = requested !== null && requested.toLowerCase() === 'any';
  const pinned = isAny ? null : requested;

  if (pinned) {
    const match = rows.find((row) => row.name.toLowerCase() === pinned.toLowerCase());
    if (match?.live) {
      return {
        name: match.name,
        source: 'pin',
        pinned,
        ageMs: match.ageMs,
        alternatives: liveNames.filter((name) => name !== match.name),
        pinState: 'live'
      };
    }
    return {
      name: null,
      source: null,
      pinned,
      ageMs: match?.ageMs ?? null,
      alternatives: liveNames,
      pinState: match ? 'stale' : 'missing'
    };
  }

  const next = live[0] ?? null;
  return {
    name: next?.name ?? null,
    source: next ? 'freshest' : null,
    pinned: requested,
    ageMs: next?.ageMs ?? null,
    alternatives: next ? liveNames.slice(1) : [],
    pinState: 'none'
  };
}
