import {
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  METHOD_SPECS,
  BURST_ACTION_METHODS,
  BURST_MAX_TIMEOUT_MS,
  validateCommand,
  normalizeError,
  safeUrl,
  clamp
} from './lib/protocol.js';
import { evaluateRules, validateRule } from './lib/watch.js';
import { pollDelays, classifyResolve, makeNotReady, attachResolution } from './lib/action-pipeline.js';
import { decideFocusGate, FOCUS_GATE_SETTLE_MS } from './lib/focus-gate.js';
import { resolveKeyInput } from './lib/keyboard.js';
// R9-C: the same file the content script loads via the manifest. It declares no
// export statements, so this is a valid side-effect import that publishes the
// pure helpers on globalThis — one source of truth for both contexts, and no
// second, drifting copy of the role table.
import './role-reconcile.js';
const { axRoleIndex, reconcileElements, hasRoleGap } = globalThis.OperaAgentRoleReconcile || {};
import { buildAxSummary } from './lib/ax-summary.js';
import { recordPopup, popupsSince, resolvePopupOpener, POPUP_LOG_LIMIT } from './lib/popup-events.js';

const DEFAULT_BRIDGE_URL = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-bridge';
const STORAGE_KEYS = ['paired', 'deviceName', 'deviceToken', 'bridgeUrl', 'deviceId'];
const PRIVATE_TABS_KEY = 'privateTabIds';
const WAKE_ALARM = 'opera-agent-wake';
const HTTP_URL_RE = /^https?:\/\//i;
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_BURST_RESULT_BYTES = 256 * 1024;
const MAX_SCREENSHOT_BYTES = 220 * 1024;
const SCREENSHOT_CACHE_MS = 750;
const SCREENSHOT_CACHE_LIMIT = 8;
const SEMANTIC_RUNTIME_EPOCH = crypto.randomUUID();
// U-P1 (research P1): canvas-class pages expose almost no DOM text while their
// accessibility tree still carries state. A read this text-poor attaches a
// bounded read-only axSummary; rich pages keep the unchanged fast path.
const AX_SUMMARY_TEXT_POVERTY_CHARS = 400;

let loopPromise = null;
let loopGeneration = 0;
let connectionState = {
  status: 'starting',
  lastError: null,
  lastConnectedAt: null,
  lastCommandAt: null,
  retryMs: 250
};
const screenshotCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getConfig() {
  const cfg = await chrome.storage.local.get(STORAGE_KEYS);
  return {
    paired: !!cfg.paired,
    deviceName: String(cfg.deviceName || 'opera'),
    deviceToken: String(cfg.deviceToken || ''),
    deviceId: String(cfg.deviceId || ''),
    bridgeUrl: String(cfg.bridgeUrl || DEFAULT_BRIDGE_URL)
  };
}

async function setState(patch) {
  connectionState = { ...connectionState, ...patch };
  try {
    await chrome.storage.local.set({ connectionState });
  } catch {}
}

async function fetchJson(url, body, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `HTTP ${response.status}` }; }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function publicTab(tab) {
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

function requireTabId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0) throw new Error('Invalid tabId.');
  return id;
}

async function resolveTabId(params = {}) {
  if (params.tabId != null) return requireTabId(params.tabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  return tab.id;
}

async function waitTabReady(tabId, timeoutMs = 12000) {
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
  } catch {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['semantic-identity.js', 'semantic-views.js', 'content.js'] });
}

async function contentCall(tabId, method, params = {}) {
  await ensureContent(tabId);
  const response = await chrome.tabs.sendMessage(tabId, { scope: 'opera-agent-content', method, params });
  if (!response) throw new Error('No response from page bridge.');
  if (response.ok === false) throw new Error(response.error || 'Page bridge error.');
  return response;
}

async function executeInTab(tabId, method, params = {}) {
  try {
    const r = await contentCall(tabId, method, params);
    return r;
  } catch (error) {
    return { ok: false, error: { code: 'CONTENT_CALL_FAILED', message: String(error?.message || error).slice(0, 300) } };
  }
}

async function privateTabIds() {
  const stored = await chrome.storage.local.get(PRIVATE_TABS_KEY);
  return new Set((Array.isArray(stored[PRIVATE_TABS_KEY]) ? stored[PRIVATE_TABS_KEY] : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id >= 0));
}

async function isPrivateTab(tabId) {
  return (await privateTabIds()).has(tabId);
}

async function setPrivateTab(tabId, value) {
  const ids = await privateTabIds();
  if (value) ids.add(tabId); else ids.delete(tabId);
  await chrome.storage.local.set({ [PRIVATE_TABS_KEY]: [...ids].slice(-200) });
  screenshotCache.delete(tabId);
  return value;
}

function captureFramePrivacyProbe() {
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

async function assertCaptureFramesSafe(tabId) {
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

async function withDebugger(tabId, context, work) {
  const shared = context?.debuggerSession;
  if (shared) {
    if (shared.tabId !== tabId) throw new Error('Burst debugger cannot switch tabs.');
    if (!shared.attached) {
      await chrome.debugger.attach({ tabId }, '1.3');
      shared.attached = true;
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
      try { await chrome.debugger.detach(target); } catch {}
    }
  }
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

// U-P1 Layer B (research P1): semantically poor surfaces (canvas apps, hidden
// DOM mirrors) keep their accessibility tree even when DOM text is empty. The
// snapshot runs once per poor read through the bounded debugger session and is
// filtered by the pure value-free builder; every failure mode fails open (no
// axSummary, the observation result stays intact).
async function collectAxSummary(tabId, context) {
  try {
    return await withDebugger(tabId, context, async (target) => {
      try { await chrome.debugger.sendCommand(target, 'Accessibility.enable'); } catch {}
      let tree;
      try {
        tree = await chrome.debugger.sendCommand(target, 'Accessibility.getFullAXTree');
      } finally {
        try { await chrome.debugger.sendCommand(target, 'Accessibility.disable'); } catch {}
      }
      const summary = buildAxSummary(tree?.nodes || []);
      return summary.items.length > 0 ? summary : null;
    });
  } catch {
    return null;
  }
}

function screenshotBytes(data) {
  try { return atob(data).length; } catch { return Number.POSITIVE_INFINITY; }
}

async function screenshotHash(data) {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function screenshotLooksBlank(data) {
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
  } catch {
    return { checked: false, blank: false };
  }
}

function cachedScreenshot(tabId, cacheKey, previousHash) {
  const cached = screenshotCache.get(tabId);
  if (!cached || cached.cacheKey !== cacheKey || Date.now() - cached.savedAt > SCREENSHOT_CACHE_MS) return null;
  const screenshot = { ...cached.screenshot, cached: true };
  if (previousHash && previousHash.toLowerCase() === screenshot.sha256) {
    delete screenshot.data;
    screenshot.unchanged = true;
  }
  return screenshot;
}

function rememberScreenshot(tabId, cacheKey, screenshot) {
  screenshotCache.delete(tabId);
  screenshotCache.set(tabId, { cacheKey, savedAt: Date.now(), screenshot });
  while (screenshotCache.size > SCREENSHOT_CACHE_LIMIT) screenshotCache.delete(screenshotCache.keys().next().value);
}

async function capturePage(tabId, params, context) {
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
      if (bytes >= 512 && bytes <= MAX_SCREENSHOT_BYTES) {
        chosen = { data, bytes, quality: attempt.quality, scale: attempt.scale };
        break;
      }
    }
    if (!chosen) throw codedError('SCREENSHOT_TOO_LARGE', `Screenshot could not be reduced below ${MAX_SCREENSHOT_BYTES} bytes.`, { tabId, maxBytes: MAX_SCREENSHOT_BYTES });
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

function executionMode(params = {}) {
  return params.executionMode === 'foreground' ? 'foreground' : 'background';
}

function foregroundRequired(message, details = {}) {
  const error = new Error(message);
  error.code = 'FOREGROUND_REQUIRED';
  error.details = { requiredExecutionMode: 'foreground', ...details };
  return error;
}

async function withInputFocusEmulation(target, mode, work) {
  let focusEmulated = false;
  if (mode === 'background') {
    try {
      await chrome.debugger.sendCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: true });
      focusEmulated = true;
    } catch {}
  }
  try {
    return { ...(await work()), focusEmulated };
  } finally {
    if (focusEmulated) {
      try { await chrome.debugger.sendCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: false }); } catch {}
    }
  }
}

