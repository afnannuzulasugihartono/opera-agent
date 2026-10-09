// @last-edited: 2026-10-09 UTC+7.
// @title: capture-page — element and tab capture driven through the debugger.
// @state: owns MAX_SCREENSHOT_BYTES; deliberately separate from capture.js — merging them would close the cycle capture -> private-tabs -> capture.
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
  const crop = params.crop || { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > viewportWidth + 0.5 || y + height > viewportHeight + 0.5) {
    throw codedError('INVALID_CAPTURE_REGION', 'Capture crop must stay inside the visible viewport.', {
      tabId,
      viewport: { width: viewportWidth, height: viewportHeight }
    });
  }

  const quality = clamp(params.quality, 40, 80, 60);
  const maxWidth = clamp(params.maxWidth, 320, 1600, 1280);
  const maxHeight = clamp(params.maxHeight, 240, 1200, 900);
  const previousHash = typeof params.previousHash === 'string' ? params.previousHash.toLowerCase() : '';
  const cacheKey = JSON.stringify([policy.documentId, x, y, width, height, quality, maxWidth, maxHeight]);
  const cached = cachedScreenshot(tabId, cacheKey, previousHash);
  if (cached) return { ok: true, tabId, page: { title: tab.title || '', url: tab.url || '' }, screenshot: cached };

  const screenshot = await withDebugger(tabId, context, async (target) => {
    const metrics = await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics');
    const viewport = metrics?.cssVisualViewport || metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
    const pageX = Number(viewport.pageX ?? 0);
    const pageY = Number(viewport.pageY ?? 0);
    const baseScale = Math.min(1, maxWidth / width, maxHeight / height);
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
        captureBeyondViewport: false,
        optimizeForSpeed: true,
        clip: { x: pageX + x, y: pageY + y, width, height, scale: attempt.scale }
      });
      const data = String(response?.data || '');
      const bytes = screenshotBytes(data);

      // A frame under 512 bytes carries no image, so it is skipped without
      // counting as a reduction failure; the refusal below names it exactly.

      if (bytes < 512) {
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
      if (sawTooLarge) throw codedError('SCREENSHOT_TOO_LARGE', `Screenshot could not be reduced below ${MAX_SCREENSHOT_BYTES} bytes.`, { tabId, maxBytes: MAX_SCREENSHOT_BYTES });
      if (sawTooSmall) throw codedError('SCREENSHOT_TOO_SMALL', 'Screenshot capture produced no usable image data; the page may not have rendered yet.', { tabId, minBytes: 512 });
      throw codedError('SCREENSHOT_TOO_LARGE', `Screenshot could not be reduced below ${MAX_SCREENSHOT_BYTES} bytes.`, { tabId, maxBytes: MAX_SCREENSHOT_BYTES });
    }
    const blank = await screenshotLooksBlank(chosen.data);
    if (blank.blank) throw codedError('BLANK_SCREENSHOT', 'The captured frame appears blank; wait for the page to render and try again.', { tabId });
    const sha256 = await screenshotHash(chosen.data);
    return {
      mimeType: 'image/jpeg',
      data: chosen.data,
      sha256,
      encodedBytes: chosen.bytes,
      width: Math.max(1, Math.round(width * chosen.scale)),
      height: Math.max(1, Math.round(height * chosen.scale)),
      sourceWidth: width,
      sourceHeight: height,
      crop: { x, y, width, height },
      quality: chosen.quality,
      blankChecked: blank.checked,
      unchanged: false,
      cached: false,
      capturedAt: nowIso()
    };
  });

  rememberScreenshot(tabId, cacheKey, screenshot);
  const responseScreenshot = { ...screenshot };
  if (previousHash && previousHash === screenshot.sha256) {
    delete responseScreenshot.data;
    responseScreenshot.unchanged = true;
  }
  return { ok: true, tabId, page: { title: tab.title || '', url: tab.url || '' }, screenshot: responseScreenshot };
}
