// @last-edited: 2026-10-09 UTC+7.
// @title: tab-content — content-script injection and the messaging bridge into a tab.
// @state: owns HTTP_URL_RE and the ensureContent script list; that list is pinned by manifest.content_scripts[0].js and must not be edited.
// @dependencies: utils, log, protocol.

import { log } from '../lib/log.js';
import { sleep } from './utils.js';
import { clamp } from '../lib/protocol.js';

export const HTTP_URL_RE = /^https?:\/\//i;

// WHY the signal is a parameter.
// A caller that must be able to walk away from a request it no longer wants has no way to do it otherwise: a held poll kept answering a loop that had already been superseded, and every such request was one more consumer of the single command queue.

export async function fetchJson(url, body, timeoutMs = 30000, signal = undefined) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relay = signal
    ? () => controller.abort(signal.reason ?? new Error('request abandoned'))
    : null;
  if (relay) {
    if (signal.aborted) relay();
    else signal.addEventListener('abort', relay, { once: true });
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store'
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (error) { log.debug('RESPONSE_BODY_PARSE_FAILED', error?.message || String(error)); data = { error: text || `HTTP ${response.status}` }; }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
    if (relay) signal.removeEventListener('abort', relay);
  }
}

export function publicTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: !!tab.active,
    pinned: !!tab.pinned,
    audible: !!tab.audible,
    muted: !!tab.mutedInfo?.muted,
    status: tab.status || '',
    title: String(tab.title || '').slice(0, 1000),
    url: String(tab.url || '').slice(0, 4000)
  };
}

export function requireTabId(value) {
  if (typeof value === 'boolean') throw new Error('Invalid tabId.');
  if (typeof value === 'string' && value.trim() === '') throw new Error('Invalid tabId.');
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0) throw new Error('Invalid tabId.');
  return id;
}

export async function resolveTabId(params = {}) {
  if (params.tabId != null) return requireTabId(params.tabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  return tab.id;
}

export async function waitTabReady(tabId, timeoutMs = 12000) {
  const deadline = Date.now() + clamp(timeoutMs, 100, 30000, 12000);
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return publicTab(tab);
    await sleep(75);
  }
  return publicTab(await chrome.tabs.get(tabId));
}

async function ensureContent(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!HTTP_URL_RE.test(tab.url || '')) throw new Error('Page primitives only support http/https tabs.');
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { scope: 'opera-agent-content', method: 'content.ping', params: {} });
    if (pong?.ok) return;
  } catch (error) {
    log.debug('CONTENT_PING_FAILED', error?.message || String(error));
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/agent-log.js', 'semantic-identity.js', 'semantic-views.js', 'role-reconcile.js', 'hover-settle.js', 'content.js'] });
}

export async function contentCall(tabId, method, params = {}) {

  const message = { scope: 'opera-agent-content', method, params };
  let response = null;
  try {
    response = await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {

    log.debug('CONTENT_SEND_FAILED', error?.message || String(error));
  }
  if (response && response.ok === false) throw new Error(response.error || 'Page bridge error.');
  if (!response) {
    await ensureContent(tabId);
    response = await chrome.tabs.sendMessage(tabId, message);
    if (!response) throw new Error('No response from page bridge.');
    if (response.ok === false) throw new Error(response.error || 'Page bridge error.');
  }
  return response;
}

export async function executeInTab(tabId, method, params = {}) {
  try {
    const r = await contentCall(tabId, method, params);
    return r;
  } catch (error) {
    return { ok: false, error: { code: 'CONTENT_CALL_FAILED', message: String(error?.message || error).slice(0, 300) } };
  }
}