// R9-A (2026-09-30): the at-dispatch foreground focus gate.
//
// The historical check sampled `tab.active` / `window.focused` ONCE, before a
// content-script round trip and a debugger attach, and never re-checked. A
// window that lost focus inside that window produced FOREGROUND_REQUIRED even
// though the user had just activated the tab. This gate re-samples AT dispatch
// time from inside the debugger session, so the decision is made against the
// state that will actually receive the input, and it retries a bounded number
// of times before refusing.
//
// It never activates a tab, never focuses a window, and never moves the OS
// cursor: that authority stays with the explicit tabs.activate primitive and
// with the user's own foreground permission. A window that genuinely is not
// focused still returns the structured FOREGROUND_REQUIRED requirement, now
// carrying the observed state so the failure is diagnosable.
async function sampleTabFocus(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  return { tabActive: !!tab.active, windowFocused: !!win.focused, windowId: tab.windowId };
}

async function withForegroundFocusGate(tabId, mode, work) {
  if (mode !== 'foreground') return work();
  for (let attempt = 1; ; attempt += 1) {
    let sample = null;
    try {
      sample = await sampleTabFocus(tabId);
    } catch (error) {
      throw foregroundRequired('Foreground focus state could not be verified before the input was dispatched.', {
        targetTabId: tabId,
        attempts: attempt,
        reason: String(error?.message || error)
      });
    }
    const decision = decideFocusGate({ mode, sample, attempt });
    if (decision.outcome === 'dispatch') {
      const result = await work();
      return { ...result, focusGate: { attempts: attempt, recovered: decision.recovered, ...sample } };
    }
    if (decision.outcome === 'refuse') {
      throw foregroundRequired(
        'Pointer actions require the target tab and its window to already be active and focused.',
        { targetTabId: tabId, attempts: attempt, ...sample }
      );
    }
    await sleep(FOCUS_GATE_SETTLE_MS);
  }
}

// U-V Action Pipeline (2026-09-23): Resolve -> Wait -> Heal -> Verify around
// the shared trusted executors. Every action path (MCP page.*, burst steps,
// gateway /command, workflow steps, ETW local actions) reaches the dispatch
// action cases or the ETW click site below, so this one host gives all of
// them the same guarantee: never return `stale`, wait out dynamic targets via
// the adaptive ramp, rebind through the U-I machinery, and report final
// outcome telemetry. Pointers are coordinate-based (no ref), so their wait
// phase is a pass-through; their own guards and scroll verification apply.
const UV_WAIT_FLOOR_MS = 250; // keep the wait strictly inside the command race

// U-R popup/redirect follow-through: clicks and fills on OAuth/login controls
// open popup tabs (window.open / target=_blank) whose creation the original
// tab's DOM never shows. A bounded per-opener log records them so the action
// result can carry openedTabs and the model can continue in the popup by
// tabId (no auto-activation; activation stays an explicit user decision).
// Chromium attributes window.open on a BACKGROUND acted-on tab to the window's
// active tab, so while a page action is in flight its tab claims new tabs
// (see resolvePopupOpener).
const popupLog = new Map();
const popupActionStack = [];
const POPUP_LOG_MAX_AGE_MS = 60000;

function popupInFlightTab() {
  return popupActionStack.length ? popupActionStack[popupActionStack.length - 1] : null;
}

async function withActionPopupTracking(tabId, work) {
  popupActionStack.push(Number(tabId));
  try {
    return await work();
  } finally {
    const index = popupActionStack.lastIndexOf(Number(tabId));
    if (index >= 0) popupActionStack.splice(index, 1);
  }
}

function prunePopupLog(now = Date.now()) {
  for (const [opener, list] of popupLog) {
    const fresh = list.filter((e) => now - e.at <= POPUP_LOG_MAX_AGE_MS);
    if (fresh.length) popupLog.set(opener, fresh);
    else popupLog.delete(opener);
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  try {
    prunePopupLog();
    const opener = resolvePopupOpener(popupInFlightTab(), tab);
    if (opener !== null) recordPopup(popupLog, { id: tab.id, openerTabId: opener, pendingUrl: tab.pendingUrl, url: tab.url }, Date.now(), POPUP_LOG_LIMIT);
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId) => {
  popupLog.delete(tabId);
  for (const [opener, list] of popupLog) {
    const withoutPopup = list.filter((e) => e.tabId !== tabId);
    if (withoutPopup.length) popupLog.set(opener, withoutPopup);
    else popupLog.delete(opener);
  }
});

async function runActionPipeline(tabId, method, params, context, exec) {
  const started = Date.now();
  const specTimeout = METHOD_SPECS[method]?.timeoutMs ?? 8000;
  const cmdDeadline = Number(context?.deadline) || (started + specTimeout);
  const deadline = Math.min(cmdDeadline, started + specTimeout);
  const hasRef = typeof params?.ref === 'string' && params.ref.length > 0;
  let attempts = 0;
  let healed = false;
  let waitedMs = 0;
  let state = null;
  let resolveError = null;
  const resolveState = async () => {
    attempts += 1;
    try {
      state = await contentCall(tabId, 'page.action_state', { ref: params.ref });
      resolveError = null;
    } catch (error) {
      state = null; // non-ambiguity content refusal: not resolvable this cycle
      resolveError = String(error?.message || error);
    }
    if (state?.rebound) healed = true;
    return classifyResolve(state);
  };
  let verdict = hasRef ? await resolveState() : 'ready';
  const delays = pollDelays(deadline - started, 0);
  for (let di = 0; hasRef && verdict !== 'ready' && verdict !== 'ambiguous' && di < delays.length; di += 1) {
    if (Date.now() + delays[di] > deadline - UV_WAIT_FLOOR_MS) break;
    await new Promise((r) => setTimeout(r, delays[di]));
    waitedMs += delays[di];
    verdict = await resolveState();
  }
  // Synthetic actions historically act on present-but-not-actionable targets
  // (their content paths own disabled/hidden gates — regression R0 proves the
  // revalidate-then-click contract), so only TRUSTED actions wait for full
  // actionability; synthetic waits resolve on presence.
  if (verdict === 'not-actionable' && params?.trusted !== true) verdict = 'ready';
  if (verdict === 'ambiguous') {
    // Carry the original geometry-guard refusal text: legacy consumers assert
    // on it, and it names the concrete tolerance mismatch behind the refusal.
    throw makeNotReady('ambiguous', waitedMs, state?.refusal || 'Refusal is deliberate (geometry guard). Pick a listed candidate deliberately or re-find with narrower text.', state?.candidates);
  }
  if (verdict !== 'ready') {
    const hints = {
      'not-found': 'Target never appeared before the deadline. Arm watch.start for late UI or re-find later.',
      'not-actionable': 'Target is present but not actionable (hidden/offscreen/disabled). Scroll into view or re-find.'
    };
    const gates = state?.gates ? ` [gates: ${JSON.stringify(state.gates)}]` : '';
    const resolver = resolveError ? ` [resolver: ${resolveError}]` : '';
    throw makeNotReady(verdict, waitedMs, hints[verdict] + gates + resolver);
  }
  const result = await exec(params.ref);
  // Verify: only from an actual post-action check (postAction.verified exists
  // only when an expect spec was evaluated) - never invented.
  if ((method === 'page.click' || method === 'page.fill') && result?.postAction?.verified !== undefined) {
    return attachResolution(result, { attempts, waitedMs, healed, verified: result.postAction.verified === true });
  }
  return attachResolution(result, { attempts, waitedMs, healed });
}

async function trustedClick(tabId, ref, context, mode = 'background', options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts) || 1));
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const info = await contentCall(tabId, 'page.click_info', { ref });
    const x = info.rect?.centerX;
    const y = info.rect?.centerY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Element has no clickable rectangle.');
    const action = await withDebugger(tabId, context, (target) => withInputFocusEmulation(target, mode, () =>
      withForegroundFocusGate(tabId, mode, async () => {
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        return { ok: true, ref, method: 'debugger', x, y };
      })));
    const postAction = await contentCall(tabId, 'page.post_action', {
      ref,
      before: info.postActionBefore,
      expect: options.expect || undefined
    });
    last = { ...action, postAction, attempts: attempt };
    if (postAction.verified !== false || attempt >= attempts) break;
  }
  return last;
}

