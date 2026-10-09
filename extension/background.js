// @last-edited: 2026-10-04 20:31 UTC+7.
// @title: background — MV3 runtime.
// @state: the observation says when the person last touched the page.
// @dependencies: protocol, watch, action-pipeline, focus-gate, keyboard, endpoints, role-reconcile, agent-log, popup-events, deadline-race.

import {
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  METHOD_SPECS,
  BURST_ACTION_METHODS,
  BURST_MAX_TIMEOUT_MS,
  burstCrossTabRef,
  burstStaleRef,
  validateCommand,
  normalizeError,
  safeUrl,
  clamp
} from './lib/protocol.js';
import { evaluateRules, validateRule } from './lib/watch.js';
import {
  LOOP_SYNTHETIC_DEAD_TICKS,
  LOOP_TRACK_MIN_RUN,
  centroidTrack,
  downscaleHash,
  frontOfChanged,
  matchTemplate,
  pixelDiff,
  recordTick,
  startLoopState,
  validateLoopProgram
} from './lib/loop.js';
import { pollDelays, classifyResolve, makeNotReady, attachResolution } from './lib/action-pipeline.js';
import { decideFocusGate, FOCUS_GATE_ATTEMPTS, FOCUS_GATE_SETTLE_MS } from './lib/focus-gate.js';
import { resolveKeyInput } from './lib/keyboard.js';
import { readModelConfig, saveModelEndpoint, saveModelKey, saveModelName } from './lib/options-store.js';
import { buildProbeRequest, endpointOk, MODEL_TIMEOUT_MS } from './lib/model-client.js';

import { originAllowed } from './lib/external-origins.js';

// The same file the content script loads via the manifest. It declares no
// export statements, so this is a valid side-effect import that publishes the
// pure helpers on globalThis — one source of truth for both contexts, and no
// second, drifting copy of the role table.

import './role-reconcile.js';
const { axRoleIndex, reconcileElements, hasRoleGap } = globalThis.OperaAgentRoleReconcile || {};

import { log } from './lib/log.js';
import { recordPopup, popupsSince, resolvePopupOpener, POPUP_LOG_LIMIT } from './lib/popup-events.js';
import { raceWithTimeout } from './lib/deadline-race.js';
import {
  registerDebuggerSession,
  releaseDebuggerSession,
  handleDebuggerDetach
} from './lib/debugger-session.js';
import { oversized, MAX_RESULT_BYTES, clearSerializedResult, boundedResult } from './lib/serialize.js';
import { sleep, mutateTabs, nowIso, randomToken, getConfig, setState, connectionState } from './worker/utils.js';
import { assertCaptureFramesSafe, withDebugger, codedError, collectAxSummary, screenshotBytes, screenshotHash, screenshotLooksBlank, cachedScreenshot, rememberScreenshot, screenshotCache } from './worker/capture.js';
import { privateTabIds, isPrivateTab, setPrivateTab, PRIVATE_TABS_KEY } from './worker/private-tabs.js';
import { fetchJson, publicTab, requireTabId, resolveTabId, waitTabReady, contentCall, executeInTab, HTTP_URL_RE } from './worker/tab-content.js';
import { readListenSession, listenStart, listenStop, postListenChunk } from './worker/listen.js';
import { capturePage } from './worker/capture-page.js';

// Without this, a cached `attached: true` outlives the debugger: if the user
// opens DevTools on a tab we are attached to, or the tab closes, Chrome ends
// the session and every later CDP call in it fails against a dead debugger.

chrome.debugger.onDetach.addListener(handleDebuggerDetach);

const WAKE_ALARM = 'opera-agent-wake';
const MAX_BURST_RESULT_BYTES = 256 * 1024;
const SEMANTIC_RUNTIME_EPOCH = crypto.randomUUID();

// Canvas-class pages expose almost no DOM text while their
// accessibility tree still carries state. A read this text-poor attaches a
// bounded read-only axSummary; rich pages keep the unchanged fast path.

const AX_SUMMARY_TEXT_POVERTY_CHARS = 400;

let loopPromise = null;
let loopGeneration = 0;

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
    } catch (error) {
      log.warn('FOCUS_EMULATION_ENABLE_FAILED', error?.message || String(error));
    }
  }
  try {
    return { ...(await work()), focusEmulated };
  } finally {
    if (focusEmulated) {
      try { await chrome.debugger.sendCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: false }); } catch (error) { log.debug('FOCUS_EMULATION_DISABLE_FAILED', error?.message || String(error)); }
    }
  }
}

// The at-dispatch foreground focus gate.
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

  // Bounded by construction: decideFocusGate refuses on the final attempt, so
  // the loop always terminates. Written with an explicit bound rather than a
  // conditionless for(;;) so the termination is visible here and not only in
  // the policy module.
  for (let attempt = 1; attempt <= FOCUS_GATE_ATTEMPTS; attempt += 1) {
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

// Action Pipeline: Resolve -> Wait -> Heal -> Verify around
// the shared trusted executors. Every action path (MCP page.*, burst steps,
// gateway /command, workflow steps, ETW local actions) reaches the dispatch
// action cases or the ETW click site below, so this one host gives all of
// them the same guarantee: never return `stale`, wait out dynamic targets via
// the adaptive ramp, rebind through the machinery, and report final
// outcome telemetry. Pointers are coordinate-based (no ref), so their wait
// phase is a pass-through; their own guards and scroll verification apply.

const UV_WAIT_FLOOR_MS = 250; // keep the wait strictly inside the command race

// Popup/redirect follow-through: clicks and fills on OAuth/login controls
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
  } catch (error) {
    log.warn('POPUP_TRACK_FAILED', error?.message || String(error));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  popupLog.delete(tabId);
  for (const [opener, list] of popupLog) {
    const withoutPopup = list.filter((e) => e.tabId !== tabId);
    if (withoutPopup.length) popupLog.set(opener, withoutPopup);
    else popupLog.delete(opener);
  }
  for (const [loopId, session] of loopSessions) {
    if (session.tabId === tabId) finishLoop(loopId, 'tab-closed').catch((error) => log.debug('LOOP_FINISH_FAILED', error?.message || String(error)));
  }
  for (const [loopId, session] of stateSessions) {
    if (session.tabId === tabId) finishStateLoop(loopId, 'tab-closed');
  }
});

