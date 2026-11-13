// @last-edited: 2026-11-09 UTC+7.
// @title: tab-content — content-script injection and the messaging bridge into a tab.
// @state: owns HTTP_URL_RE and the ensureContent script list; that list is pinned by manifest.content_scripts[0].js and must not be edited.
// @dependencies: utils, log, protocol.

import { log } from '../lib/log.js';
import { sleep } from './utils.js';
import { clamp } from '../lib/protocol.js';

export const HTTP_URL_RE = /^https?:\/\//i;

// WHY the signal is a parameter.
// A caller that must be able to walk away from a request it no longer wants has no way to do it otherwise: a held poll kept answering a loop that had already been superseded, and every such request was one more consumer of the single command queue.

export async function fetchJson(url: string | URL, body: Record<string, unknown>, timeoutMs: number = 30000, signal?: AbortSignal | undefined): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relay = signal
    ? () => controller.abort(signal.reason ?? new Error('request abandoned'))
    : null;
  if (signal && relay) {
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
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch (error) { log.error('RESPONSE_BODY_PARSE_FAILED', error instanceof Error && error.message ? error.message : String(error)); data = { error: text || `HTTP ${response.status}` }; }
    if (!response.ok) throw new Error(String(data.error || `HTTP ${response.status}`));
    return data;
  } finally {
    clearTimeout(timer);
    if (signal && relay) signal.removeEventListener('abort', relay);
  }
}

// WHY the assertion: chrome.tabs.update() answers Tab | undefined (a discarded tab), and a caller passes that through.
// The JS this replaces crashed the same way on an undefined tab; the assertion keeps that runtime behavior instead of fabricating an empty tab object.

export function publicTab(tab: chrome.tabs.Tab | undefined) {
  const source = tab as chrome.tabs.Tab;
  return {
    id: source.id,
    windowId: source.windowId,
    active: !!source.active,
    pinned: !!source.pinned,
    audible: !!source.audible,
    muted: !!source.mutedInfo?.muted,
    status: source.status || '',
    title: String(source.title || '').slice(0, 1000),
    url: String(source.url || '').slice(0, 4000)
  };
}

export function requireTabId(value: unknown): number {
  if (typeof value === 'boolean') throw new Error('Invalid tabId.');
  if (typeof value === 'string' && value.trim() === '') throw new Error('Invalid tabId.');
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0) throw new Error('Invalid tabId.');
  return id;
}

export async function resolveTabId(params?: { tabId?: unknown } | undefined): Promise<number> {
  if (params?.tabId != null) return requireTabId(params.tabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  return tab.id;
}

export async function waitTabReady(tabId: number, timeoutMs: number = 12000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + clamp(timeoutMs, 100, 30000, 12000);
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return publicTab(tab);
    await sleep(75);
  }
  return publicTab(await chrome.tabs.get(tabId));
}

async function ensureContent(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!HTTP_URL_RE.test(tab.url || '')) throw new Error('Page primitives only support http/https tabs.');
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { scope: 'opera-agent-content', method: 'content.ping', params: {} });
    if (pong?.ok) return;
  } catch (error) {
    log.debug('CONTENT_PING_FAILED', error instanceof Error && error.message ? error.message : String(error));
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['worker/pair-cookie.js', 'lib/agent-log.js', 'lib/page-map.js', 'semantic-identity.js', 'semantic-views.js', 'role-reconcile.js', 'hover-settle.js', 'content/record-scan.js', 'content.js'] });
}

export async function contentCall(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {

  const message = { scope: 'opera-agent-content', method, params };
  let response = null;
  try {
    response = await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {

    log.debug('CONTENT_SEND_FAILED', error instanceof Error && error.message ? error.message : String(error));
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

export async function recordScanCall(tabId: number, method: string, params: Record<string, unknown> = {}) {

  const message = { scope: 'opera-agent-record-scan', method, params };
  let response = null;
  try {
    response = await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {

    log.debug('RECORD_SCAN_SEND_FAILED', error instanceof Error && error.message ? error.message : String(error));
  }
  if (response) return response;
  await ensureContent(tabId);
  response = await chrome.tabs.sendMessage(tabId, message);
  if (!response) throw new Error('No response from the record-scan bridge.');
  return response;
}

export async function executeInTab(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  try {
    const r = await contentCall(tabId, method, params);
    return r;
  } catch (error) {
    return { ok: false, error: { code: 'CONTENT_CALL_FAILED', message: String((error instanceof Error ? error.message : '') || error).slice(0, 300) } };
  }
}