async function trustedFill(tabId, ref, value, context, mode = 'background', options = {}) {
  const text = String(value ?? '').slice(0, 20000);
  const info = await contentCall(tabId, 'page.fill_info', { ref });
  return withDebugger(tabId, context, (target) => withInputFocusEmulation(target, mode, () =>
    withForegroundFocusGate(tabId, mode, async () => {
    const active = await contentCall(tabId, 'page.active_state', {});
    if (active.sensitive || active.active?.ref !== ref) {
      throw new Error('Trusted fill target lost safe document focus before text insertion.');
    }
    let action;
    if (text) {
      await chrome.debugger.sendCommand(target, 'Input.insertText', { text });
      action = { ok: true, ref, valueLength: text.length, method: 'debugger' };
    } else {
      const key = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 };
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key });
      action = { ok: true, ref, valueLength: 0, method: 'debugger' };
    }
    // U-R: verify the fill in-page (expect parity with trustedClick); verified
    // exists only when an expect spec was evaluated - never invented.
    const postAction = await contentCall(tabId, 'page.post_action', {
      ref,
      before: info.postActionBefore,
      expect: options.expect || undefined
    });
    return { ...action, postAction };
  })));
}

async function trustedPointer(tabId, params, context) {
  const mode = executionMode(params);
  const action = String(params.action || 'click');
  const visiblePointer = mode === 'foreground' && params.showCursor !== false;
  const start = await contentCall(tabId, 'page.pointer_target', { x: params.x, y: params.y, showCursor: visiblePointer, action });
  const end = action === 'drag'
    ? await contentCall(tabId, 'page.pointer_target', { x: params.endX, y: params.endY, showCursor: visiblePointer, action })
    : null;
  return withDebugger(tabId, context, (target) => withInputFocusEmulation(target, mode, () =>
    withForegroundFocusGate(tabId, mode, async () => {
    let scroll = null;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
    if (action === 'click') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    } else if (action === 'drag') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: end.x, y: end.y, button: 'left', buttons: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
    } else if (action === 'wheel') {
      const deltaX = clamp(params.deltaX, -1200, 1200, 0);
      const deltaY = clamp(params.deltaY, -1200, 1200, 0);
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: start.x, y: start.y, deltaX, deltaY });
      scroll = await contentCall(tabId, 'page.scroll_settle', {
        x: start.x,
        y: start.y,
        before: start.scrollTarget,
        beforeMutationVersion: start.mutationVersion,
        maxWaitMs: 300,
        stableRounds: 2
      });
      scroll.inputMethod = 'debugger';
      const canMoveY = deltaY > 0 ? !scroll.after?.reachedBottom : deltaY < 0 ? !scroll.after?.reachedTop : false;
      const canMoveX = deltaX > 0 ? !scroll.after?.reachedRight : deltaX < 0 ? !scroll.after?.reachedLeft : false;
      if (!scroll.moved && (canMoveY || canMoveX)) {
        scroll = await contentCall(tabId, 'page.scroll_target', {
          x: start.x,
          y: start.y,
          ref: start.scrollTarget?.ref,
          before: start.scrollTarget,
          beforeMutationVersion: start.mutationVersion,
          deltaX,
          deltaY
        });
        scroll.inputMethod = 'dom-fallback';
      }
      scroll.reachedBoundary = deltaY > 0 ? scroll.after?.reachedBottom : deltaY < 0 ? scroll.after?.reachedTop : deltaX > 0 ? scroll.after?.reachedRight : deltaX < 0 ? scroll.after?.reachedLeft : false;
    }
    return { ok: true, method: 'debugger', action, executionMode: mode, visiblePointer, start, end, ...(scroll ? { scroll } : {}) };
  })));
}

// R9-B (2026-09-30): the trusted key path resolves a declarative chord or a
// bounded text request through lib/keyboard.js instead of a flat 12-entry table
// with no modifier support at all. The sensitive-field guard is unchanged and
// still runs before anything is dispatched.
async function trustedKey(tabId, params, context, mode = 'background') {
  const request = resolveKeyInput({
    key: params?.key,
    modifiers: params?.modifiers,
    text: params?.text
  });
  const active = await contentCall(tabId, 'page.active_state', {});
  if (active.sensitive) throw new Error('Keyboard input blocked on sensitive field.');
  return withDebugger(tabId, context, (target) => withInputFocusEmulation(target, mode, () =>
    withForegroundFocusGate(tabId, mode, async () => {
    if (request.kind === 'text') {
      for (const chunk of request.chunks) {
        await chrome.debugger.sendCommand(target, 'Input.insertText', { text: chunk });
      }
      return { ok: true, method: 'debugger', input: 'text', valueLength: request.chars, chunks: request.chunks.length };
    }
    const spec = {
      key: request.key,
      code: request.code,
      windowsVirtualKeyCode: request.windowsVirtualKeyCode,
      nativeVirtualKeyCode: request.nativeVirtualKeyCode
    };
    const modifiers = request.modifiers ? { modifiers: request.modifiers } : {};
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...modifiers, ...spec });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...modifiers, ...spec });
    return {
      ok: true,
      key: request.name,
      modifiers: request.modifierNames,
      method: 'debugger',
      input: 'chord'
    };
  })));
}

