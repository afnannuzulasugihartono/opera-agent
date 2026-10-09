// @last-edited: 2026-10-09 UTC+7.
// @title: private-tabs — the incognito tab-id set and the screenshot memo it clears.
// @state: owns PRIVATE_TABS_KEY; reads screenshotCache from capture, one way only.
// @dependencies: capture.

import { screenshotCache } from './capture.js';

export const PRIVATE_TABS_KEY = 'privateTabIds';

export async function privateTabIds() {
  const stored = await chrome.storage.local.get(PRIVATE_TABS_KEY);
  return new Set((Array.isArray(stored[PRIVATE_TABS_KEY]) ? stored[PRIVATE_TABS_KEY] : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id >= 0));
}

export async function isPrivateTab(tabId) {
  return (await privateTabIds()).has(tabId);
}

export async function setPrivateTab(tabId, value) {
  const ids = await privateTabIds();
  if (value) ids.add(tabId); else ids.delete(tabId);
  await chrome.storage.local.set({ [PRIVATE_TABS_KEY]: [...ids].slice(-200) });
  screenshotCache.delete(tabId);
  return value;
}
