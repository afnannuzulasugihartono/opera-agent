/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: scan-page - scan a page into one self-contained html file in Downloads: live DOM harvest, assets fetched by the worker (CORS-free by host permission), rewritten on a parsed copy inside the page.
 * @state: page.scan primitive; sensitive-surface refusal first; phases collect -> fetch (bytes budget) -> inline -> one file; returns a manifest, never the page's own bytes twice.
 * @dependencies: tab-content, private-tabs, capture.js helpers, protocol constants.
 */

// WHY THE FETCH LIVES IN THE WORKER: a content script shares the page's CORS restrictions, so the one place that may read any host the user asked about is the worker - the page only parses, it never sends.
// WHY THE LIVE DOM IS NEVER MUTATED: the rewrite happens on a DOMParser copy; the open page keeps its state and its scroll, and the mirror never re-executes itself on import.

import { nowIso } from './utils.js';
import { HTTP_URL_RE, contentCall, recordScanCall, resolveTabId } from './tab-content.js';
import { isPrivateTab } from './private-tabs.js';
import { codedError, assertCaptureFramesSafe } from './capture.js';
import { waitForDownloadByFilename } from './download-wait.js';
import { isRecord } from '../lib/guards.js';

type ScanAsset =
  | { kind: 'css-raw'; content: string; mime: string }
  | { kind: 'css'; content: string; mime: string }
  | { kind: 'text'; content: string; integrity: string; mime: string }
  | { kind: 'data'; dataUrl: string; bytes: number; mime: string };

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MIN_MAX_BYTES = 512 * 1024;
const MAX_MAX_BYTES = 25 * 1024 * 1024;
const ASSET_TIMEOUT_MS = 15000;
const MAX_ASSETS_FROZEN = 400;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_PARALLEL = 6;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number.parseInt(String(value), 10);

  if (!Number.isFinite(number)) return fallback;

  return Math.min(max, Math.max(min, number));
}

function cleanFilename(value: unknown, tabUrl: string): string {
  const raw = String(value || '').trim();

  if (raw) {
    const safe = raw.replace(/[\\/:*?<>|\x00-\x1f]/g, '-').replace(/\s+/g, '-');

    if (safe && safe !== '.' && safe !== '..') return safe.slice(0, 120);
  }

  try {
    const host = new URL(tabUrl).hostname.replace(/[^a-z0-9.-]/gi, '-');

    if (host) return `opera-agent-scan-${host}-${Date.now()}.html`;
  } catch {

  }

  return `opera-agent-scan-${Date.now()}.html`;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(offset, offset + chunk)));
  }

  return btoa(binary);
}