// Burst ref passthrough: a click/fill step may take its ref from a previous
// find/query step in the same burst, so the reference is minted and consumed
// within milliseconds instead of surviving a model round-trip (live evidence:
// YouTube skip control died in the 14.1 s between find and click).
function burstPassthroughRef(results, step, index) {
  const from = step.refFromStep;
  if (from === undefined || from === null) return null;
  const source = results[Number(from)];
  const sourceItems = ((source && source.result) || {}).items;
  if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
    throw new Error(`refFromStep must reference an earlier burst step with items (step ${from} returned none).`);
  }
  const want = step.refIndex;
  const pick = want === undefined || want === null ? sourceItems[0] : sourceItems[Number(want)];
  if (!pick || typeof pick.ref !== 'string' || !pick.ref) {
    throw new Error(`refFromStep must reference an earlier burst step with items (step ${from} item has no ref).`);
  }
  return { ref: pick.ref, resolvedFrom: `step:${from}` };
}

function burstStepParams(step, tabId, remainingMs, mode, results) {
  const { action, pointerAction, ...values } = step;
  const params = { ...values, tabId, executionMode: mode };
  if (action === 'click' || action === 'fill') {
    const passthrough = burstPassthroughRef(results || [], step);
    if (passthrough) {
      params.ref = passthrough.ref;
      params.resolvedFrom = passthrough.resolvedFrom;
    }
    params.trusted = true;
  }
  if (action === 'key') params.trusted = true;
  if (action === 'hover') {
    const passthrough = burstPassthroughRef(results || [], step);
    if (passthrough) {
      params.ref = passthrough.ref;
      params.resolvedFrom = passthrough.resolvedFrom;
    }
    params.trusted = true;
  }
  if (action === 'pointer') {
    params.action = pointerAction || 'click';
    params.showCursor = true;
  }
  if (action === 'wait') params.timeoutMs = Math.min(clamp(params.timeoutMs, 50, 8000, 3000), remainingMs);
  return params;
}

function burstResultSize(results) {
  try { return new TextEncoder().encode(JSON.stringify(results)).byteLength; } catch { return Number.POSITIVE_INFINITY; }
}

async function runBurst(params, outerContext = {}) {
  const tabId = await resolveTabId(params);
  const mode = executionMode(params);
  const startedAt = performance.now();
  const deadline = Math.min(outerContext.deadline || Date.now() + BURST_MAX_TIMEOUT_MS, Date.now() + BURST_MAX_TIMEOUT_MS);
  const context = { ...outerContext, deadline, debuggerSession: { tabId, attached: false } };
  const results = [];

  try {
    for (let index = 0; index < params.steps.length; index += 1) {
      const remainingMs = deadline - Date.now();
      // A burst timeout is an unknown outcome, not a failure: steps that already
      // ran may have taken effect, so their evidence must reach the caller.
      if (remainingMs < 50) {
        return {
          ok: false,
          tabId,
          timedOut: true,
          completedSteps: results.length,
          failedAt: index,
          executionMode: mode,
          error: { code: 'BURST_TIMEOUT', message: 'Burst timeout before this step; completed steps may have taken effect.' },
          results,
          timingMs: Math.round((performance.now() - startedAt) * 100) / 100
        };
      }
      const step = params.steps[index];
      const method = BURST_ACTION_METHODS[step.action];
      const stepStartedAt = performance.now();
      try {
        const result = await dispatch(method, burstStepParams(step, tabId, remainingMs, mode, results), context);
        if ((step.action === 'click' || step.action === 'fill') && step.refFromStep !== undefined && step.refFromStep !== null
          && result && typeof result === 'object' && result.ok === true) {
          result.resolvedFrom = `step:${step.refFromStep}`;
        }
        if (step.action === 'wait' && result?.ok === false) throw new Error(String(result.error || 'wait_for timeout'));
        const entry = { index, action: step.action, ok: true, timingMs: Math.round((performance.now() - stepStartedAt) * 100) / 100, result };
        if (burstResultSize([...results, entry]) > MAX_BURST_RESULT_BYTES) throw new Error(`Burst result exceeds ${MAX_BURST_RESULT_BYTES} bytes.`);
        results.push(entry);
      } catch (error) {
        let burstError = normalizeError(error);
        if (error && error.code === 'TARGET_NOT_READY') {
          burstError = { code: error.code, reason: error.reason, waitedMs: error.waitedMs, hint: error.hint, message: `Target not ready (${error.reason}) after ${error.waitedMs}ms. ${error.hint || ''}`.trim(), ...(Array.isArray(error.candidates) ? { candidates: error.candidates } : {}) };
        }
        return {
          ok: false,
          tabId,
          completedSteps: index,
          failedAt: index,
          failedAction: step.action,
          executionMode: mode,
          error: burstError,
          results,
          timingMs: Math.round((performance.now() - startedAt) * 100) / 100
        };
      }
    }
    return {
      ok: true,
      tabId,
      executionMode: mode,
      completedSteps: results.length,
      results,
      timingMs: Math.round((performance.now() - startedAt) * 100) / 100
    };
  } finally {
    if (context.debuggerSession.attached) {
      try { await chrome.debugger.detach({ tabId }); } catch {}
    }
  }
}