// WHY per-case text: "never appeared" is false whenever the node left the DOM,
// which is what a page that re-renders produces, and a caller that believes it
// spends another full deadline on the same dead ref. Each case names the
// recovery that works instead of a wait that does not.

function notFoundHint(refState) {
  if (refState === 'expired') {
    return 'The page navigated or reset, so this ref was minted for another document or route and can never act again. Re-find on the current page; the ref is dead, not late.';
  }
  if (refState === 'detached') {
    return 'The target left the DOM (page re-render or removal), so this ref can never resolve. Re-find and act in ONE round trip: browser.burst with a find step, then a click step carrying refFromStep. A separate re-find round trip is stale on the same page.';
  }
  if (refState === 'unresolvable') {
    return 'This ref cannot resolve on the current document or route (never minted here, or minted for another document or route). Re-find on this page; do not retry the ref.';
  }
  return 'Target never appeared before the deadline. Arm watch.start for late UI or re-find later.';
}

// WHY one builder: three refusal sites hand-copied the same field list, so a
// field added to TARGET_NOT_READY reached one caller and was dropped by the
// others. It also names the candidates in every message, which the burst path
// alone used to drop.

function notReadyError(error) {
  const out = {
    code: error.code,
    reason: error.reason,
    waitedMs: error.waitedMs,
    hint: error.hint,
    message: `Target not ready (${error.reason}) after ${error.waitedMs}ms. ${error.hint || ''}${Array.isArray(error.candidates) ? ` Candidates: ${JSON.stringify(error.candidates)}` : ''}`.trim()
  };
  if (Array.isArray(error.candidates)) out.candidates = error.candidates;
  if (error.refState) out.refState = error.refState;
  return out;
}

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

  // WHY stop on 'expired': the content script proved this ref can never act on this
  // document or route again (no descriptor, or one minted elsewhere, and refCounter
  // never re-mints a key). Polling a ref that cannot recover only spends the deadline
  // the caller was trying to protect.
  const isExpired = () => state?.refState === 'expired';
  for (let di = 0; hasRef && verdict !== 'ready' && verdict !== 'ambiguous' && !isExpired() && di < delays.length; di += 1) {
    if (Date.now() + delays[di] > deadline - UV_WAIT_FLOOR_MS) break;
    await new Promise((r) => setTimeout(r, delays[di]));
    waitedMs += delays[di];
    verdict = await resolveState();
  }

  // Synthetic actions historically act on present-but-not-actionable targets
  // (their content paths own disabled/hidden gates — regression proves the
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
      'not-found': notFoundHint(state?.refState),
      'not-actionable': 'Target is present but not actionable (hidden/offscreen/disabled). Scroll into view or re-find.'
    };
    const gates = state?.gates ? ` [gates: ${JSON.stringify(state.gates)}]` : '';
    const resolver = resolveError ? ` [resolver: ${resolveError}]` : '';
    throw makeNotReady(verdict, waitedMs, hints[verdict] + gates + resolver, undefined, state?.refState);
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
    // Verify the fill in-page (expect parity with trustedClick); verified
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
  // WHY: the cursor is how a person sees an unattended run working, so gating it
  // on foreground left the normal background run invisible. An explicit
  // showCursor:true now works in either mode; the default is unchanged.
  const visiblePointer = params.showCursor === true || (mode === 'foreground' && params.showCursor !== false);
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

// The trusted key path resolves a declarative chord or a
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
  try { return new TextEncoder().encode(JSON.stringify(results)).byteLength; } catch (error) { log.debug('BURST_RESULT_SIZE_FAILED', error?.message || String(error)); return Number.POSITIVE_INFINITY; }
}