async function fetchBytes(url: string): Promise<{ ok: false; reason: string } | { ok: true; bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);

  try {
    const response = await fetch(url, { credentials: 'include', redirect: 'follow', signal: controller.signal });

    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_ASSET_BYTES) return { ok: false, reason: 'ASSET_TOO_LARGE' };

    const contentType = String(response.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() ?? '';

    return { ok: true, bytes: new Uint8Array(buffer), mime: contentType };
  } catch (error) {
    if (isRecord(error) && error.name === 'AbortError') return { ok: false, reason: 'FETCH_TIMEOUT' };

    return { ok: false, reason: String(error instanceof Error ? error.message : error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

function dataUrlOf(bytes: Uint8Array, mime?: string | undefined): string {
  return `data:${mime || 'application/octet-stream'};base64,${base64(bytes)}`;
}

async function sri384(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-384', bytes);

  return `sha384-${base64(new Uint8Array(digest))}`;
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// WHY NO REGEX.
// Super-linear CSS-URL backtracking is gone when the walk is a character scanner: find "url(", skip whitespace, honor an optional quote, then take everything up to the closing paren.

function cssUrlTargets(css: string): Array<{ raw: string; start: number; end: number }> {
  const urls: Array<{ raw: string; start: number; end: number }> = [];
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('url(', i);
    if (at === -1) break;
    let cursor = at + 4;
    while (cursor < css.length && /\s/.test(css[cursor] as string)) cursor += 1;
    const quote = css[cursor] === "'" || css[cursor] === '"' ? css[cursor] : null;
    const rawStart = quote ? cursor + 1 : cursor;
    const limit = quote === "'" ? "'" : quote === '"' ? '"' : ')';
    let rawEnd = rawStart;
    while (rawEnd < css.length && css[rawEnd] !== limit) rawEnd += 1;
    urls.push({ raw: css.slice(rawStart, rawEnd), start: at, end: limit === ')' ? rawEnd + 1 : rawEnd + 2 });
    i = limit === ')' ? rawEnd + 1 : rawEnd + 2;
  }
  return urls;
}

function cssWithFonts(css: string, baseUrl: string, fontMap: Map<string, ScanAsset>): string {
  const urls = cssUrlTargets(css);

  const seen = new Set();
  const replacements: Array<{ start: number; end: number; value: string }> = [];

  for (const target of urls) {
    const raw = target.raw.trim();

    if (!raw || /^(data:|#)/i.test(raw)) continue;

    let absolute: string | undefined;

    try {
      absolute = new URL(raw, baseUrl).href;
    } catch {
      continue;
    }

    if (seen.has(absolute)) continue;

    seen.add(absolute);

    const fetched = fontMap.get(absolute);

    if (fetched && fetched.kind === 'data') {
      replacements.push({ start: target.start, end: target.end, value: `url(${fetched.dataUrl})` });
    }
  }

  if (replacements.length === 0) return css;

  const ordered = [...replacements].sort((left, right) => right.start - left.start);
  let output = css;
  for (const replacement of ordered) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  }

  return output;
}

export async function scanPage(tabId: unknown, params: Record<string, unknown> | undefined, _context: unknown) {
  const requestedTabId = tabId || (params && params.tabId);

  const id = await resolveTabId({ ...params, tabId: requestedTabId });

  const tab = await chrome.tabs.get(id);

  if (!HTTP_URL_RE.test(tab.url || '')) throw codedError('CAPTURE_BLOCKED', 'Scans only support HTTP/HTTPS tabs.', { tabId: id });

  if (tab.incognito) throw codedError('CAPTURE_BLOCKED', 'Scans are blocked in incognito tabs.', { tabId: id, reason: 'INCOGNITO' });

  if (await isPrivateTab(id)) throw codedError('CAPTURE_BLOCKED', 'This tab was marked private in the Opera Agent popup.', { tabId: id, reason: 'USER_PRIVATE' });

  const policy = await contentCall(id, 'page.capture_policy', {});

  if (!policy?.allowed) {
    throw codedError('CAPTURE_BLOCKED', 'Scan blocked because a visible password, OTP, payment, or other sensitive field is present.', {
      tabId: id,
      reason: policy?.reason || 'SENSITIVE_SURFACE'
    });
  }

  await assertCaptureFramesSafe(id);

  const maxBytes = clampInt(params?.maxBytes, DEFAULT_MAX_BYTES, MIN_MAX_BYTES, MAX_MAX_BYTES);

  const collected = await recordScanCall(id, 'page.scan_collect', {});

  if (!collected || collected.error === 'SCAN_MODULE_MISSING' || !collected.url) {
    throw codedError('SCAN_MODULE_MISSING', 'The page could not list its assets.', { tabId: id });
  }

  const assetUrls = new Set<string>();

  for (const url of collected.stylesheets) assetUrls.add(url);
  for (const script of collected.scripts) assetUrls.add(script.url);
  for (const image of collected.images) assetUrls.add(image.url);
  for (const icon of collected.icons) assetUrls.add(icon.url);
  for (const url of collected.srcset) assetUrls.add(url);
  for (const source of collected.sources) assetUrls.add(source.url);

  const urlList = [...assetUrls].slice(0, MAX_ASSETS_FROZEN);
  const assets: Record<string, ScanAsset> = {};
  const failures: Array<{ url: string; reason: string }> = [];
  const fontUrls = new Set<string>();

  const work = async (url: string) => {
    const fetched = await fetchBytes(url);

    if (!fetched.ok) {
      failures.push({ url, reason: fetched.reason });

      return;
    }

    const isCss = /(?:\.css(?:[?#].*)?$)/i.test(url) || fetched.mime.includes('text/css');

    if (isCss) {
      const text = utf8(fetched.bytes);

      const fontRefs = cssUrlTargets(text)
        .map((target) => target.raw.trim())
        .filter((raw) => raw && !/^(data:|#)/i.test(raw))
        .map((raw) => {
          try {
            return new URL(raw, url).href;
          } catch {
            return null;
          }
        })
        .filter((href) => href !== null);

      for (const fontUrl of fontRefs) fontUrls.add(fontUrl);

      assets[url] = { kind: 'css-raw', content: text, mime: 'text/css' };

      return;
    }

    const isScript = /(?:\.(?:js|mjs)(?:[?#].*)?$)/i.test(url) || fetched.mime.includes('javascript') || /^(application|text)\/(java|ecma)script/.test(fetched.mime);

    if (isScript) {
      assets[url] = { kind: 'text', content: utf8(fetched.bytes), integrity: await sri384(fetched.bytes), mime: fetched.mime };

      return;
    }

    assets[url] = { kind: 'data', dataUrl: dataUrlOf(fetched.bytes, fetched.mime), bytes: fetched.bytes.byteLength, mime: fetched.mime };
  };

  for (let start = 0; start < urlList.length; start += MAX_PARALLEL) {
    await Promise.all(urlList.slice(start, start + MAX_PARALLEL).map((url) => work(url)));
  }

  for (const fontUrl of [...fontUrls]) {
    const fetched = await fetchBytes(fontUrl);

    if (!fetched.ok) {
      failures.push({ url: fontUrl, reason: fetched.reason });

      continue;
    }

    assets[fontUrl] = { kind: 'data', dataUrl: dataUrlOf(fetched.bytes, fetched.mime), bytes: fetched.bytes.byteLength, mime: fetched.mime };
  }

  for (const [url, asset] of Object.entries(assets)) {
    if (asset.kind === 'css-raw') {
      const fontMap = new Map(Object.entries(assets));

      assets[url] = { kind: 'css', content: cssWithFonts(asset.content, url, fontMap), mime: 'text/css' };
    }
  }

  const filename = cleanFilename(params?.filename, collected.url);

  const out = await recordScanCall(id, 'page.scan_inline', { assets, filename });

  if (!out?.ok) {
    throw codedError(out?.error || 'SCAN_INLINE_FAILED', 'The page could not inline its scan.', { tabId: id });
  }

  if (out.htmlBytes > maxBytes) {
    throw codedError('SCAN_TOO_LARGE', `The scan is ${out.htmlBytes} bytes, past the ${maxBytes} budget. Pass a larger maxBytes or scan a smaller page.`, {
      tabId: id,
      bytes: out.htmlBytes,
      budget: maxBytes
    });
  }

  // WHY THE DOWNLOAD IS WRITTEN FROM THE WORKER: a page-initiated download goes through the browser's user-driven "ask where to save each file" flow, so the caller was stopped by a Save dialog that no amount of silent timing would have avoided.
  // The service worker may call chrome.downloads.download with saveAs:false, which bypasses that dialog and writes to the default downloads folder straight away; the filename is ours to choose here.
  // The data URL is assembled in-memory; the browser may not amend the filename or fail through an assister's heuristic.
  await new Promise<void>((resolve, reject) => {
    const bytes = new TextEncoder().encode(out.html);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    const url = `data:text/html;base64,${btoa(binary)}`;
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      const lastError = chrome.runtime?.lastError;
      if (lastError || !downloadId) reject(codedError('DOWNLOAD_FAILED', lastError?.message || 'downloads.download refused the file.', { filename }));
      else resolve();
    });
  });

  const item = await waitForDownloadByFilename(filename, 60000);

  const inlined = out.inlined;

  return {
    kind: 'scan',
    scan: {
      filename,
      path: item.filename || filename,
      bytes: item.fileSize || 0,
      documentBytes: out.documentBytes,
      capturedAt: nowIso(),
      inlined: {
        stylesheets: inlined.stylesheets,
        scripts: inlined.scripts,
        images: inlined.images,
        icons: inlined.icons,
        srcset: inlined.srcset
      },
      keptAbsolute: out.kept,
      fontsInlined: fontUrls.size,
      failures: failures.slice(0, 64),
      shadowRoots: 'not serialized by outerHTML',
      note: 'A scan is the rendered light DOM, not a live page; scripts may re-run on open.'
    },
    tabId: id,
    page: {
      url: collected.url,
      title: collected.title
    }
  };
}