async function dispatch(method, params = {}, context = {}) {
  switch (method) {
    case 'browser.ping': {
      const cfg = await getConfig();
      return {
        ok: true,
        product: 'Opera Agent',
        version: PRODUCT_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        deviceName: cfg.deviceName,
        paired: cfg.paired,
        capabilities: Object.keys(METHOD_SPECS),
        time: nowIso()
      };
    }
    case 'browser.burst':
      return runBurst(params, context);
    case 'watch.start': {
      const cfg = await getConfig();
      if (!cfg.paired || !cfg.deviceToken) throw new Error('Device is not paired.');
      const tabId = await resolveTabId(params);
      const w = await pruneWatchers();
      const tabCount = watcherIdsForTab(w, tabId).length;
      const globalCount = w.watchers.length;
      if (globalCount >= MAX_WATCHERS_GLOBAL) throw new Error(`Watcher cap reached (${MAX_WATCHERS_GLOBAL} global).`);
      if (tabCount >= MAX_WATCHERS_PER_TAB) throw new Error(`Watcher cap reached (${MAX_WATCHERS_PER_TAB} per tab).`);
      const candidate = { ...params.rule, ruleId: params.rule?.ruleId || watchRuleId('w') };
      const v = validateRule(candidate);
      if (!v.ok) throw new Error(v.reason);
      const entry = { id: candidate.ruleId, tabId, rule: candidate, createdAt: Date.now(), runtime: {} };
      w.watchers.push(entry);
      (w.byTab[tabId] ||= []).push(entry.id);
      await saveWatchers(w);
      const arm = await armWatchersForTab(tabId);
      return { ok: true, watcherId: entry.id, tabId, armed: arm.armed, ...(!arm.armed && arm.error ? { warning: arm.error } : {}) };
    }
    case 'watch.stop': {
      const { watcherId } = params;
      const w = await pruneWatchers();
      const before = w.watchers.length;
      w.watchers = w.watchers.filter((e) => e.id !== watcherId);
      for (const ids of Object.values(w.byTab)) {
        const i = ids.indexOf(watcherId); if (i >= 0) ids.splice(i, 1);
      }
      w.byTab = Object.fromEntries(Object.entries(w.byTab).filter(([, ids]) => ids.length));
      await saveWatchers(w);
      return { ok: true, removed: before - w.watchers.length };
    }
    case 'watch.stop_all': {
      const w = await pruneWatchers();
      const removed = w.watchers.length;
      await saveWatchers({ watchers: [], byTab: {} });
      return { ok: true, removed };
    }
    case 'watch.list': {
      const w = await pruneWatchers();
      return { ok: true, watchers: w.watchers.map((e) => ({ id: e.id, tabId: e.tabId, rule: e.rule, fireCount: e.runtime?.fireCount || 0 })) };
    }
    case 'tabs.list': {
      const tabs = await chrome.tabs.query(params.currentWindow ? { currentWindow: true } : {});
      return { ok: true, tabs: tabs.map(publicTab) };
    }
    case 'tabs.get': {
      const tabId = await resolveTabId(params);
      return { ok: true, tab: publicTab(await chrome.tabs.get(tabId)) };
    }
    case 'tabs.find': {
      const tabs = await chrome.tabs.query({});
      const urlContains = String(params.urlContains || '').toLowerCase();
      const titleContains = String(params.titleContains || '').toLowerCase();
      const matches = tabs.filter((tab) => {
        if (params.active != null && !!tab.active !== !!params.active) return false;
        if (urlContains && !String(tab.url || '').toLowerCase().includes(urlContains)) return false;
        if (titleContains && !String(tab.title || '').toLowerCase().includes(titleContains)) return false;
        return true;
      }).map(publicTab);
      const index = Number.isInteger(params.index) ? params.index : 0;
      return { ok: true, count: matches.length, tab: matches[index] || null, tabs: matches.slice(0, clamp(params.limit, 1, 100, 20)) };
    }
    case 'tabs.open': {
      const url = safeUrl(params.url || 'https://www.google.com/');
      if (!url) throw new Error('Only http/https URLs are allowed.');
      const tab = await chrome.tabs.create({ url, active: params.active !== false });
      const ready = params.wait === false ? publicTab(tab) : await waitTabReady(tab.id, params.waitTimeoutMs);
      return { ok: true, tab: ready };
    }
    case 'tabs.activate': {
      const tabId = requireTabId(params.tabId);
      let tab = await chrome.tabs.get(tabId);
      let reused = !!tab.active;
      if (!tab.active) {
        tab = await chrome.tabs.update(tabId, { active: true });
        reused = false;
      }
      if (params.focusWindow !== false) {
        const window = await chrome.windows.get(tab.windowId);
        if (!window.focused) {
          await chrome.windows.update(tab.windowId, { focused: true });
          reused = false;
        }
      }
      return { ok: true, tab: publicTab(tab), reused };
    }
    case 'tabs.close': {
      const tabId = requireTabId(params.tabId);
      await chrome.tabs.remove(tabId);
      return { ok: true, tabId };
    }
    case 'tabs.navigate': {
      const tabId = await resolveTabId(params);
      const url = safeUrl(params.url);
      if (!url) throw new Error('Only http/https URLs are allowed.');
      const current = await chrome.tabs.get(tabId);
      if (safeUrl(current.url) === url) {
        const ready = params.wait === false ? publicTab(current) : await waitTabReady(tabId, params.waitTimeoutMs);
        return { ok: true, tab: ready, reused: true };
      }
      const tab = await chrome.tabs.update(tabId, { url });
      const ready = params.wait === false ? publicTab(tab) : await waitTabReady(tabId, params.waitTimeoutMs);
      return { ok: true, tab: ready, reused: false };
    }
    case 'tabs.reload': {
      const tabId = await resolveTabId(params);
      await chrome.tabs.reload(tabId, { bypassCache: !!params.bypassCache });
      const ready = params.wait === false ? publicTab(await chrome.tabs.get(tabId)) : await waitTabReady(tabId, params.waitTimeoutMs);
      return { ok: true, tab: ready };
    }
    case 'page.read': {
      const tabId = await resolveTabId(params);
      let result = await contentCall(tabId, method, { ...params, __semanticRuntimeEpoch: SEMANTIC_RUNTIME_EPOCH });
      // R9 read degradation: an oversized result used to fail the whole call at
      // the 512KB ceiling, which on a large application is a hard failure the
      // caller can only guess its way out of. Degrade instead: keep the text and
      // the observation, drop the element list, and say so. The caller can then
      // re-read with a narrower scope rather than starting over.
      if (result?.page && oversized(result)) {
        const { elements, ...withoutElements } = result.page;
        result = {
          ...result,
          page: {
            ...withoutElements,
            truncated: true,
            truncationReason: `Element list omitted: the result exceeded the ${MAX_RESULT_BYTES}-byte ceiling. Re-read with a narrower offset, a smaller maxElements, or includeElements disabled.`,
            omittedElementCount: Array.isArray(elements) ? elements.length : 0
          }
        };
      }
      if (result?.page?.viewport) {
        try { result.page.viewport.zoomFactor = await chrome.tabs.getZoom(tabId); } catch {}
      }
      // U-P1: text-poor surfaces pay the debugger round trip; collection
      // failures fail open and leave the observation unchanged.
      //
      // R9-C follow-up: text poverty alone was the wrong trigger. A 70-page
      // Google Docs document is NOT text-poor, so its accessibility tree was
      // never collected and the role reconciliation below never ran — the exact
      // app that motivated R9-C. A page whose elements still carry no real role
      // is a semantic gap regardless of how much text it has, and it is worth
      // the same one bounded walk.
      const r9SemanticGap = hasRoleGap(result?.page?.elements);
      const shouldCollectAx = result?.ok !== false && result?.page
        && (Number(result.page.totalTextChars) <= AX_SUMMARY_TEXT_POVERTY_CHARS || r9SemanticGap);
      if (shouldCollectAx) {
        const summary = await collectAxSummary(tabId, context);
        if (summary) {
          result.page.axSummary = summary;
          // R9-C: reuse the SAME bounded AX round trip to fill in roles the
          // markup does not carry, so a custom control that the platform
          // reports as a radio is finally discoverable by role. This is
          // read-only annotation: no ref is minted, moved, or invalidated, and
          // an explicit DOM role still wins over the AX one.
          const index = axRoleIndex?.(summary.items);
          if (index && index.size > 0 && Array.isArray(result.page.elements)) {
            result.page.elements = reconcileElements?.(result.page.elements, index) || result.page.elements;
          }
        }
      }
      return { ...result, tabId };
    }
    case 'page.query':
    case 'page.find':
    case 'page.collect_links':
    case 'page.focus':
    case 'page.scroll':
    case 'page.wait_for':
    case 'media.state':
    case 'media.play':
    case 'media.pause':
    case 'media.seek': {
      const tabId = await resolveTabId(params);
      const result = await contentCall(tabId, method, params);
      return { ...result, tabId };
    }
    case 'page.fill': {
      const tabId = await resolveTabId(params);
      const fillOptions = { expect: params.expect, attempts: params.retry?.attempts };
      const actionStart = Date.now();
      const result = await withActionPopupTracking(tabId, () => runActionPipeline(tabId, 'page.fill', params, context, (ref) => (params.trusted ? trustedFill(tabId, ref, params.value, context, executionMode(params), fillOptions) : contentCall(tabId, 'page.fill', { ...params, ref }))));
      const openedTabs = popupsSince(popupLog, tabId, actionStart);
      return { ...result, tabId, ...(openedTabs.length ? { openedTabs } : {}) };
    }
    case 'page.click': {
      const tabId = await resolveTabId(params);
      const clickOptions = { expect: params.expect, attempts: params.retry?.attempts };
      const actionStart = Date.now();
      const result = await withActionPopupTracking(tabId, () => runActionPipeline(tabId, 'page.click', params, context, (ref) => (params.trusted ? trustedClick(tabId, ref, context, executionMode(params), clickOptions) : contentCall(tabId, 'page.click', { ...params, ref }))));
      const openedTabs = popupsSince(popupLog, tabId, actionStart);
      return { ...result, tabId, ...(openedTabs.length ? { openedTabs } : {}) };
    }
    case 'page.pointer': {
      const tabId = await resolveTabId(params);
      const result = await runActionPipeline(tabId, 'page.pointer', params, context, () => trustedPointer(tabId, params, context));
      return { ...result, tabId };
    }
    case 'page.hover': {
      const tabId = await resolveTabId(params);
      const result = await runActionPipeline(tabId, 'page.hover', params, context, () => trustedHover(tabId, params, context));
      return { ...result, tabId };
    }
    case 'page.capture': {
      const tabId = await resolveTabId(params);
      return capturePage(tabId, params, context);
    }
    case 'page.key': {
      const tabId = await resolveTabId(params);
      const result = await runActionPipeline(tabId, 'page.key', params, context, () => (params.trusted ? trustedKey(tabId, params, context, executionMode(params)) : contentCall(tabId, 'page.key', params)));
      return { ...result, tabId };
    }
    default:
      throw new Error('Method is not implemented by this extension build.');
  }
}

