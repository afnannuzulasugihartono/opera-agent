/*
 * @last-edited: 2026-11-13 UTC+7.
 * @title: dump-page - the whole page's content as one readable object: text, headings, links, scripts, styles; agent-native.
 * @state: page.dump primitive; mirrors what read_page shows but reads the whole page, not one viewport, and returns no bytes.
 * @dependencies: tab-content.js, capture.js.
 */

// WHY THIS EXISTS.
// The agent today can see the page in viewports (read_page) or as an offline copy on disk (save_page).
// Neither is the tool for “answer a question about the whole page”: the dump is the page reduced to the facts an agent needs to reason - title, text, headings, links, scripts, styles - with no images, fonts or assets.

import { codedError, assertCaptureFramesSafe } from './capture.js';
import { recordScanCall, resolveTabId, HTTP_URL_RE } from './tab-content.js';

function toCodedError(error: unknown) {
  // WHY THE CAST: chrome.* throws untyped faults; the negotiated field list is the browser's contract with us.
  const record = error as Record<string, unknown> | null;
  const message = record && 'message' in record ? String(record.message) : String(error);
  return codedError('DUMP_FAILED', message.slice(0, 300), {});
}

export async function dumpPage(tabId: unknown, params: Record<string, unknown> | undefined, _context: unknown) {
  const requestedTabId = tabId || (params && params.tabId);
  const id = await resolveTabId({ ...params, tabId: requestedTabId });

  try {
    const tab = await chrome.tabs.get(id);
    if (!HTTP_URL_RE.test(tab.url || '')) throw codedError('CAPTURE_BLOCKED', 'Dumps only support HTTP/HTTPS tabs.', { tabId: id });
    if (tab.incognito) throw codedError('CAPTURE_BLOCKED', 'Dumps are blocked in incognito tabs.', { tabId: id, reason: 'INCOGNITO' });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw toCodedError(error);
  }

  await assertCaptureFramesSafe(id);

  const response = await recordScanCall(id, 'page.dump', {
    offset: params?.offset,
    limit: params?.limit
  });

  if (!response?.ok) {
    throw codedError(String(response?.error || 'DUMP_FAILED').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 48) || 'DUMP_FAILED', String(response?.error || 'The page did not answer its dump request.').slice(0, 300), { tabId: id });
  }

  return {
    kind: 'dump',
    dump: response,
    tabId: id,
    page: {
      url: response.url || null,
      title: response.title || null
    }
  };
}
