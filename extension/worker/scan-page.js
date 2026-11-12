/*
 * @last-edited: 2026-11-12 UTC+7.
 * @title: scan-page - scan a page into one self-contained html file in Downloads: live DOM harvest, assets fetched by the worker (CORS-free by host permission), rewritten on a parsed copy inside the page.
 * @state: page.scan primitive; sensitive-surface refusal first; phases collect -> fetch (bytes budget) -> inline -> one file; returns a manifest, never the page's own bytes twice.
 * @dependencies: tab-content, private-tabs, capture.js helpers, protocol constants.
 */

// WHY THE FETCH LIVES IN THE WORKER: a content script shares the page's CORS restrictions, so the one place that may read any host the user asked about is the worker - the page only parses, it never sends.
// WHY THE LIVE DOM IS NEVER MUTATED: the rewrite happens on a DOMParser copy; the open page keeps its state and its scroll, and the mirror never re-executes itself on import.

import { nowIso, sleep } from './utils.js';
import { HTTP_URL_RE, contentCall, recordScanCall, resolveTabId } from './tab-content.js';
import { isPrivateTab } from './private-tabs.js';
import { codedError, assertCaptureFramesSafe } from './capture.js';
import { waitForDownloadByFilename } from './download-wait.js';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MIN_MAX_BYTES = 512 * 1024;
const MAX_MAX_BYTES = 25 * 1024 * 1024;
const ASSET_TIMEOUT_MS = 15000;
const MAX_ASSETS_FROZEN = 400;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_PARALLEL = 6;

const sleepMs = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);

  if (!Number.isFinite(number)) return fallback;

  return Math.min(max, Math.max(min, number));
}

function cleanFilename(value, tabUrl) {
  const raw = String(value || '').trim();

  if (raw) {
    const safe = raw.replace(/[\\/:*?<>|\x00-\x1f]/g, '-').replace(/\s+/g, '-');

    if (safe && safe !== '.' && safe !== '..') return safe.slice(0, 120);
  }

  try {
    const host = new URL(tabUrl).hostname.replace(/[^a-z0-9.-]/gi, '-');

    if (host) return `opera-agent-scan-${host}-${Date.now()}.html`;
  } catch (error) {

  }

  return `opera-agent-scan-${Date.now()}.html`;
}

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk));
  }

  return btoa(binary);
}

async function fetchBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);

  try {
    const response = await fetch(url, { credentials: 'include', redirect: 'follow', signal: controller.signal });

    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_ASSET_BYTES) return { ok: false, reason: 'ASSET_TOO_LARGE' };

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

    return { ok: true, bytes: new Uint8Array(buffer), mime: contentType };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, reason: 'FETCH_TIMEOUT' };

    return { ok: false, reason: String(error?.message || error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

function dataUrlOf(bytes, mime) {
  return `data:${mime || 'application/octet-stream'};base64,${base64(bytes)}`;
}

async function sri384(bytes) {
  const digest = await crypto.subtle.digest('SHA-384', bytes);

  return `sha384-${base64(new Uint8Array(digest))}`;
}

function utf8(bytes) {
  return new TextDecoder().decode(bytes);
}

function cssWithFonts(css, baseUrl, fontMap) {
  let output = css;

  const urlPattern = new RegExp("url\\(\\s*['\"]?([^'\")]+)['\"]?\\s*\\)", 'g');

  const urls = [...css.matchAll(urlPattern)];

  const seen = new Set();

  for (const match of urls) {
    const raw = match[1].trim();

    if (!raw || /^(data:|#)/i.test(raw)) continue;

    let absolute;

    try {
      absolute = new URL(raw, baseUrl).href;
    } catch (error) {
      continue;
    }

    if (seen.has(absolute)) continue;

    seen.add(absolute);

    const fetched = fontMap.get(absolute);

    if (fetched && fetched.kind === 'data') {
      output = output.split(match[0]).join(`url(${fetched.dataUrl})`);
    }
  }

  return output;
}

export async function scanPage(tabId, params, context) {
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

  const assetUrls = new Set();

  for (const url of collected.stylesheets) assetUrls.add(url);
  for (const script of collected.scripts) assetUrls.add(script.url);
  for (const image of collected.images) assetUrls.add(image.url);
  for (const icon of collected.icons) assetUrls.add(icon.url);
  for (const url of collected.srcset) assetUrls.add(url);
  for (const source of collected.sources) assetUrls.add(source.url);

  const urlList = [...assetUrls].slice(0, MAX_ASSETS_FROZEN);
  const assets = {};
  const failures = [];
  const fontUrls = new Set();

  const work = async (url) => {
    const fetched = await fetchBytes(url);

    if (!fetched.ok) {
      failures.push({ url, reason: fetched.reason });

      return;
    }

    const isCss = /(?:\.css(?:[?#].*)?$)/i.test(url) || fetched.mime.includes('text/css');

    if (isCss) {
      const text = utf8(fetched.bytes);

      const fontRefs = [...text.matchAll(new RegExp("url\\(\\s*['\"]?([^'\")]+)['\"]?\\s*\\)", 'g'))]
        .map((match) => match[1].trim())
        .filter((raw) => raw && !/^(data:|#)/i.test(raw))
        .map((raw) => {
          try {
            return new URL(raw, url).href;
          } catch (error) {
            return null;
          }
        })
        .filter(Boolean);

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

  if (out.documentBytes > maxBytes) {
    throw codedError('SCAN_TOO_LARGE', `The scan is ${out.documentBytes} bytes, past the ${maxBytes} budget. Pass a larger maxBytes or scan a smaller page.`, {
      tabId: id,
      bytes: out.documentBytes,
      budget: maxBytes
    });
  }

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
