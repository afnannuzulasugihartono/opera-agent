// @last-edited: 2026-11-08 UTC+7.
// @title: capture-page — element and tab capture driven through the debugger.
// @state: owns MAX_SCREENSHOT_BYTES and the tile ladder a full page falls back to when one image cannot be read; deliberately separate from capture.js — merging them would close the cycle capture -> private-tabs -> capture.
// @dependencies: utils, tab-content, private-tabs, capture, protocol.

import { clamp } from '../lib/protocol.js';
import { nowIso } from './utils.js';
import { contentCall, HTTP_URL_RE } from './tab-content.js';
import { isPrivateTab } from './private-tabs.js';
import {
  assertCaptureFramesSafe,
  withDebugger,
  codedError,
  screenshotBytes,
  screenshotHash,
  screenshotLooksBlank,
  cachedScreenshot,
  rememberScreenshot,
} from './capture.js';

const MAX_SCREENSHOT_BYTES = 220 * 1024;
const TILE_SLICE_BYTES = 320 * 1024;
const READABLE_SCALE_MIN = 0.2;
const READABLE_WIDTH_MIN = 320;
const MIN_FRAME_BYTES = 512;

async function pickFrame(target, clip, options) {
  const { quality, baseScale, beyond, context, tabId, allowBlank = false } = options;
  const attempts = [
    { quality, scale: baseScale },
    { quality: 40, scale: baseScale },
    { quality: 40, scale: baseScale * 0.75 },
    { quality: 40, scale: baseScale * 0.55 }
  ].filter((attempt, index, all) => index === all.findIndex((item) => item.quality === attempt.quality && item.scale === attempt.scale));
  let chosen = null;
  let sawTooLarge = false;
  let sawTooSmall = false;
  for (const attempt of attempts) {
    if (context?.deadline && Date.now() >= context.deadline - 100) throw codedError('CAPTURE_TIMEOUT', 'Screenshot capture deadline reached.', { tabId });
    const response = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: attempt.quality,
      fromSurface: true,
      captureBeyondViewport: beyond,
      optimizeForSpeed: true,
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: attempt.scale }
    });
    const data = String(response?.data || '');
    const bytes = screenshotBytes(data);
    if (bytes < MIN_FRAME_BYTES) {
      sawTooSmall = true;
      continue;
    }
    if (bytes > MAX_SCREENSHOT_BYTES) {
      sawTooLarge = true;
      continue;
    }
    chosen = { data, bytes, quality: attempt.quality, scale: attempt.scale };
    break;
  }
  if (!chosen) {
    if (allowBlank && sawTooSmall) return null;
    if (sawTooLarge) throw codedError('SCREENSHOT_TOO_LARGE', `Screenshot could not be reduced below ${MAX_SCREENSHOT_BYTES} bytes.`, { tabId, maxBytes: MAX_SCREENSHOT_BYTES });
    if (sawTooSmall) throw codedError('SCREENSHOT_TOO_SMALL', 'Screenshot capture produced no usable image data; the page may not have rendered yet.', { tabId, minBytes: MIN_FRAME_BYTES });
    throw codedError('SCREENSHOT_TOO_LARGE', `Screenshot could not be reduced below ${MAX_SCREENSHOT_BYTES} bytes.`, { tabId, maxBytes: MAX_SCREENSHOT_BYTES });
  }
  const blank = await screenshotLooksBlank(chosen.data);
  if (blank.blank && !allowBlank) throw codedError('BLANK_SCREENSHOT', 'The captured frame appears blank; wait for the page to render and try again.', { tabId });
  return { ...chosen, blank: blank.blank, blankChecked: blank.checked };
}

async function captureTiles(target, content, stripHeight, tileOffset, context, tabId) {
  const strip = Math.max(1, Math.floor(Number(stripHeight) || 1));
  const total = Math.max(1, Math.ceil(content.height / strip));
  const start = Math.max(0, Math.min(Math.trunc(Number(tileOffset) || 0), total));
  const tiles = [];
  let bytesSoFar = 0;
  let index = start;
  while (index < total) {
    const top = index * strip;
    const height = Math.min(strip, content.height - top);
    if (!(height > 0)) break;
    const frame = await pickFrame(target, { x: content.x, y: content.y + top, width: content.width, height }, {
      quality: 60, baseScale: 1, beyond: true, context, tabId, allowBlank: true
    });
    if (!frame) {
      index += 1;
      continue;
    }
    if (tiles.length && bytesSoFar + frame.bytes > TILE_SLICE_BYTES) break;
    const sha256 = await screenshotHash(frame.data);
    tiles.push({
      index,
      y: Math.round(content.y + top),
      width: Math.max(1, Math.round(content.width * frame.scale)),
      height: Math.max(1, Math.round(height * frame.scale)),
      bytes: frame.bytes,
      sha256,
      ...(frame.blank ? { blank: true } : {}),
      data: frame.data
    });
    bytesSoFar += frame.bytes;
    index += 1;
  }
  const last = tiles[tiles.length - 1];
  return {
    tiles,
    documentHeight: Math.round(content.height),
    tileCount: total,
    coveredHeight: last ? last.y + last.height - Math.round(content.y) : 0,
    hasMore: index < total,
    nextTileOffset: index < total ? index : null,
    sha256: await screenshotHash(tiles.map((tile) => tile.sha256).join(''))
  };
}

function imageResult(clip, chosen, capturedAt) {
  return {
    mimeType: 'image/jpeg',
    data: chosen.data,
    sha256: capturedAt.sha256,
    encodedBytes: chosen.bytes,
    width: Math.max(1, Math.round(clip.width * chosen.scale)),
    height: Math.max(1, Math.round(clip.height * chosen.scale)),
    crop: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
    quality: chosen.quality,
    blankChecked: chosen.blankChecked,
    unchanged: false,
    cached: false,
    capturedAt: nowIso()
  };
}