async function runBurst(params, outerContext = {}) {
  const tabId = await resolveTabId(params);
  const mode = executionMode(params);
  const startedAt = performance.now();
  const deadline = Math.min(outerContext.deadline || Date.now() + BURST_MAX_TIMEOUT_MS, Date.now() + BURST_MAX_TIMEOUT_MS);
  const context = { ...outerContext, deadline, debuggerSession: { tabId, attached: false } };
  const results = [];
  // Phase D: the tab the current step runs against. It starts at the burst tab
  // and only moves when a step names its own tabId, so every existing caller
  // behaves exactly as before.
  let activeTabId = tabId;

  try {
    for (let index = 0; index < params.steps.length; index += 1) {
      const step = params.steps[index];
      const stepTabId = step.tabId === undefined || step.tabId === null ? activeTabId : step.tabId;
      const switched = stepTabId !== activeTabId;
      if (switched) activeTabId = stepTabId;
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
      const method = BURST_ACTION_METHODS[step.action];
      const stepStartedAt = performance.now();
      // A refFromStep binding may only be consumed on the tab that minted it. A
      // ref is a live handle into one document, so reusing one across tabs is
      // exactly the stale-reference failure the ref-recovery work exists to
      // prevent. The comparison is against the source step's recorded tab, not
      // the switch flag: a step that stays on the already-active tab must also
      // refuse a ref minted elsewhere.
      if (step.refFromStep !== undefined && step.refFromStep !== null && burstCrossTabRef(results, step.refFromStep, stepTabId)) {
        return {
          ok: false,
          tabId,
          completedSteps: index,
          failedAt: index,
          failedAction: step.action,
          executionMode: mode,
          error: {
            code: 'BURST_CROSS_TAB_REF',
            message: `Step ${index} switches tab and cannot consume a ref minted by step ${step.refFromStep} on another tab. Re-find on the target tab.`
          },
          results,
          timingMs: Math.round((performance.now() - startedAt) * 100) / 100
        };
      }
      if (step.refFromStep !== undefined && step.refFromStep !== null && burstStaleRef(results, step.refFromStep, stepTabId)) {
        return {
          ok: false,
          tabId,
          completedSteps: index,
          failedAt: index,
          failedAction: step.action,
          executionMode: mode,
          error: {
            code: 'BURST_STALE_REF',
            message: `Step ${index} cannot consume a ref minted by step ${step.refFromStep} before a navigation on this tab replaced the document. Re-find after the navigation.`
          },
          results,
          timingMs: Math.round((performance.now() - startedAt) * 100) / 100
        };
      }
      try {
        const result = await dispatch(method, burstStepParams(step, stepTabId, remainingMs, mode, results), context);
        if ((step.action === 'click' || step.action === 'fill') && step.refFromStep !== undefined && step.refFromStep !== null
          && result && typeof result === 'object' && result.ok === true) {
          result.resolvedFrom = `step:${step.refFromStep}`;
        }
        if (step.action === 'wait' && result?.ok === false) throw new Error(String(result.error || 'wait_for timeout'));
        const entry = { index, action: step.action, tabId: stepTabId, ok: true, timingMs: Math.round((performance.now() - stepStartedAt) * 100) / 100, result };
        if (entry.tabId !== tabId) entry.switchedTab = true;
        if (burstResultSize([...results, entry]) > MAX_BURST_RESULT_BYTES) throw new Error(`Burst result exceeds ${MAX_BURST_RESULT_BYTES} bytes.`);
        results.push(entry);
      } catch (error) {
        let burstError = normalizeError(error);
        if (error && error.code === 'TARGET_NOT_READY') {
          burstError = notReadyError(error);
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
    await releaseDebuggerSession(context.debuggerSession, log);
  }
}

// Local sense-act loops. Async by design: loop.start validates and returns a
// loopId immediately, ticks run on a setTimeout chain against one persistent
// debugger attach, and loop.read/loop.stop report. No queue round trip
// happens inside a tick; the bands in the trace say how fast ticks ran.

const LOOP_MAX_ACTIVE = 4;
const LOOP_POLICY_RECHECK_TICKS = 20;

// A tick slower than five cadences is ordinary slowness (a heavy capture),
// not suspension: only a gap past both five cadences and this floor means
// the worker slept through ticks it had already scheduled.

const LOOP_SUSPEND_FLOOR_MS = 15000;
const loopSessions = new Map();
const loopResults = new Map();

function loopSummary(session, running, stopReason = null) {
  return {
    ok: true,
    loopId: session.loopId,
    tabId: session.tabId,
    running,
    ...(stopReason ? { stopReason } : {}),
    tick: session.state.tick,
    firedTotal: session.state.firedTotal,
    mode: session.mode,
    trusted: session.trusted,
    ...(session.trustedAtTick != null ? { trustedAtTick: session.trustedAtTick } : {}),
    ...(session.lastError ? { lastError: session.lastError } : {}),
    ...(session.snapshotInfo ? { snapshot: session.snapshotInfo } : {}),
    trace: session.state.trace
  };
}

async function finishLoop(loopId, stopReason) {
  const session = loopSessions.get(loopId);
  if (!session) return loopResults.get(loopId) || null;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  const summary = loopSummary(session, false, stopReason);
  loopSessions.delete(loopId);
  loopResults.set(loopId, summary);
  while (loopResults.size > 20) loopResults.delete(loopResults.keys().next().value);
  await releaseDebuggerSession(session.debuggerSession, log);
  return summary;
}

function loopSessionOnTab(tabId) {
  for (const session of loopSessions.values()) {
    if (session.tabId === tabId) return session;
  }
  for (const session of stateSessions.values()) {
    if (session.tabId === tabId) return session;
  }
  return null;
}

// MAIN-world state loops (extension/state-bridge.js). The reflex loop runs
// at frame rate inside the page against exact game state; the device only
// supervises: start it, collect its compact events, stop it. No debugger
// attach, no screenshots, no per-tick round trips at all.

const STATE_READERS = Object.freeze(['trex']);
const stateSessions = new Map();
const stateResults = new Map();

function stateSummary(session, running, stopReason = null) {
  return {
    ok: true,
    loopId: session.loopId,
    tabId: session.tabId,
    reader: session.reader,
    running,
    ...(stopReason ? { stopReason } : {}),
    ticks: session.ticks,
    jumps: session.jumps,
    events: session.events.slice(-50)
  };
}

function finishStateLoop(loopId, stopReason) {
  const session = stateSessions.get(loopId);
  if (!session) return stateResults.get(loopId) || null;
  const summary = stateSummary(session, false, stopReason);
  stateSessions.delete(loopId);
  stateResults.set(loopId, summary);
  while (stateResults.size > 20) stateResults.delete(stateResults.keys().next().value);
  chrome.scripting.executeScript({
    target: { tabId: session.tabId },
    world: 'MAIN',
    func: () => globalThis.OperaAgentStateBridge?.stop('supervisor-stop')
  }).catch((error) => log.debug('STATE_BRIDGE_STOP_FAILED', error?.message || String(error)));
  return summary;
}

function handleStateEvent(tabId, type, detail = {}) {
  for (const session of stateSessions.values()) {
    if (session.tabId !== tabId) continue;
    session.events.push({ at: Date.now(), type, detail });
    if (session.events.length > 200) session.events.splice(0, session.events.length - 200);
    if (Number.isFinite(Number(detail.ticks))) session.ticks = Number(detail.ticks);
    if (Number.isFinite(Number(detail.jumps))) session.jumps = Number(detail.jumps);
    if (type === 'game-over') finishStateLoop(session.loopId, 'game-over');
    return { ok: true, loopId: session.loopId };
  }
  return { ok: true, loopId: null };
}

async function loopDecodeTemplate(template) {
  const raw = atob(String(template));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const out = { data: pixels.data, width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return out;
}

async function loopSnapshot(tabId, clip) {
  const request = { format: 'jpeg', quality: 40, fromSurface: true };
  if (clip) {
    request.clip = {
      x: clip.x,
      y: clip.y,
      width: Math.max(1, clip.width),
      height: Math.max(1, clip.height),
      scale: 1
    };
  }
  const response = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', request);
  const raw = atob(String(response?.data || ''));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const fullWidth = clip ? clip.width : bitmap.width;

  // No downscale: this frame never leaves the device, so the transfer-size
  // budget that forces downscaling elsewhere does not apply. Downscaling to
  // a 320-wide snapshot averaged sub-pixel motion into invisibility (a
  // scrolling ground and running legs read exactly 0.000), which is what a
  // cheap sensor must still see. getImageData on a region union costs ~15ms.
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  bitmap.close?.();
  return { data: pixels.data, width, height, cssWidth: fullWidth, clipX: clip ? clip.x : 0, clipY: clip ? clip.y : 0 };
}

function loopCropRegion(snapshot, region, scale) {
  const x = Math.max(0, Math.floor((region.x - snapshot.clipX) * scale));
  const y = Math.max(0, Math.floor((region.y - snapshot.clipY) * scale));
  const width = Math.max(1, Math.min(snapshot.width - x, Math.ceil(region.width * scale)));
  const height = Math.max(1, Math.min(snapshot.height - y, Math.ceil(region.height * scale)));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const from = ((y + row) * snapshot.width + (x + col)) * 4;
      const to = (row * width + col) * 4;
      out[to] = snapshot.data[from];
      out[to + 1] = snapshot.data[from + 1];
      out[to + 2] = snapshot.data[from + 2];
      out[to + 3] = snapshot.data[from + 3];
    }
  }
  return { data: out, width, height };
}

async function loopSyntheticKey(tabId, key) {
  await contentCall(tabId, 'page.key', { key });
}

async function loopTrustedKey(tabId, key) {
  const request = resolveKeyInput({ key });
  if (request.kind === 'text') {
    for (const chunk of request.chunks) {
      await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: chunk });
    }
    return;
  }
  const spec = {
    key: request.key,
    code: request.code,
    windowsVirtualKeyCode: request.windowsVirtualKeyCode,
    nativeVirtualKeyCode: request.nativeVirtualKeyCode
  };
  const modifiers = request.modifiers ? { modifiers: request.modifiers } : {};
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...modifiers, ...spec });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...modifiers, ...spec });
}

