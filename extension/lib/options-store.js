// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: options-store — MV3 runtime library, shared with the Node suite..
// @context: MV3 runtime library, shared with the Node suite.
// @state: MV3 runtime library, shared with the Node suite..
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: endpoints.

// Validation and persistence for the Options page: the bridge URL override and the
// log level, stored in chrome.storage.local.
//
// WHY https only: the bridge URL is where the device token is posted, so plain http to
// a remote host is refused. Loopback is served over http and is handled by the caller,
// not here.

import { DEFAULT_BRIDGE_URL } from './endpoints.js';

const LEVELS = ['debug', 'warn', 'error'];
const DEFAULT_LEVEL = 'warn';

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function loadOptions(storage) {
  const cfg = await storage.get(['bridgeUrl', 'logLevel']);
  const bridgeUrl = typeof cfg.bridgeUrl === 'string' && cfg.bridgeUrl ? cfg.bridgeUrl : DEFAULT_BRIDGE_URL;
  const logLevel = LEVELS.includes(cfg.logLevel) ? cfg.logLevel : DEFAULT_LEVEL;
  return { bridgeUrl, logLevel };
}

export async function saveBridgeUrl(storage, value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    await storage.set({ bridgeUrl: DEFAULT_BRIDGE_URL });
    return DEFAULT_BRIDGE_URL;
  }
  if (!isHttpUrl(trimmed)) throw new Error('Enter an https:// URL or leave empty to reset.');
  await storage.set({ bridgeUrl: trimmed });
  return trimmed;
}

export async function saveLogLevel(storage, value) {
  if (!LEVELS.includes(value)) throw new Error('Log level must be debug, warn, or error.');
  await storage.set({ logLevel: value });
  return value;
}