function boundedResult(value) {
  let text;
  try { text = JSON.stringify(value); } catch { throw new Error('Result is not serializable.'); }
  if (text.length > MAX_RESULT_BYTES) {
    throw new Error(`Result exceeds ${MAX_RESULT_BYTES} bytes. Use bounded/chunked reads.`);
  }
  return value;
}

function oversized(value) {
  try { return JSON.stringify(value).length > MAX_RESULT_BYTES; } catch { return false; }
}

// ---- U-T Event-Triggered Workflows: watch registry ----
// Rules are validated by the pure engine in lib/watch.js. content.js stays
// dumb: it reports FACTS (presence/url/adState/mediaTime/text) on mutations;
// background evaluates rules with the engine and executes actions through the
// proven burst/query/trusted-click machinery. The model is out of the loop.
const WATCH_STATE_KEY = 'watchers';
const MAX_WATCHERS_PER_TAB = 8;
const MAX_WATCHERS_GLOBAL = 32;
const WATCH_MAX_RULES_PER_ARM = 8;

function watchRuleId(prefix) {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function loadWatchers() {
  const bag = await chrome.storage.local.get(WATCH_STATE_KEY);
  return bag[WATCH_STATE_KEY] || { watchers: [], byTab: {} };
}

async function saveWatchers(w) {
  await chrome.storage.local.set({ [WATCH_STATE_KEY]: w });
}

function watcherIdsForTab(w, tabId) {
  return (w.byTab[tabId] || []).filter((id) => w.watchers.some((e) => e.id === id));
}

async function pruneWatchers() {
  const w = await loadWatchers();
  const now = Date.now();
  const alive = [];
  let changed = false;
  for (const entry of w.watchers) {
    const expired = now - entry.createdAt > entry.rule.deadlineMs;
    const tabGone = entry.tabId != null && !await tabExists(entry.tabId);
    if (expired || tabGone) { changed = true; continue; }
    alive.push(entry);
  }
  if (!changed) return w;
  const byTab = {};
  for (const entry of alive) (byTab[entry.tabId] ||= []).push(entry.id);
  const next = { watchers: alive, byTab };
  await saveWatchers(next);
  return next;
}

async function tabExists(tabId) {
  try { await chrome.tabs.get(tabId); return true; } catch { return false; }
}

async function armWatchersForTab(tabId) {
  const w = await pruneWatchers();
  const entries = watcherIdsForTab(w, tabId)
    .map((id) => w.watchers.find((e) => e.id === id))
    .filter(Boolean);
  const rules = entries.map((e) => e.rule);
  if (!rules.length) return { armed: 0 };
  try {
    const r = await executeInTab(tabId, 'watch.arm', { rules: rules.slice(0, WATCH_MAX_RULES_PER_ARM) });
    if (!r?.ok) return { armed: 0, error: r?.error?.code || 'ARM_FAILED' };
    return { armed: rules.length, facts: r.facts || null };
  } catch (error) {
    return { armed: 0, error: String(error?.message || error).slice(0, 200) };
  }
}

async function handleWatchFacts(tabId, facts) {
  const w = await pruneWatchers();
  const entries = watcherIdsForTab(w, tabId)
    .map((id) => w.watchers.find((e) => e.id === id))
    .filter(Boolean);
  if (!entries.length) return { fired: 0 };
  const rules = entries.map((e) => e.rule);
  const out = evaluateRules(rules, facts, facts.state || {}, facts.now || Date.now());
  // persist engine state per watcher
  for (const entry of entries) {
    const st = out.state[entry.rule.ruleId];
    if (st) entry.runtime = st;
  }
  await saveWatchers(w);
  for (const fire of out.fired) {
    const entry = entries.find((e) => e.rule.ruleId === fire.ruleId);
    if (entry) handleWatchFire(entry, fire, facts).catch(() => {});
  }
  return { fired: out.fired.length };
}

async function emitWatchEvent(entry, fire, facts, actionResult) {
  const cfg = await getConfig();
  if (!cfg.paired || !cfg.deviceToken) return;
  const envelope = {
    watcherId: entry.id,
    tabId: entry.tabId,
    rule: {
      ruleId: entry.rule.ruleId,
      trigger: entry.rule.trigger,
      actionType: entry.rule.action?.type || 'report'
    },
    event: {
      firedAtMs: fire.atMs,
      fireCount: fire.fireCount,
      url: String(facts?.url || '').slice(0, 500),
      adState: !!facts?.adState,
      mediaTime: Number(facts?.mediaTime) || 0,
      context: typeof facts?.context === 'string' ? facts.context.slice(0, 2000) : null,
      actionResult: actionResult || null
    }
  };
  try {
    await fetchJson(cfg.bridgeUrl, {
      action: 'watch_event',
      token: cfg.deviceToken,
      deviceId: cfg.deviceId,
      watcherId: entry.id,
      envelope
    }, 8000);
  } catch (error) {
    await setState({ lastError: `watch_event delivery failed: ${String(error?.message || error).slice(0, 300)}` });
  }
}

async function executeWatchAction(entry, facts) {
  const action = entry.rule.action || { type: 'report' };
  try {
    if (action.type === 'report' || action.type === 'confirm') {
      return { type: action.type, ok: true };
    }
    if (action.type === 'click') {
      const sel = action.selector || entry.rule.trigger.selector;
      const q = await executeInTab(entry.tabId, 'page.query', { selector: sel, index: 0, limit: 1 });
      const ref = q?.ok && q.item && q.item.ref ? q.item.ref : null;
      if (!ref) return { type: 'click', ok: false, error: { code: 'TARGET_GONE', message: 'Matched element had no actionable ref.' } };
      const clickContext = { deadline: Date.now() + 15000, debuggerSession: { tabId: entry.tabId, attached: false } };
      const result = action.trusted === true
        ? await runActionPipeline(entry.tabId, 'page.click', { ref }, clickContext, (ref2) => trustedClick(entry.tabId, ref2, clickContext, 'background', {}))
        : await dispatch('page.click', { tabId: entry.tabId, ref, trusted: false }, clickContext);
      return { type: 'click', ok: !!result?.ok, error: result?.error || null };
    }
    if (action.type === 'burst') {
      const res = await runBurst({ tabId: entry.tabId, steps: action.steps }, { deadline: Date.now() + 15000 });
      return { type: 'burst', ok: !!res?.ok, steps: res?.completedSteps, error: res?.error || null };
    }
    if (action.type === 'workflow') {
      // The proven relay-side runner: snapshots the definition, retries per
      // iteration, enforces its own post-condition.
      const cfg = await getConfig();
      if (!cfg.paired || !cfg.deviceToken) {
        return { type: 'workflow', ok: false, error: { code: 'NOT_PAIRED', message: 'Device is not paired.' } };
      }
      const res = await fetchJson(cfg.bridgeUrl, {
        action: 'start_workflow',
        token: cfg.deviceToken,
        deviceId: cfg.deviceId,
        name: action.workflowName,
        params: action.params || {}
      }, 8000);
      return { type: 'workflow', ok: !!res?.ok, runId: res?.runId || null, error: res?.error || null };
    }
    return { type: action.type, ok: false, error: 'UNSUPPORTED_ACTION' };
  } catch (error) {
    return { type: action.type, ok: false, error: { code: 'WATCH_ACTION_FAILED', message: String(error?.message || error).slice(0, 300) } };
  }
}

async function handleWatchFire(entry, fire, facts) {
  const actionResult = await executeWatchAction(entry, facts);
  await emitWatchEvent(entry, fire, facts, actionResult);
  return actionResult;
}

// U-R: a command timeout is an unknown outcome, not a definite failure — the
// action may have taken effect (parity with the BURST_TIMEOUT / GATEWAY_ERROR
// unknown-outcome contract family), so the model must verify page state
// before repeating it.
function commandTimeoutError() {
  return codedError('COMMAND_TIMEOUT', 'Command timed out: the browser action may have taken effect. Verify page state before repeating it.');
}

// R9-E (2026-09-30): hover a resolved target and settle on the reveal.
//
// Multi-level menus previously needed a hand-built hover -> wait -> hover -> wait
// burst. This makes one level a single step: move the trusted pointer onto the
// target, then wait, bounded, for the reveal — an awaited submenu name, an
// aria-expanded flip, or DOM stability. It never clicks, so a hover cannot
// become an action the caller did not ask for, and it routes through the same
// foreground focus gate as every other pointer input.
async function trustedHover(tabId, params, context) {
  const mode = executionMode(params);
  const info = await contentCall(tabId, 'page.click_info', { ref: params.ref });
  const x = info.rect?.centerX;
  const y = info.rect?.centerY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Element has no hoverable rectangle.');
  const timeoutMs = clamp(params.timeoutMs, 50, 8000, 1500);
  return withDebugger(tabId, context, (target) => withInputFocusEmulation(target, mode, () =>
    withForegroundFocusGate(tabId, mode, async () => {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      const settle = await contentCall(tabId, 'page.hover_settle', {
        ref: params.ref,
        ...(params.text != null ? { text: String(params.text).slice(0, 300) } : {}),
        timeoutMs
      });
      return { ok: true, method: 'debugger', input: 'hover', ref: params.ref, x, y, settle };
    })));
}

async function executeCommand(raw) {
  // U-T: watch.* is an internal extension-side family (protocol primitive
  // count stays frozen at 26); its validation lives in lib/watch.js.
  if (raw && typeof raw.method === 'string' && raw.method.startsWith('watch.')) {
    const deadlineW = Date.now() + 10000;
    try {
      const result = await Promise.race([
        dispatch(raw.method, raw.params || {}, { deadline: deadlineW }),
        new Promise((_, reject) => setTimeout(() => reject(commandTimeoutError()), 10000))
      ]);
      return { ok: true, result: boundedResult(result) };
    } catch (error) {
      if (error && error.code === 'TARGET_NOT_READY') {
        return { ok: false, error: { code: error.code, reason: error.reason, waitedMs: error.waitedMs, hint: error.hint, message: `Target not ready (${error.reason}) after ${error.waitedMs}ms. ${error.hint || ''}${Array.isArray(error.candidates) ? ` Candidates: ${JSON.stringify(error.candidates)}` : ''}`.trim(), ...(Array.isArray(error.candidates) ? { candidates: error.candidates } : {}) } };
      }
      if (error && error.code === 'COMMAND_TIMEOUT') {
        return { ok: false, error: { code: 'COMMAND_TIMEOUT', outcome: 'unknown', message: error.message } };
      }
      return { ok: false, error: normalizeError(error) };
    }
  }
  const validated = validateCommand(raw);
  if (!validated.ok) return { ok: false, error: { code: 'INVALID_COMMAND', message: validated.error } };
  const { command } = validated;
  const deadline = Date.now() + command.timeoutMs;
  try {
    const result = await Promise.race([
      dispatch(command.method, command.params, { deadline }),
      new Promise((_, reject) => setTimeout(() => reject(commandTimeoutError()), Math.max(1, deadline - Date.now())))
    ]);
    return { ok: true, result: boundedResult(result) };
  } catch (error) {
    if (error && error.code === 'TARGET_NOT_READY') {
      return { ok: false, error: { code: error.code, reason: error.reason, waitedMs: error.waitedMs, hint: error.hint, message: `Target not ready (${error.reason}) after ${error.waitedMs}ms. ${error.hint || ''}${Array.isArray(error.candidates) ? ` Candidates: ${JSON.stringify(error.candidates)}` : ''}`.trim(), ...(Array.isArray(error.candidates) ? { candidates: error.candidates } : {}) } };
    }
    if (error && error.code === 'COMMAND_TIMEOUT') {
      return { ok: false, error: { code: 'COMMAND_TIMEOUT', outcome: 'unknown', message: error.message } };
    }
    return { ok: false, error: normalizeError(error) };
  }
}

async function pair(code) {
  const pairCode = String(code || '').trim();
  if (pairCode.length < 8 || pairCode.length > 64) throw new Error('Invalid pairing code.');
  const cfg = await getConfig();
  const token = randomToken();
  const data = await fetchJson(cfg.bridgeUrl, {
    action: 'pair',
    code: pairCode,
    token,
    deviceName: cfg.deviceName || 'opera',
    extensionVersion: PRODUCT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: Object.keys(METHOD_SPECS)
  }, 15000);
  if (!data.ok) throw new Error(data.error || 'Pairing failed.');
  await chrome.storage.local.set({
    paired: true,
    deviceName: data.deviceName || cfg.deviceName || 'opera',
    deviceToken: token,
    deviceId: data.deviceId || '',
    bridgeUrl: cfg.bridgeUrl
  });
  await setState({ status: 'connecting', lastError: null, retryMs: 250 });
  restartPullLoop();
  return data;
}

async function unpair() {
  loopGeneration += 1;
  await chrome.storage.local.remove(['paired', 'deviceToken', 'deviceId']);
  await setState({ status: 'unpaired', lastError: null });
  return { ok: true };
}

function completionPayload(commandId, execution) {
  return {
    commandId,
    ok: execution.ok,
    result: execution.ok ? execution.result : null,
    error: execution.ok ? null : execution.error,
    createdAt: nowIso()
  };
}

async function complete(cfg, pending) {
  const body = {
    action: 'complete',
    deviceName: cfg.deviceName,
    token: cfg.deviceToken,
    commandId: pending.commandId,
    ok: pending.ok,
    result: pending.ok ? pending.result : null,
    error: pending.ok ? null : pending.error,
    extensionVersion: PRODUCT_VERSION,
    protocolVersion: PROTOCOL_VERSION
  };
  return fetchJson(cfg.bridgeUrl, body, 15000);
}

async function completeWithRetry(cfg, pending) {
  let delayMs = 150;
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await complete(cfg, pending);
      await chrome.storage.local.remove('pendingCompletion');
      return result;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error).toLowerCase();
      if (message.includes('no longer completable') || message.includes('command not found')) {
        await chrome.storage.local.remove('pendingCompletion');
        return { ok: false, discarded: true, reason: message };
      }
      if (attempt < 4) await sleep(delayMs);
      delayMs = Math.min(2400, Math.round(delayMs * 2));
    }
  }
  throw lastError || new Error('Unable to report command completion.');
}

