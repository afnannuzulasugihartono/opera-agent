// @last-edited: 2026-10-09 UTC+7.
// @title: listen — the listen session lifecycle and chunk streaming.
// @state: no module-private state; the session lives in chrome.storage.local['listenSession'], and recording runs inside the tab via contentCall media.listen_start.
// @dependencies: utils, tab-content, private-tabs, capture, log, endpoints.

import { log } from '../lib/log.js';
import { LISTEN_BASE_URL } from '../lib/endpoints.js';
import { getConfig } from './utils.js';
import { fetchJson, contentCall, HTTP_URL_RE } from './tab-content.js';
import { isPrivateTab } from './private-tabs.js';
import { codedError } from './capture.js';

// WHY element capture and not tab capture: chrome.tabCapture refuses callers
// without a user gesture ("Extension has not been invoked"), which an
// autonomous agent never has — measured, not assumed, in headed Chromium 153.
// Tapping the media element's own output through WebAudio needs no special
// permission and no gesture. The element keeps playing to the speakers; the
// recorder only forks a copy. Cross-origin media without CORS headers records
// silence instead of failing, so a silent transcript proves nothing by itself.

function listenUrlFor(bridgeUrl) {
  const base = String(bridgeUrl || '');
  const functionsRoot = base.includes('/functions/v1/')
    ? base.slice(0, base.indexOf('/functions/v1/') + '/functions/v1'.length)
    : base.replace(/\/[^/]*\/?$/, '');
  return `${base ? functionsRoot : LISTEN_BASE_URL}/opera-agent-listen`;
}

export async function readListenSession() {
  const stored = await chrome.storage.local.get('listenSession');
  return stored.listenSession || null;
}

export async function listenStart(tabId, params = {}) {
  const cfg = await getConfig();
  if (!cfg.paired || !cfg.deviceToken) throw new Error('Device is not paired.');
  const tab = await chrome.tabs.get(tabId);
  if (!HTTP_URL_RE.test(tab.url || '')) throw codedError('LISTEN_BLOCKED', 'Listening supports HTTP/HTTPS tabs only.', { tabId });
  if (tab.incognito) throw codedError('LISTEN_BLOCKED', 'Listening is blocked in incognito tabs.', { tabId, reason: 'INCOGNITO' });
  if (await isPrivateTab(tabId)) throw codedError('LISTEN_BLOCKED', 'This tab was marked private in the Opera Agent popup.', { tabId, reason: 'USER_PRIVATE' });
  const existing = await readListenSession();
  if (existing?.sessionId) throw codedError('LISTEN_ACTIVE', 'A listening session is already live. Stop it first.', { tabId });
  const session = await fetchJson(listenUrlFor(cfg.bridgeUrl), {
    action: 'start', token: cfg.deviceToken, deviceName: cfg.deviceName, tabId, language: 'id'
  }, 15000);
  if (!session?.ok || !session.sessionId) throw new Error(session?.error || 'Listening session was refused.');
  let started;
  try {
    started = await contentCall(tabId, 'media.listen_start', { index: params.index ?? 0 });
  } catch (error) {
    // WHY end the server session when the recorder fails to start: otherwise a
    // session with no audio behind it bills empty transcription windows.
    await fetchJson(listenUrlFor(cfg.bridgeUrl), {
      action: 'stop', token: cfg.deviceToken, sessionId: session.sessionId
    }, 15000).catch(() => {});
    throw error;
  }
  if (!started?.ok) {
    await fetchJson(listenUrlFor(cfg.bridgeUrl), {
      action: 'stop', token: cfg.deviceToken, sessionId: session.sessionId
    }, 15000).catch(() => {});
    throw new Error(started?.error || 'Capture did not start.');
  }
  await chrome.storage.local.set({ listenSession: { sessionId: session.sessionId, tabId } });
  return { ok: true, sessionId: session.sessionId, audioState: started.audioState || 'unknown' };
}

export async function listenStop() {
  const cfg = await getConfig();
  const existing = await readListenSession();
  if (existing?.tabId != null) {
    await contentCall(existing.tabId, 'media.listen_stop', {}).catch(() => {});
  }
  await chrome.storage.local.remove('listenSession');
  if (!existing?.sessionId || !cfg.deviceToken) return { ok: true, ended: false };
  try {
    const answer = await fetchJson(listenUrlFor(cfg.bridgeUrl), {
      action: 'stop', token: cfg.deviceToken, sessionId: existing.sessionId
    }, 15000);
    return { ok: true, ended: true, ...answer };
  } catch (error) {
    // WHY still ok: the recorder is stopped and the forgotten state is cleared,
    // so nothing keeps recording. The server ends orphan sessions by itself.
    log.warn('LISTEN_STOP_UNCONFIRMED', error?.message || String(error));
    return { ok: true, ended: false };
  }
}

export async function postListenChunk(tabId, seq, audio, mime) {
  const cfg = await getConfig();
  const existing = await readListenSession();
  if (!existing?.sessionId || !cfg.deviceToken) return;

  // WHY drop chunks from any other tab: only the tab the session started on may
  // feed it. A chunk that names no tab, or the wrong one, is discarded rather
  // than billed to someone else's session.
  if (tabId == null || existing.tabId !== tabId) return;
  try {
    await fetchJson(listenUrlFor(cfg.bridgeUrl), {
      action: 'append', token: cfg.deviceToken, sessionId: existing.sessionId, seq, audio, mime
    }, 15000);
  } catch (error) {
    // WHY log and continue: one failed window must not kill a live session;
    // transcription windows tolerate gaps, and the offsets ride the chunk
    // sequence numbers rather than wall-clock time.
    log.warn('LISTEN_CHUNK_FAILED', error?.message || String(error));
  }
}
