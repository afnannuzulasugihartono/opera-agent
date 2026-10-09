// @last-edited: 2026-10-09 UTC+7.
// @title: capture — debugger attach, frame safety probes, ax summary and the screenshot memo.
// @state: owns screenshotCache; private-tabs and execute-pull clear it through this import, which is why this module must never import either of them.
// @dependencies: log, ax-summary, debugger-session.

import { log } from '../lib/log.js';
import { buildAxSummary } from '../lib/ax-summary.js';
import { registerDebuggerSession, releaseDebuggerSession } from '../lib/debugger-session.js';

const SCREENSHOT_CACHE_MS = 750;
const SCREENSHOT_CACHE_LIMIT = 8;

export const screenshotCache = new Map();

export function captureFramePrivacyProbe() {
  const sensitivePattern = /(?:password|passwd|passcode|pin\b|one[-_ ]?time|otp\b|2fa|two[-_ ]?factor|verification\s*code|security\s*code|cvv|cvc|card\s*(?:code|number)|credit\s*card|expiry|expiration|payment)/i;
  const fields = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')];
  const sensitive = fields.some((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) return false;
    const type = String(element.getAttribute('type') || '').toLowerCase();
    const autocomplete = String(element.getAttribute('autocomplete') || '').toLowerCase();
    const labels = element.labels ? [...element.labels].map((label) => label.textContent || '').join(' ') : '';
    const descriptor = [
      type,
      autocomplete,
      element.getAttribute('name'),
      element.getAttribute('id'),
      element.getAttribute('placeholder'),
      element.getAttribute('aria-label'),
      labels
    ].filter(Boolean).join(' ');
    return type === 'password' || type === 'file' || /(?:current-password|new-password|one-time-code)/i.test(autocomplete) || sensitivePattern.test(descriptor);
  });
  return { sensitive };
}

export async function assertCaptureFramesSafe(tabId) {
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: captureFramePrivacyProbe
    });
    if (frames.some((frame) => frame.result?.sensitive)) {
      throw codedError('CAPTURE_BLOCKED', 'Screenshot blocked because a visible sensitive field is present in the page or an embedded frame.', {
        tabId,
        reason: 'SENSITIVE_FRAME'
      });
    }
  } catch (error) {
    if (error?.code === 'CAPTURE_BLOCKED') throw error;
    throw codedError('CAPTURE_BLOCKED', 'Screenshot blocked because embedded-frame privacy could not be verified.', {
      tabId,
      reason: 'PRIVACY_SCAN_FAILED'
    });
  }
}

export async function withDebugger(tabId, context, work) {
  const shared = context?.debuggerSession;
  if (shared) {
    // Phase D: a burst step may target another tab. Chrome allows one debugger
    // attachment per tab but not two at once, so switching tabs releases the
    // previous session before attaching the next. The release is a real detach:
    // a session left attached keeps Chrome's "started debugging this browser"
    // bar on the user's tab.
    if (shared.tabId !== tabId) {
      await releaseDebuggerSession(shared, log);
    }
    if (!shared.attached) {
      await chrome.debugger.attach({ tabId }, '1.3');
      shared.tabId = tabId;
      shared.attached = true;
      registerDebuggerSession(shared);
    }
    return work({ tabId });
  }

  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    return await work(target);
  } finally {
    if (attached) {
      try { await chrome.debugger.detach(target); } catch (error) { log.debug('DEBUGGER_DETACH_FAILED', error?.message || String(error)); }
    }
  }
}

export function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

// Layer B: semantically poor surfaces (canvas apps, hidden
// DOM mirrors) keep their accessibility tree even when DOM text is empty. The
// snapshot runs once per poor read through the bounded debugger session and is
// filtered by the pure value-free builder; every failure mode fails open (no
// axSummary, the observation result stays intact).

export async function collectAxSummary(tabId, context) {
  try {
    return await withDebugger(tabId, context, async (target) => {
      try { await chrome.debugger.sendCommand(target, 'Accessibility.enable'); } catch (error) { log.warn('ACCESSIBILITY_ENABLE_FAILED', error?.message || String(error)); }
      let tree;
      try {
        tree = await chrome.debugger.sendCommand(target, 'Accessibility.getFullAXTree');
      } finally {
        try { await chrome.debugger.sendCommand(target, 'Accessibility.disable'); } catch (error) { log.debug('ACCESSIBILITY_DISABLE_FAILED', error?.message || String(error)); }
      }
      const summary = buildAxSummary(tree?.nodes || []);
      return summary.items.length > 0 ? summary : null;
    });
  } catch (error) {
    log.debug('AX_SUMMARY_COLLECTION_FAILED', error?.message || String(error));
    return null;
  }
}

export function screenshotBytes(data) {
  try { return atob(data).length; } catch (error) { log.debug('SCREENSHOT_BYTES_PARSE_FAILED', error?.message || String(error)); return Number.POSITIVE_INFINITY; }
}

export async function screenshotHash(data) {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function screenshotLooksBlank(data) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return { checked: false, blank: false };
  try {
    const raw = atob(data);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 16, 16);
    bitmap.close?.();
    const pixels = context.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    let sumSquares = 0;
    const count = pixels.length / 4;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
      sum += luminance;
      sumSquares += luminance * luminance;
    }
    const mean = sum / count;
    const variance = Math.max(0, sumSquares / count - mean * mean);
    return { checked: true, blank: variance < 2 && (mean < 3 || mean > 252), mean, variance };
  } catch (error) {
    log.debug('SCREENSHOT_BLANK_CHECK_FAILED', error?.message || String(error));
    return { checked: false, blank: false };
  }
}

export function cachedScreenshot(tabId, cacheKey, previousHash) {
  const cached = screenshotCache.get(tabId);
  if (!cached || cached.cacheKey !== cacheKey || Date.now() - cached.savedAt > SCREENSHOT_CACHE_MS) return null;
  const screenshot = { ...cached.screenshot, cached: true };
  if (previousHash && previousHash.toLowerCase() === screenshot.sha256) {
    delete screenshot.data;
    screenshot.unchanged = true;
  }
  return screenshot;
}

export function rememberScreenshot(tabId, cacheKey, screenshot) {
  screenshotCache.delete(tabId);
  screenshotCache.set(tabId, { cacheKey, savedAt: Date.now(), screenshot });
  while (screenshotCache.size > SCREENSHOT_CACHE_LIMIT) screenshotCache.delete(screenshotCache.keys().next().value);
}

// WHY element capture and not tab capture: chrome.tabCapture refuses callers
// without a user gesture ("Extension has not been invoked"), which an
// autonomous agent never has — measured, not assumed, in headed Chromium 153.
// Tapping the media element's own output through WebAudio needs no special
// permission and no gesture. The element keeps playing to the speakers; the
// recorder only forks a copy. Cross-origin media without CORS headers records
// silence instead of failing, so a silent transcript proves nothing by itself.
