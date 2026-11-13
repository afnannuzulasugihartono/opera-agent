// @last-edited: 2026-11-09 UTC+7.
// @title: pair-cookie - the profile's own identity, mirrored where the service worker can read it.
// @state: on the paired site, read the one cookie that identifies this browser profile and store it for pair time.
// @dependencies: none.

// WHY THIS FILE EXISTS The pairing identity lived in chrome.storage.local and nowhere else, and Chrome deletes that storage when the extension is removed.
// Every reinstall minted a fresh identity, and every re-pair minted a new device row, while the dashboard drowned in ghost browsers.
// The browser profile outlives the extension, and its cookie jar is the only part of it a content script can read: so the site writes oa_device_id, this file mirrors it into storage, and pair time prefers what the jar holds.
// One browser keeps one device across reinstalls; the mirror never fires on any other host and never writes when the jar holds nothing.

(() => {
  'use strict';
  try {
    const host = String((globalThis.location && globalThis.location.hostname) || '');
    if (host !== 'opera-agent.pages.dev') return;
    const match = /(?:^|;\s*)oa_device_id=([A-Za-z0-9._-]{8,64})(?:;|$)/.exec(String(document.cookie || ''));
    const value = match && match[1] ? match[1] : '';
    if (!value) return;
    if (!globalThis.chrome?.storage?.local) return;
    chrome.storage.local.get('oaDeviceCookieId').then((stored) => {
      if (String(stored?.oaDeviceCookieId || '') === value) return;
      chrome.storage.local.set({ oaDeviceCookieId: value }).catch(() => {});
    }).catch(() => {});
  } catch (error) {
    void error;
  }
})();