export async function capturePage(tabId, params, context) {
  const tab = await chrome.tabs.get(tabId);
  if (!HTTP_URL_RE.test(tab.url || '')) throw codedError('CAPTURE_BLOCKED', 'Screenshots only support HTTP/HTTPS tabs.', { tabId });
  if (tab.incognito) throw codedError('CAPTURE_BLOCKED', 'Screenshots are blocked in incognito tabs.', { tabId, reason: 'INCOGNITO' });
  if (await isPrivateTab(tabId)) throw codedError('CAPTURE_BLOCKED', 'This tab was marked private in the Opera Agent popup.', { tabId, reason: 'USER_PRIVATE' });

  const policy = await contentCall(tabId, 'page.capture_policy', {});
  if (!policy.allowed) {
    throw codedError('CAPTURE_BLOCKED', 'Screenshot blocked because a visible password, OTP, payment, or other sensitive field is present.', {
      tabId,
      reason: policy.reason || 'SENSITIVE_SURFACE'
    });
  }
  await assertCaptureFramesSafe(tabId);

  const viewportWidth = Number(policy.viewport?.width);
  const viewportHeight = Number(policy.viewport?.height);
  if (!(viewportWidth > 0 && viewportHeight > 0)) throw codedError('CAPTURE_FAILED', 'The page has no capturable viewport.', { tabId });
  const fullPage = params.fullPage === true;
  if (fullPage && params.crop != null) {
    throw codedError('INVALID_CAPTURE_REGION', 'Capture fullPage and crop are exclusive: pick one.', { tabId });
  }
  const crop = params.crop || { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  if (!fullPage && (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > viewportWidth + 0.5 || y + height > viewportHeight + 0.5)) {
    throw codedError('INVALID_CAPTURE_REGION', 'Capture crop must stay inside the visible viewport.', {
      tabId,
      viewport: { width: viewportWidth, height: viewportHeight }
    });
  }

  const quality = clamp(params.quality, 40, 80, 60);
  const maxWidth = clamp(params.maxWidth, 320, 1600, 1280);
  const maxHeight = clamp(params.maxHeight, 240, 1200, 900);
  const tileOffset = Math.max(0, Math.trunc(Number(params.tileOffset) || 0));
  const previousHash = typeof params.previousHash === 'string' ? params.previousHash.toLowerCase() : '';
  const cacheKey = JSON.stringify([policy.documentId, fullPage ? 'full' : [x, y, width, height], quality, maxWidth, maxHeight]);
  const cached = cachedScreenshot(tabId, cacheKey, previousHash);
  if (cached) return { ok: true, tabId, page: { title: tab.title || '', url: tab.url || '' }, screenshot: cached };

  const outcome = await withDebugger(tabId, context, async (target) => {
    const metrics = await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics');
    const viewport = metrics?.cssVisualViewport || metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
    const pageX = Number(viewport.pageX ?? 0);
    const pageY = Number(viewport.pageY ?? 0);
    let clipX = pageX + x;
    let clipY = pageY + y;
    let clipW = width;
    let clipH = height;
    let beyond = false;
    let content = null;
    if (fullPage) {
      content = metrics?.contentSize ?? {};
      clipW = Number(content.width);
      clipH = Number(content.height);
      if (!(clipW > 0 && clipH > 0)) throw codedError('CAPTURE_FAILED', 'The page reported no content size to capture.', { tabId });
      clipX = Number(content.x ?? 0);
      clipY = Number(content.y ?? 0);
      beyond = true;
    }
    const clip = { x: clipX, y: clipY, width: clipW, height: clipH };
    const baseScale = Math.min(1, maxWidth / clipW, maxHeight / clipH);
    if (fullPage) {
      let chosen = null;
      try {
        chosen = await pickFrame(target, clip, { quality, baseScale, beyond, context, tabId });
      } catch (error) {
        chosen = null;
      }
      const readable = chosen && chosen.scale >= READABLE_SCALE_MIN && Math.round(clipW * chosen.scale) >= READABLE_WIDTH_MIN;
      if (chosen && readable) {
        const sha256 = await screenshotHash(chosen.data);
        return { kind: 'image', screenshot: imageResult(clip, chosen, { sha256 }) };
      }
      return { kind: 'tiles', ...(await captureTiles(target, clip, viewportHeight, tileOffset, context, tabId)) };
    }
    const chosen = await pickFrame(target, clip, { quality, baseScale, beyond, context, tabId });
    const sha256 = await screenshotHash(chosen.data);
    return { kind: 'image', screenshot: imageResult({ x, y, width, height }, chosen, { sha256 }) };
  });

  const page = { title: tab.title || '', url: tab.url || '' };
  if (outcome.kind === 'tiles') {
    const { tiles, ...rest } = outcome;
    if (previousHash && previousHash === outcome.sha256) {
      return { ok: true, tabId, page, ...rest, tiles: tiles.map(({ data, ...meta }) => meta), unchanged: true };
    }
    return { ok: true, tabId, page, ...rest, tiles };
  }

  const screenshot = outcome.screenshot;
  rememberScreenshot(tabId, cacheKey, screenshot);
  const responseScreenshot = { ...screenshot };
  if (previousHash && previousHash === screenshot.sha256) {
    delete responseScreenshot.data;
    responseScreenshot.unchanged = true;
  }
  return { ok: true, tabId, page, screenshot: responseScreenshot };
}