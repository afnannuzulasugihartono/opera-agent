// @title: device-signal — tell a device socket its command exists, in milliseconds rather than a second.
// @state: 7 locks; endpoint shape, headers, timeout, failure tolerance, and name validation.
// @dependencies: none.

// WHY THIS FILE EXISTS
//
// The bridge learns about new work through postgres_changes, which measured
// 650-1000 ms from insert to claim: the insert travels WAL to Realtime server to
// edge isolate before the bridge even starts claiming. A broadcast on the device
// channel skips all of that. It is ephemeral pub/sub with no WAL and no database
// round trip, so the same signal lands in tens of milliseconds.
//
// WHY a single HTTP POST instead of a subscribed channel. The first version of
// this signal opened a Realtime channel per request and waited for SUBSCRIBED.
// From a short-lived edge isolate that handshake never completed inside any sane
// timeout, so every request paid the full two seconds and still sent nothing —
// measured live as gateway latency jumping from one second to four. The REST
// broadcast endpoint exists for exactly this case: one POST, no connection.
//
// WHY no Authorization header. The endpoint authenticates on the apikey header
// alone, and an empty Authorization header makes Realtime answer 500 instead of
// 202. That is a documented supabase-js footgun; raw fetch with apikey only
// sidesteps it entirely.
//
// WHY this never throws. The broadcast is an optimization, not the source of
// truth: the insert already committed before this runs, and the bridge still
// listens to postgres_changes as backup. Returning false on every failure keeps a
// fast-path hiccup from becoming a failed user request. Slow and correct always
// beats fast and broken.

const SIGNAL_TIMEOUT_MS = 1500;
const DEVICE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function deviceChannel(deviceName) {
  return `opera-commands-${deviceName}`;
}

export function validSignalName(value) {
  return typeof value === 'string' && DEVICE_NAME_RE.test(value);
}

export function signalUrl(supabaseUrl, deviceName) {
  const base = String(supabaseUrl || '').replace(/\/+$/, '');
  return `${base}/realtime/v1/api/broadcast/${encodeURIComponent(deviceChannel(deviceName))}/events/new-command`;
}

// WHY fetch is a parameter rather than a global. The gateway test drives the real
// gateway source inside a vm sandbox, and a global resolves in the realm the
// function was defined in, not the realm that calls it — so an injected fake
// would never be seen and the test would hit the network. Both callers pass
// their own fetch explicitly, and the tests pass fakes.

export async function notifyDevice(credentials, deviceName, commandId, log, fetchImpl, timeoutMs = SIGNAL_TIMEOUT_MS) {
  const supabaseUrl = credentials?.supabaseUrl;
  const supabaseKey = credentials?.supabaseKey;
  if (typeof supabaseUrl !== 'string' || !supabaseUrl || typeof supabaseKey !== 'string' || !supabaseKey) return false;
  if (!validSignalName(deviceName) || typeof commandId !== 'string' || !commandId) return false;

  try {
    const response = await fetchImpl(signalUrl(supabaseUrl, deviceName), {
      method: 'POST',
      headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response?.ok === true;
  } catch (error) {
    try { log?.debug?.('DEVICE_SIGNAL_FAILED', String(error?.message || error)); } catch { }
    return false;
  }
}
