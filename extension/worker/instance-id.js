// @last-edited: 2026-11-09 UTC+7.
// @title: instance-id — the name one browser keeps, so two browsers are two devices.
// @state: one generated id per browser profile, kept in that profile's own storage.
// @dependencies: none.

// WHY THIS FILE EXISTS

// Two browsers on one machine presented the same device name, so the second one to pair replaced the first one's token and the first was refused on its next connection.
// A pairing code proves an account; it says nothing about which browser is holding it.
// So every browser generates one id of its own, keeps it, and sends it wherever a device has to be told apart from another device.

const KEY = 'instanceId';

export function newInstanceId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function instanceId() {
  const stored = await chrome.storage.local.get(KEY);
  const known = String(stored?.[KEY] || '').trim();
  if (known) return known;
  const created = newInstanceId();
  await chrome.storage.local.set({ [KEY]: created });
  return created;
}

// WHY pairIdentity IS ITS OWN CALL.
// Everything else that sends the identity (the socket hello, the heartbeat, the discovery file) must keep the value the pairing row was minted with, or a mid-flight rename would split one browser into two devices.
// The cookie identity is only ever preferred at pair time, where the server knows how to adopt the row the legacy id named.
// A browser that never saw the cookie and holds no storage id sends nothing, exactly like the old build.

export async function cookieInstanceId() {
  const stored = await chrome.storage.local.get('oaDeviceCookieId');
  const value = String(stored?.oaDeviceCookieId || '').trim();
  return value ? `b:${value}`.slice(0, 64) : '';
}

export async function pairIdentity() {
  const cookie = await cookieInstanceId();
  const legacy = await instanceId();
  return { cookie, legacy };
}
