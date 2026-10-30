// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: popup-events — opener attribution and the bounded background popup log.
// @state: exports recordPopup, popupsSince and resolvePopupOpener; events key by openerTabId, keep 8 per opener, and an in-flight tab claims misattributed popups.
// @dependencies: none.

// Popup and redirect follow-through: pure policy helpers for the background popup log.
// NO DOM and NO chrome dependency: the host supplies tab-creation facts, so the engine stays deterministic and testable in Node (pattern of lib/action-pipeline.js).

// Semantics locked by tests/timeout-retry-popup-parity.test.mjs:
// - events are keyed by openerTabId and bounded per opener (8 kept)
// - popupsSince filters by timestamp (events at or after sinceMs)

export const POPUP_LOG_LIMIT = 8;

/**
 * Record one popup under its openerTabId, keeping at most `limit` events per opener.
 * @param {Map<number, Array<{ tabId: number, url: string, at: number }>>} log The popup log.
 * @param {{ id: number, openerTabId?: number, pendingUrl?: string, url?: string }} tab The created tab.
 * @param {number} atMs When it was created.
 * @param {number} [limit=POPUP_LOG_LIMIT] Per-opener bound.
 * @returns {void}
 */

export function recordPopup(
  log,
  tab,
  atMs,
  limit = POPUP_LOG_LIMIT
) {
  if (!log || !tab || tab.openerTabId === undefined || tab.openerTabId === null) return;
  const opener = Number(tab.openerTabId);
  const list = log.get(opener) || [];
  list.push({
    tabId: tab.id,
    url: String(tab.pendingUrl || tab.url || ''),
    at: Number(atMs)
  });
  while (list.length > limit) list.shift();
  log.set(opener, list);
}

/**
 * The popups opened by a tab at or after a timestamp.
 * @param {Map<number, Array<{ at: number }>>} log The popup log.
 * @param {number} tabId The opener tab.
 * @param {number} sinceMs The earliest timestamp to include.
 * @returns {Array<{ tabId: number, url: string, at: number }>} The matching events.
 */

export function popupsSince(
  log,
  tabId,
  sinceMs
) {
  if (!log) return [];
  const list = log.get(Number(tabId)) || [];
  return list.filter((e) => Number.isFinite(Number(e.at)) && Number(e.at) >= Number(sinceMs));
}

/**
 * Attribute a new tab to the in-flight action's tab when there is one, else to its openerTabId, so a popup is not misattributed while an action is running.
 * @param {number|null} inFlightTabId The tab the current action targets.
 * @param {{ openerTabId?: number }|null} tab The created tab.
 * @returns {number|null} The opener tab id.
 */

export function resolvePopupOpener(
  inFlightTabId,
  tab
) {
  if (!tab) return null;
  if (inFlightTabId != null) return Number(inFlightTabId);
  if (tab.openerTabId != null) return Number(tab.openerTabId);
  return null;
}