async function flushPendingCompletion(cfg) {
  const { pendingCompletion } = await chrome.storage.local.get('pendingCompletion');
  if (!pendingCompletion?.commandId) return;
  const createdAt = Date.parse(String(pendingCompletion.createdAt || ''));
  if (Number.isFinite(createdAt) && Date.now() - createdAt > 5 * 60 * 1000) {
    await chrome.storage.local.remove('pendingCompletion');
    return;
  }
  await completeWithRetry(cfg, pendingCompletion);
}

async function pullOnce(cfg) {
  return fetchJson(cfg.bridgeUrl, {
    action: 'pull',
    deviceName: cfg.deviceName,
    token: cfg.deviceToken,
    extensionVersion: PRODUCT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: Object.keys(METHOD_SPECS),
    waitMs: 12000
  }, 15000);
}

async function pullLoop(generation) {
  let retryMs = 250;
  while (generation === loopGeneration) {
    const cfg = await getConfig();
    if (!cfg.paired || !cfg.deviceToken) {
      await setState({ status: 'unpaired', lastError: null });
      return;
    }
    try {
      await flushPendingCompletion(cfg);
      const data = await pullOnce(cfg);
      retryMs = 250;
      await setState({ status: 'ready', lastError: null, lastConnectedAt: nowIso(), retryMs });
      if (!data.command) continue;
      const execution = await executeCommand(data.command);
      const pending = completionPayload(data.command.id, execution);
      await chrome.storage.local.set({ pendingCompletion: pending });
      await completeWithRetry(cfg, pending);
      await setState({ status: 'ready', lastCommandAt: nowIso(), lastError: null });
    } catch (error) {
      const message = String(error?.message || error).slice(0, 1000);
      await setState({ status: 'reconnecting', lastError: message, retryMs });
      await sleep(retryMs);
      retryMs = Math.min(5000, Math.round(retryMs * 1.7));
    }
  }
}

