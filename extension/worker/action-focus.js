// @last-edited: 2026-10-09 UTC+7.
// @title: action-focus — the foreground focus gate, the action pipeline and trusted input.
// @state: owns the popup focus log and its floor; loop-engine reads popupLog from here, and this module takes stateSessions from loop-engine.
// @dependencies: utils, tab-content, capture, loop-engine, log, protocol, action-pipeline, focus-gate, keyboard, popup-events.

import { log } from '../lib/log.js';
import { METHOD_SPECS, clamp } from '../lib/protocol.js';
import { pollDelays, classifyResolve, makeNotReady, attachResolution } from '../lib/action-pipeline.js';
import { decideFocusGate, FOCUS_GATE_ATTEMPTS, FOCUS_GATE_SETTLE_MS } from '../lib/focus-gate.js';
import { resolveKeyInput, resolveKeyStream } from '../lib/keyboard.js';
import { recordPopup, resolvePopupOpener, POPUP_LOG_LIMIT } from '../lib/popup-events.js';
import { sleep } from './utils.js';
import { contentCall } from './tab-content.js';
import { withDebugger } from './capture.js';
import { finishLoop, finishStateLoop, loopSessions, stateSessions } from './loop-engine.js';

export function executionMode(params = {}) {
  return params.executionMode === 'foreground' ? 'foreground' : 'background';
}

function foregroundRequired(message, details = {}) {
  const error = new Error(message);
  error.code = 'FOREGROUND_REQUIRED';
  error.details = { requiredExecutionMode: 'foreground', ...details };
  return error;
}

export async function withInputFocusEmulation(target, mode, work) {
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

export async function sampleTabFocus(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  return { tabActive: !!tab.active, windowFocused: !!win.focused, windowId: tab.windowId };
}

export async function withForegroundFocusGate(tabId, mode, work) {
  if (mode !== 'foreground') return work();

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

const UV_WAIT_FLOOR_MS = 250;

export const popupLog = new Map();
const popupActionStack = [];
const POPUP_LOG_MAX_AGE_MS = 60000;

function popupInFlightTab() {
  return popupActionStack.length ? popupActionStack[popupActionStack.length - 1] : null;
}

export async function withActionPopupTracking(tabId, work) {
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

export function notReadyError(error) {
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

export async function runActionPipeline(tabId, method, params, context, exec) {
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
      state = null;
      resolveError = String(error?.message || error);
    }
    if (state?.rebound) healed = true;
    return classifyResolve(state);
  };
  let verdict = hasRef ? await resolveState() : 'ready';
  const delays = pollDelays(deadline - started, 0);

  const isExpired = () => state?.refState === 'expired';
  for (let di = 0; hasRef && verdict !== 'ready' && verdict !== 'ambiguous' && !isExpired() && di < delays.length; di += 1) {
    if (Date.now() + delays[di] > deadline - UV_WAIT_FLOOR_MS) break;
    await new Promise((r) => setTimeout(r, delays[di]));
    waitedMs += delays[di];
    verdict = await resolveState();
  }

  if (verdict === 'not-actionable' && params?.trusted !== true) verdict = 'ready';
  if (verdict === 'ambiguous') {

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

  if ((method === 'page.click' || method === 'page.fill') && result?.postAction?.verified !== undefined) {
    return attachResolution(result, { attempts, waitedMs, healed, verified: result.postAction.verified === true });
  }
  return attachResolution(result, { attempts, waitedMs, healed });
}

export async function trustedClick(tabId, ref, context, mode = 'background', options = {}) {
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

export async function trustedFill(tabId, ref, value, context, mode = 'background', options = {}) {
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

    const postAction = await contentCall(tabId, 'page.post_action', {
      ref,
      before: info.postActionBefore,
      expect: options.expect || undefined
    });
    return { ...action, postAction };
  })));
}

export async function trustedPointer(tabId, params, context) {
  const mode = executionMode(params);
  const action = String(params.action || 'click');

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

export async function trustedKey(tabId, params, context, mode = 'background') {
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

export async function trustedKeyStream(tabId, params, context, mode = 'background') {
  const events = resolveKeyStream(params?.events);
  const active = await contentCall(tabId, 'page.active_state', {});
  if (active.sensitive) throw new Error('Keyboard input blocked on sensitive field.');
  return withDebugger(tabId, context, (target) => withInputFocusEmulation(target, mode, () =>
    withForegroundFocusGate(tabId, mode, async () => {
    const started = Date.now();
    let chords = 0;
    let chars = 0;
    for (const event of events) {
      if (event.kind === 'text') {
        for (const chunk of event.chunks) {
          await chrome.debugger.sendCommand(target, 'Input.insertText', { text: chunk });
        }
        chars += event.chars;
      } else {
        const spec = {
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: event.windowsVirtualKeyCode,
          nativeVirtualKeyCode: event.nativeVirtualKeyCode
        };
        const modifiers = event.modifiers ? { modifiers: event.modifiers } : {};
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...modifiers, ...spec });
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...modifiers, ...spec });
        chords += 1;
      }
      if (event.gapMs > 0) await sleep(event.gapMs);
    }
    return {
      ok: true,
      events: events.length,
      chords,
      chars,
      execMs: Date.now() - started,
      method: 'debugger',
      input: 'stream'
    };
  })));
}

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

export function burstStepParams(step, tabId, remainingMs, mode, results) {
  const { action, pointerAction, ...values } = step;
  const params = { ...values, tabId, executionMode: mode };

  if (action === 'click' || action === 'fill' || action === 'hover') {
    const passthrough = burstPassthroughRef(results || [], step);
    if (passthrough) {
      params.ref = passthrough.ref;
      params.resolvedFrom = passthrough.resolvedFrom;
    }
    params.trusted = true;
  }
  if (action === 'key') params.trusted = true;
  if (action === 'pointer') {
    params.action = pointerAction || 'click';
    params.showCursor = true;
  }
  if (action === 'wait') params.timeoutMs = Math.min(clamp(params.timeoutMs, 50, 8000, 3000), remainingMs);
  return params;
}
