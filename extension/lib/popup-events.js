// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: popup-events — MV3 runtime library, shared with the Node suite..
// @state: MV3 runtime library, shared with the Node suite..
// @dependencies: none.

// Popup and redirect follow-through: pure policy helpers for the
// background popup log. NO DOM and NO chrome dependency: the host supplies
// tab-creation facts, so the engine stays deterministic and testable in Node
// (pattern of lib/action-pipeline.js).
//
// Semantics locked by tests/timeout-retry-popup-parity.test.mjs:
// - events are keyed by openerTabId and bounded per opener (8 kept)
// - popupsSince filters by timestamp (events at or after sinceMs)

export const POPUP_LOG_LIMIT = 8;

export function recordPopup(log, tab, atMs, limit = POPUP_LOG_LIMIT) {
  if (!log || !tab || tab.openerTabId === undefined || tab.openerTabId === null) return;
  const opener = Number(tab.openerTabId);
  const list = log.get(opener) || [];
  list.push({ tabId: tab.id, url: String(tab.pendingUrl || tab.url || ''), at: Number(atMs) });
  while (list.length > limit) list.shift();
  log.set(opener, list);
}

export function popupsSince(log, tabId, sinceMs) {
  if (!log) return [];
  const list = log.get(Number(tabId)) || [];
  return list.filter((e) => Number.isFinite(Number(e.at)) && Number(e.at) >= Number(sinceMs));
}

// When a page action runs on a BACKGROUND tab, Chromium attributes a
// window.open popup to the window's *active* tab, not the acted-on tab, so
// openerTabId alone misses it. While a page.click /
// page.fill is in flight, any new tab belongs to the acted-on tab, so attribute
// it there; otherwise fall back to the real openerTabId. Returns the opener key
// to record under, or null when the tab is unrelated to automation.

export function resolvePopupOpener(inFlightTabId, tab) {
  if (!tab) return null;
  if (inFlightTabId != null) return Number(inFlightTabId);
  if (tab.openerTabId != null) return Number(tab.openerTabId);
  return null;
}