function ensurePullLoop() {
  if (loopPromise) return loopPromise;
  const generation = loopGeneration;
  loopPromise = pullLoop(generation).finally(async () => {
    loopPromise = null;
    const cfg = await getConfig();
    if (cfg.paired && cfg.deviceToken) setTimeout(ensurePullLoop, 100);
  });
  return loopPromise;
}

function restartPullLoop() {
  loopGeneration += 1;
  if (!loopPromise) ensurePullLoop();
}

async function heartbeat() {
  const cfg = await getConfig();
  if (!cfg.paired || !cfg.deviceToken) return;
  try {
    await fetchJson(cfg.bridgeUrl, {
      action: 'heartbeat',
      deviceName: cfg.deviceName,
      token: cfg.deviceToken,
      extensionVersion: PRODUCT_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: Object.keys(METHOD_SPECS)
    }, 8000);
    await setState({ status: 'ready', lastConnectedAt: nowIso(), lastError: null });
  } catch (error) {
    await setState({ status: 'reconnecting', lastError: String(error?.message || error).slice(0, 1000) });
  }
}

async function localSelfTest() {
  const tabs = await chrome.tabs.query({});
  const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
  let page = null;
  if (active?.id && HTTP_URL_RE.test(active.url || '')) {
    try { page = await contentCall(active.id, 'page.read', { limit: 600, maxElements: 10 }); } catch (error) { page = { ok: false, error: String(error?.message || error) }; }
  }
  return {
    ok: true,
    version: PRODUCT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    tabs: tabs.length,
    activeTab: active ? publicTab(active) : null,
    contentBridge: page ? page.ok !== false : null,
    pageTextChars: page?.page?.textChars ?? null,
    methods: Object.keys(METHOD_SPECS).length
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.scope === 'opera-agent-watch' && message.method === 'watch.facts') {
    const tabId = sender?.tab?.id;
    if (tabId == null) { sendResponse({ ok: false, error: 'No sender tab.' }); return true; }
    Promise.resolve(handleWatchFacts(tabId, message.params || {}))
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error).slice(0, 500) }));
    return true;
  }
  if (!message || message.scope !== 'opera-agent-popup') return false;
  Promise.resolve().then(async () => {
    if (message.action === 'status') {
      const cfg = await getConfig();
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const currentTabPrivate = active?.id != null ? await isPrivateTab(active.id) : false;
      return { ok: true, config: { paired: cfg.paired, deviceName: cfg.deviceName, deviceId: cfg.deviceId, bridgeUrl: cfg.bridgeUrl }, state: connectionState, version: PRODUCT_VERSION, protocolVersion: PROTOCOL_VERSION, currentTabId: active?.id ?? null, currentTabPrivate };
    }
    if (message.action === 'pair') return pair(message.code);
    if (message.action === 'unpair') return unpair();
    if (message.action === 'self-test') return localSelfTest();
    if (message.action === 'toggle-private-tab') {
      const tabId = requireTabId(message.tabId);
      await chrome.tabs.get(tabId);
      return { ok: true, tabId, private: await setPrivateTab(tabId, !!message.private) };
    }
    if (message.action === 'set-bridge-url') {
      const url = safeUrl(message.url);
      if (!url) throw new Error('Invalid bridge URL.');
      await chrome.storage.local.set({ bridgeUrl: url });
      restartPullLoop();
      return { ok: true };
    }
    throw new Error('Unknown popup action.');
  }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 });
  ensurePullLoop();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 });
  ensurePullLoop();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== WAKE_ALARM) return;
  heartbeat().finally(ensurePullLoop);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.paired || changes.deviceToken || changes.bridgeUrl || changes.deviceName) {
    restartPullLoop();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Re-arm after full navigations; content.js re-injects itself on the new document.
  if (changeInfo.status === 'complete' && /^https?:/i.test(tab.url || '')) {
    const w = loadWatchers();
    Promise.resolve(w).then((watchers) => {
      if ((watchers.byTab[tabId] || []).length) armWatchersForTab(tabId).catch(() => {});
    }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  screenshotCache.delete(tabId);
  privateTabIds().then((ids) => {
    if (!ids.delete(tabId)) return;
    return chrome.storage.local.set({ [PRIVATE_TABS_KEY]: [...ids] });
  }).catch(() => {});
});

chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 }).catch(() => {});
ensurePullLoop();