async function loopTrustedPointer(tabId, action) {
  await withInputFocusEmulation({ tabId }, 'background', async () => {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: action.x, y: action.y });
    if (action.pointerAction !== 'click') return;
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: action.x, y: action.y, button: 'left', clickCount: 1 });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.x, y: action.y, button: 'left', clickCount: 1 });
  });
}

async function loopActKey(session, key) {
  if (!session.trusted) {
    try {
      await loopSyntheticKey(session.tabId, key);
      return;
    } catch (error) {
      log.debug('LOOP_SYNTHETIC_KEY_FAILED', error?.message || String(error));
    }
  }
  await loopTrustedKey(session.tabId, key);
}

async function loopAct(session, action) {
  if (action.action === 'key') {
    await loopActKey(session, action.key);
    return;
  }
  await loopTrustedPointer(session.tabId, action);
}

async function loopSense(session, now) {
  const program = session.program;
  const pixelSensors = program.sensors.filter((s) => s.kind !== 'timer');
  let snapshot = null;
  let captureMs = 0;
  if (pixelSensors.length > 0) {
    // Capture only the union of sensed regions: a full-viewport JPEG encode
    // per tick measured red (>250ms) in the headed drive, while the game
    // regions the schema allows are a fraction of that.
    const union = { x: Infinity, y: Infinity, right: 0, bottom: 0 };
    for (const sensor of pixelSensors) {
      union.x = Math.min(union.x, sensor.region.x);
      union.y = Math.min(union.y, sensor.region.y);
      union.right = Math.max(union.right, sensor.region.x + sensor.region.width);
      union.bottom = Math.max(union.bottom, sensor.region.y + sensor.region.height);
    }
    const clip = {
      x: Math.max(0, Math.floor(union.x)),
      y: Math.max(0, Math.floor(union.y)),
      width: Math.max(1, Math.ceil(union.right - union.x)),
      height: Math.max(1, Math.ceil(union.bottom - union.y))
    };
    const capStart = performance.now();
    snapshot = await loopSnapshot(session.tabId, clip);
    captureMs = performance.now() - capStart;
    session.scale = snapshot.width / snapshot.cssWidth;
    session.snapshotInfo = { width: snapshot.width, height: snapshot.height, cssWidth: snapshot.cssWidth };
  }
  const active = new Map();
  const values = {};
  for (const sensor of program.sensors) {
    if (sensor.kind === 'timer') {
      const last = session.timers.get(sensor.id) || 0;
      if (now - last >= sensor.everyMs) {
        session.timers.set(sensor.id, now);
        active.set(sensor.id, { fired: true });
      }
      continue;
    }
    const crop = loopCropRegion(snapshot, sensor.region, session.scale);
    if (sensor.kind === 'regionHash') {
      const hash = downscaleHash(crop.data, crop.width, crop.height);
      const before = session.frames.get(sensor.id);
      session.frames.set(sensor.id, hash);
      values[sensor.id] = hash ? hash.slice(0, 8) : null;
      if (before != null && before !== hash) active.set(sensor.id, { fired: true });
      continue;
    }
    if (sensor.kind === 'pixelDiff') {
      const before = session.frames.get(sensor.id);
      session.frames.set(sensor.id, crop);
      if (before && before.width === crop.width && before.height === crop.height) {
        const drift = pixelDiff(before.data, crop.data, 16);
        values[sensor.id] = drift;
        if (drift != null && drift > sensor.threshold) active.set(sensor.id, { fired: true, drift });
      }
      continue;
    }
    if (sensor.kind === 'track') {
      const before = session.frames.get(sensor.id);
      session.frames.set(sensor.id, crop);
      if (before && before.width === crop.width && before.height === crop.height) {
        const seen = frontOfChanged(before.data, crop.data, crop.width, crop.height, 16, LOOP_TRACK_MIN_RUN);
        const prev = session.track.get(sensor.id) || null;
        if (seen != null) {
          const tti = prev ? centroidTrack(prev.x, seen, now - prev.t, sensor.pad, sensor.leadMs) : null;
          session.track.set(sensor.id, { x: seen, t: now });
          values[sensor.id] = tti;
          if (tti != null) active.set(sensor.id, { fired: true, tti });
        } else {
          session.track.set(sensor.id, null);
        }
      }
      continue;
    }
    if (sensor.kind === 'stillness') {
      const before = session.frames.get(sensor.id);
      session.frames.set(sensor.id, crop);
      let quiet = 0;
      if (before && before.width === crop.width && before.height === crop.height) {
        const drift = pixelDiff(before.data, crop.data, 16);
        quiet = (drift != null && drift <= sensor.threshold) ? (session.quiet.get(sensor.id) || 0) + 1 : 0;
      }
      session.quiet.set(sensor.id, quiet);
      values[sensor.id] = quiet;
      if (quiet >= sensor.stillTicks) active.set(sensor.id, { fired: true, quiet });
      continue;
    }
    const template = session.templates.get(sensor.id);
    if (!template) continue;
    const match = matchTemplate(crop.data, crop.width, crop.height, template.data, template.width, template.height, 2);
    if (match) values[sensor.id] = match.score;
    if (match && match.score >= sensor.threshold) active.set(sensor.id, { fired: true, score: match.score, x: match.x, y: match.y });
  }
  return { active, values, captureMs, frameHash: snapshot ? downscaleHash(snapshot.data, snapshot.width, snapshot.height) : null };
}

function loopTickLater(session) {
  session.timer = setTimeout(() => {
    session.timer = null;
    loopTick(session.loopId);
  }, session.program.tickMs);
}

async function loopTick(loopId) {
  const session = loopSessions.get(loopId);
  if (!session) return;
  const now = Date.now();
  if (session.lastTickAt && now - session.lastTickAt > Math.max(5 * session.program.tickMs, LOOP_SUSPEND_FLOOR_MS)) {
    await finishLoop(loopId, 'suspended');
    return;
  }
  session.lastTickAt = now;
  const workStarted = performance.now();
  try {
    if (!session.debuggerSession.attached) {
      await finishLoop(loopId, 'debugger-detached');
      return;
    }
    const tab = await chrome.tabs.get(session.tabId).catch(() => null);
    if (!tab) {
      await finishLoop(loopId, 'tab-closed');
      return;
    }
    if (session.state.tick % LOOP_POLICY_RECHECK_TICKS === 0) {
      const policy = await contentCall(session.tabId, 'page.capture_policy', {});
      if (!policy.allowed) {
        await finishLoop(loopId, 'sensitive-surface');
        return;
      }
    }
    const { active, values, captureMs, frameHash } = await loopSense(session, now);
    const senseMs = performance.now() - workStarted - captureMs;
    let fired = 0;
    for (const rule of session.program.rules) {
      if (!active.has(rule.when.sensor)) continue;
      await loopAct(session, rule.do);
      fired += 1;
    }
    const actMs = performance.now() - workStarted - captureMs - senseMs;
    if (!session.trusted && fired > 0 && frameHash != null) {
      if (session.lastFrameHash != null && session.lastFrameHash === frameHash) {
        session.deadStreak += 1;
      } else {
        session.deadStreak = 0;
      }
      session.lastFrameHash = frameHash;
      if (session.deadStreak >= LOOP_SYNTHETIC_DEAD_TICKS) {
        session.trusted = true;
        session.trustedAtTick = session.state.tick + 1;
        session.deadStreak = 0;
      }
    }
    const workMs = performance.now() - workStarted;
    const result = recordTick(session.state, { workMs, fired, active: [...active.keys()], values, timing: { captureMs, senseMs, actMs } });
    session.mode = result.mode;
    if (result.overrun) {
      await finishLoop(loopId, 'tick-overrun');
      return;
    }
    if (session.state.tick >= session.program.maxTicks) {
      await finishLoop(loopId, 'max-ticks');
      return;
    }
    if (now - session.startedAt >= session.program.maxDurationMs) {
      await finishLoop(loopId, 'max-duration');
      return;
    }
    if (session.program.stopWhen.some((entry) => active.has(entry.sensor))) {
      await finishLoop(loopId, 'stop-condition');
      return;
    }
    loopTickLater(session);
  } catch (error) {
    log.warn('LOOP_TICK_FAILED', error?.message || String(error));
    session.lastError = String(error?.message || error).slice(0, 300);
    session.tickErrors += 1;
    if (session.tickErrors >= 3) {
      await finishLoop(loopId, 'tick-error');
      return;
    }
    loopTickLater(session);
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
    case 'loop.start': {
      const cfg = await getConfig();
      if (!cfg.paired || !cfg.deviceToken) throw new Error('Device is not paired.');
      const validated = validateLoopProgram(params.program);
      if (!validated.ok) throw new Error(validated.error);
      const tabId = await resolveTabId(params);
      if (loopSessionOnTab(tabId)) throw codedError('LOOP_ACTIVE', 'One loop per tab: stop the running loop first.', { tabId });
      if (loopSessions.size >= LOOP_MAX_ACTIVE) throw codedError('LOOP_ACTIVE', `Loop cap reached (${LOOP_MAX_ACTIVE} active).`, { tabId });
      const policy = await contentCall(tabId, 'page.capture_policy', {});
      if (!policy.allowed) {
        throw codedError('LOOP_BLOCKED', 'Loop refused on a sensitive surface.', { tabId, reason: policy.reason || 'SENSITIVE_SURFACE' });
      }
      const program = validated.program;
      const templates = new Map();
      for (const sensor of program.sensors) {
        if (sensor.kind !== 'templateMatch') continue;
        try {
          templates.set(sensor.id, await loopDecodeTemplate(sensor.template));
        } catch (error) {
          throw new Error(`Loop template for sensor ${sensor.id} could not be decoded: ${error?.message || error}`);
        }
      }
      const debuggerSession = { tabId, attached: false };
      await chrome.debugger.attach({ tabId }, '1.3');
      debuggerSession.attached = true;
      registerDebuggerSession(debuggerSession);
      const loopId = `lp_${randomToken().slice(0, 16)}`;
      const session = {
        loopId,
        tabId,
        program,
        templates,
        state: startLoopState(),
        timers: new Map(),
        frames: new Map(),
        quiet: new Map(),
        track: new Map(),
        debuggerSession,
        scale: 1,
        trusted: program.trusted,
        trustedAtTick: program.trusted ? 0 : null,
        deadStreak: 0,
        lastFrameHash: null,
        mode: 'full',
        timer: null,
        tickErrors: 0,
        startedAt: Date.now(),
        lastTickAt: 0
      };
      loopSessions.set(loopId, session);
      loopTickLater(session);
      return { ok: true, loopId, tabId, tickMs: program.tickMs, trusted: session.trusted };
    }
    case 'loop.read': {
      const loopId = String(params.loopId || '');
      const session = loopSessions.get(loopId);
      if (session) return loopSummary(session, true);
      const finished = loopResults.get(loopId);
      if (finished) return finished;
      throw new Error('Unknown loop.');
    }
    case 'loop.stop': {
      const loopId = String(params.loopId || '');
      const summary = await finishLoop(loopId);
      if (!summary) throw new Error('Unknown loop.');
      return summary;
    }
    case 'loop.state_start': {
      const cfg = await getConfig();
      if (!cfg.paired || !cfg.deviceToken) throw new Error('Device is not paired.');
      const reader = String(params.reader || '');
      if (!STATE_READERS.includes(reader)) throw new Error('Unknown state reader.');
      const leadMs = Number(params.leadMs);
      const tabId = await resolveTabId(params);
      if (loopSessionOnTab(tabId)) throw codedError('LOOP_ACTIVE', 'One loop per tab: stop the running loop first.', { tabId });
      const policy = await contentCall(tabId, 'page.capture_policy', {});
      if (!policy.allowed) {
        throw codedError('LOOP_BLOCKED', 'Loop refused on a sensitive surface.', { tabId, reason: policy.reason || 'SENSITIVE_SURFACE' });
      }
      await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['loop-decide.js', 'state-bridge.js'] });
      const started = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (readerName, lead) => globalThis.OperaAgentStateBridge.start(readerName, { leadMs: lead }),
        args: [reader, Number.isFinite(leadMs) && leadMs > 0 ? leadMs : 500]
      });
      const ack = started?.[0]?.result;
      if (!ack?.ok) throw new Error(ack?.error || 'State bridge refused to start.');
      const loopId = `st_${randomToken().slice(0, 16)}`;
      stateSessions.set(loopId, {
        loopId, tabId, reader, startedAt: Date.now(), ticks: 0, jumps: 0, events: []
      });
      return { ok: true, loopId, tabId, reader };
    }
    case 'loop.state_read': {
      const loopId = String(params.loopId || '');
      const session = stateSessions.get(loopId);
      if (session) return stateSummary(session, true);
      const finished = stateResults.get(loopId);
      if (finished) return finished;
      throw new Error('Unknown loop.');
    }
    case 'loop.state_stop': {
      const loopId = String(params.loopId || '');
      const summary = finishStateLoop(loopId);
      if (!summary) throw new Error('Unknown loop.');
      return summary;
    }
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

      // The validator accepts an absent deadlineMs (defaulting locally to 60s)
      // but pruneWatchers compares the stored field raw, so a stored rule
      // without it compares against NaN and never expires. Persist the
      // documented default at arm time so the stored rule is self-sufficient.
      if (candidate.deadlineMs == null) candidate.deadlineMs = 60000;
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
      const tab = await mutateTabs(() => chrome.tabs.create({ url, active: params.active !== false }));
      const ready = params.wait === false ? publicTab(tab) : await waitTabReady(tab.id, params.waitTimeoutMs);
      return { ok: true, tab: ready };
    }
    case 'tabs.activate': {
      const tabId = requireTabId(params.tabId);
      let tab = await chrome.tabs.get(tabId);
      let reused = !!tab.active;
      if (!tab.active) {
        tab = await mutateTabs(() => chrome.tabs.update(tabId, { active: true }));
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
      await mutateTabs(() => chrome.tabs.remove(tabId));
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
      const tab = await mutateTabs(() => chrome.tabs.update(tabId, { url }));
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
      // Read degradation: an oversized result used to fail the whole call at
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
        try { result.page.viewport.zoomFactor = await chrome.tabs.getZoom(tabId); } catch (error) { log.warn('TAB_ZOOM_PROBE_FAILED', error?.message || String(error)); }
      }
      // Text-poor surfaces pay the debugger round trip; collection
      // failures fail open and leave the observation unchanged.
      //
      // Follow-up: text poverty alone is the wrong trigger. A 70-page
      // Google Docs document is NOT text-poor, so its accessibility tree is
      // never collected and the role reconciliation below never runs. A page
      // whose elements still carry no real role is a semantic gap regardless of
      // how much text it has, and it is worth the same one bounded walk.
      const r9SemanticGap = hasRoleGap(result?.page?.elements);
      const shouldCollectAx = result?.ok !== false && result?.page
        && (Number(result.page.totalTextChars) <= AX_SUMMARY_TEXT_POVERTY_CHARS || r9SemanticGap);
      if (shouldCollectAx) {
        const summary = await collectAxSummary(tabId, context);
        if (summary) {
          result.page.axSummary = summary;
          // Reuse the SAME bounded AX round trip to fill in roles the
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
      // Report the user's current state with the observation. Without it the model
      // cannot tell whether the person is watching this tab or working elsewhere,
      // and so cannot choose foreground or background sensibly. It is the same
      // sample the focus gate already takes, plus how long ago the page last saw a
      // real user gesture, which is what separates "reading it right now" from "left
      // it open". It fails open: a missing userState is a gap in the report, not a
      // failure of the read.
      if (result?.page) {
        try {
          const { tabActive, windowFocused } = await sampleTabFocus(tabId);
          result.page.userState = {
            tabActive,
            windowFocused,
            watching: tabActive === true && windowFocused === true,
            lastInputMs: result.page.userInput?.lastInputMs ?? null
          };
        } catch (error) {
          log.warn('USER_STATE_PROBE_FAILED', error?.message || String(error));
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
    case 'media.stream_start': {
      const tabId = await resolveTabId(params);
      return listenStart(tabId, params);
    }
    case 'media.stream_stop':
      return listenStop();
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

// ---- Event-Triggered Workflows: watch registry ----
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
    // Legacy rows stored before the arm-time default carry no deadlineMs
    // (undefined) or an explicit null; both compare as NaN and would never
    // expire, while the engine already retires them locally via ?? 60000.
    // Treat a missing deadline as expired so storage agrees with the engine.
    const expired = entry.rule.deadlineMs == null || now - entry.createdAt > entry.rule.deadlineMs;
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
  try { await chrome.tabs.get(tabId); return true; } catch (error) { log.debug('TAB_EXISTS_PROBE_FAILED', error?.message || String(error)); return false; }
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
  if (!entries.length) return { fired: 0, state: {} };
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
    if (entry) handleWatchFire(entry, fire, facts).catch((error) => { log.warn('WATCH_FIRE_FAILED', error?.message || String(error)); });
  }

  // The content script echoes `r.state` into the `watchState` it sends back as
  // `facts.state` on the next check, so the engine state must ride the reply;
  // without it every evaluation starts from an empty baseline and re-fires.
  return { fired: out.fired.length, state: out.state };
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
      // This path shares a debugger session, which is why it needs the release
      // that runBurst already had. Without it a single ad-overlay click left
      // the debugger attached to the tab, and Chrome's "started debugging this
      // browser" bar stuck on it for the tab's lifetime.
      try {
        const result = action.trusted === true
          ? await runActionPipeline(entry.tabId, 'page.click', { ref }, clickContext, (ref2) => trustedClick(entry.tabId, ref2, clickContext, 'background', {}))
          : await dispatch('page.click', { tabId: entry.tabId, ref, trusted: false }, clickContext);
        return { type: 'click', ok: !!result?.ok, error: result?.error || null };
      } finally {
        await releaseDebuggerSession(clickContext.debuggerSession, log);
      }
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

// A command timeout is an unknown outcome, not a definite failure — the
// action may have taken effect (parity with the BURST_TIMEOUT / GATEWAY_ERROR
// unknown-outcome contract family), so the model must verify page state
// before repeating it.
function commandTimeoutError() {
  return codedError('COMMAND_TIMEOUT', 'Command timed out: the browser action may have taken effect. Verify page state before repeating it.');
}

// Hover a resolved target and settle on the reveal.
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
  // Drop any memoized result serialization from the previous command so a large
  // page.read result is not pinned for the worker's lifetime.
  clearSerializedResult();
  // Watch.* and loop.* are internal extension-side families (protocol primitive
  // count stays frozen at 28); their validation lives in lib/watch.js and
  // lib/loop.js respectively.
  if (raw && typeof raw.method === 'string' && (raw.method.startsWith('watch.') || raw.method.startsWith('loop.'))) {
    const deadlineW = Date.now() + 10000;
    try {
      const result = await raceWithTimeout(
        () => dispatch(raw.method, raw.params || {}, { deadline: deadlineW }),
        10000,
        commandTimeoutError
      );
      return { ok: true, result: boundedResult(result) };
    } catch (error) {
      if (error && error.code === 'TARGET_NOT_READY') {
        return { ok: false, error: notReadyError(error) };
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
    const result = await raceWithTimeout(
      () => dispatch(command.method, command.params, { deadline }),
      Math.max(1, deadline - Date.now()),
      commandTimeoutError
    );
    return { ok: true, result: boundedResult(result) };
  } catch (error) {
    if (error && error.code === 'TARGET_NOT_READY') {
      return { ok: false, error: notReadyError(error) };
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
    capabilities: Object.keys(METHOD_SPECS),
    browserName: globalThis.OperaAgentBrowserId?.browserName || 'Unknown'
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
  // WHY stop listening first: the device token is removed below, so chunks
  // would fail auth anyway — but the recorder would keep running silently.
  await listenStop().catch(() => {});
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
    // Short-window pull: the server wait stays well inside the fetch timeout
    // with room for a cold start. A 12s wait leaves only a 3s margin, and any
    // path hostile to long idle requests turns every window into an abort
    // while fast requests keep passing. Idle cost rises from one trip per 12s
    // window to one per 5s; worst-case claim latency falls from ~12s to ~5s.
    waitMs: 5000
  }, 10000);
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

// WHY an external listener at all: the landing page configures the user's own model
// by sending one message to this extension. externally_connectable decides which
// pages may send it, and it needs no content script and no host permission, so the
// page cannot read anything from here and this side still validates every value
// with the same store the Options page uses.
chrome.runtime.onMessageExternal?.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'applyModelConfig') return false;
  const from = String(sender?.origin || sender?.url || '');
  if (!originAllowed(from)) {
    sendResponse({ ok: false, message: 'That page may not configure this extension.' });
    return true;
  }
  (async () => {
    if (String(message.modelKey ?? '').trim() === '') throw new Error('A model key is required here; to revoke it, clear it in the options page.');
    await saveModelEndpoint(chrome.storage.local, message.modelEndpoint);
    await saveModelName(chrome.storage.local, message.modelName);
    await saveModelKey(chrome.storage.local, message.modelKey);
    return { ok: true };
  })()
    .then((reply) => sendResponse(reply))
    .catch((error) => sendResponse({ ok: false, message: String(error?.message || error).slice(0, 200) }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.scope === 'opera-agent-listen-chunk') {
    const tabId = sender?.tab?.id;
    Promise.resolve(postListenChunk(tabId, message.seq, message.audio, message.mime))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error).slice(0, 200) }));
    return true;
  }
  if (message && message.scope === 'opera-agent-state-event') {
    const tabId = sender?.tab?.id;
    if (tabId == null) { sendResponse({ ok: false, error: 'No sender tab.' }); return true; }
    try {
      sendResponse({ ok: true, ...handleStateEvent(tabId, String(message.type || ''), message.detail || {}) });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error).slice(0, 200) });
    }
    return true;
  }
  if (message && message.scope === 'opera-agent-watch' && message.method === 'watch.facts') {    const tabId = sender?.tab?.id;
    if (tabId == null) { sendResponse({ ok: false, error: 'No sender tab.' }); return true; }
    Promise.resolve(handleWatchFacts(tabId, message.params || {}))
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error).slice(0, 500) }));
    return true;
  }
  if (message && message.scope === 'opera-agent-options' && message.action === 'testModel') {
    (async () => {
      const cfg = await readModelConfig(chrome.storage.local);
      if (!cfg.configured) return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: `Belum dikonfigurasi: ${cfg.missing.join(', ')}.` };
      if (!endpointOk(cfg.endpoint)) return { ok: false, code: 'MODEL_BAD_ENDPOINT', message: 'The model endpoint must be https or loopback http.' };
      const probe = buildProbeRequest({ model: cfg.model });
      const res = await fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.key}` }, body: JSON.stringify({ ...probe }), signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
      if (!res || !res.ok) return { ok: false, code: 'MODEL_HTTP_ERROR', message: `Endpoint menjawab ${res?.status ?? 'nothing'}.` };
      return { ok: true };
    })()
      .then((reply) => sendResponse(reply))
      .catch((error) => sendResponse({ ok: false, code: 'MODEL_HTTP_ERROR', message: String(error?.message || error).slice(0, 200) }));
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
    throw new Error('Unknown popup action.');
  }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 });
  // WHY stop on install and update: a recorder cannot survive either, so a
  // stored session would otherwise point at a dead capture while the server
  // still bills transcription windows against it.
  await listenStop().catch(() => {});
  ensurePullLoop();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 });
  await listenStop().catch(() => {});
  ensurePullLoop();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== WAKE_ALARM) return;
  heartbeat().finally(ensurePullLoop);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.paired || changes.deviceToken || changes.bridgeUrl || changes.deviceName || changes.logLevel) {
    restartPullLoop();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Re-arm after full navigations; content.js re-injects itself on the new document.
  if (changeInfo.status === 'complete' && /^https?:/i.test(tab.url || '')) {
    const w = loadWatchers();
    Promise.resolve(w).then((watchers) => {
      if ((watchers.byTab[tabId] || []).length) armWatchersForTab(tabId).catch((error) => { log.warn('WATCH_ARM_FAILED', error?.message || String(error)); });
    }).catch((error) => { log.warn('WATCHERS_LOAD_FAILED', error?.message || String(error)); });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  screenshotCache.delete(tabId);
  readListenSession().then((existing) => {
    // WHY stop when the captured tab closes: the recorder dies with the page, so
    // keeping the session live would transcribe silence until the 30-minute cap.
    if (existing?.tabId === tabId) listenStop().catch(() => {});
  }).catch(() => {});
  privateTabIds().then((ids) => {
    if (!ids.delete(tabId)) return;
    return chrome.storage.local.set({ [PRIVATE_TABS_KEY]: [...ids] });
  }).catch((error) => { log.debug('PRIVATE_TAB_CLEANUP_FAILED', error?.message || String(error)); });
});

chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 }).catch((error) => { log.warn('WAKE_ALARM_CREATE_FAILED', error?.message || String(error)); });
ensurePullLoop();
