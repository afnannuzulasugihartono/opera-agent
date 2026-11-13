// @last-edited: 2026-10-13 UTC+7.
// @title: action-focus — the foreground focus gate, the action pipeline and trusted input.
// @state: owns the popup focus log and its floor.
// @dependencies: utils, tab-content, capture, log, protocol, action-pipeline, focus-gate, keyboard, popup-events.

import { log } from '../lib/log.js';
import { METHOD_SPECS, clamp } from '../lib/protocol.js';
import { pollDelays, classifyResolve, makeNotReady, attachResolution } from '../lib/action-pipeline.js';
import { decideFocusGate, FOCUS_GATE_ATTEMPTS, FOCUS_GATE_SETTLE_MS } from '../lib/focus-gate.js';
import { resolveKeyInput, resolveKeyStream, resolveTextKeys, MODIFIER_BITS } from '../lib/keyboard.js';
import { recordPopup, resolvePopupOpener, POPUP_LOG_LIMIT } from '../lib/popup-events.js';
import { sleep } from './utils.js';
import { contentCall } from './tab-content.js';
import { withDebugger, type CaptureContext } from './capture.js';
import { isRecord } from '../lib/guards.js';

export function executionMode(params: { executionMode?: unknown } = {}) {
  return params.executionMode === 'foreground' ? 'foreground' : 'background';
}

function foregroundRequired(message: string, details: Record<string, unknown> = {}) {
  const error: Error & { code?: string; details?: unknown } = new Error(message);
  error.code = 'FOREGROUND_REQUIRED';
  error.details = { requiredExecutionMode: 'foreground', ...details };
  return error;
}

export async function withInputFocusEmulation(target: chrome.debugger.DebuggerSession, mode: string | undefined, work: () => Promise<Record<string, unknown> | undefined>) {
  let focusEmulated = false;
  if (mode === 'background') {
    try {
      await chrome.debugger.sendCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: true });
      focusEmulated = true;
    } catch (error) {
      log.warn('FOCUS_EMULATION_ENABLE_FAILED', error instanceof Error ? error.message : String(error));
    }
  }
  try {
    return { ...(await work()), focusEmulated };
  } finally {
    if (focusEmulated) {
      try { await chrome.debugger.sendCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: false }); } catch (error) { log.debug('FOCUS_EMULATION_DISABLE_FAILED', error instanceof Error ? error.message : String(error)); }
    }
  }
}

export async function sampleTabFocus(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  return { tabActive: !!tab.active, windowFocused: !!win.focused, windowId: tab.windowId };
}

export async function withForegroundFocusGate(tabId: number, mode: string | undefined, work: () => Promise<Record<string, unknown>>) {
  if (mode !== 'foreground') return work();

  for (let attempt = 1; attempt <= FOCUS_GATE_ATTEMPTS; attempt += 1) {
    let sample = null;
    try {
      sample = await sampleTabFocus(tabId);
    } catch (error) {
      throw foregroundRequired('Foreground focus state could not be verified before the input was dispatched.', {
        targetTabId: tabId,
        attempts: attempt,
        reason: error instanceof Error ? error.message : String(error)
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

export const popupLog = new Map<number, Array<{ tabId?: number | undefined; url: string; at: number }>>();
const popupActionStack: number[] = [];
const POPUP_LOG_MAX_AGE_MS = 60000;

function popupInFlightTab() {
  return popupActionStack.length ? popupActionStack[popupActionStack.length - 1] : null;
}

export async function withActionPopupTracking(tabId: number, work: () => Promise<Record<string, unknown>>) {
  popupActionStack.push(Number(tabId));
  try {
    return await work();
  } finally {
    const index = popupActionStack.lastIndexOf(Number(tabId));
    if (index >= 0) popupActionStack.splice(index, 1);
  }
}

function prunePopupLog(now: number = Date.now()) {
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
    log.warn('POPUP_TRACK_FAILED', error instanceof Error ? error.message : String(error));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  popupLog.delete(tabId);
  for (const [opener, list] of popupLog) {
    const withoutPopup = list.filter((e) => e.tabId !== tabId);
    if (withoutPopup.length) popupLog.set(opener, withoutPopup);
    else popupLog.delete(opener);
  }
});

function notFoundHint(refState: unknown) {
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

export function notReadyError(error: unknown) {
  const source = isRecord(error) ? error : {};
  const candidates = source.candidates;
  const out: { code: unknown; reason: unknown; waitedMs: unknown; hint: unknown; message: string; candidates?: unknown; refState?: unknown } = {
    code: source.code,
    reason: source.reason,
    waitedMs: source.waitedMs,
    hint: source.hint,
    message: `Target not ready (${String(source.reason)}) after ${String(source.waitedMs)}ms. ${source.hint ? String(source.hint) : ''}${Array.isArray(candidates) ? ` Candidates: ${JSON.stringify(candidates)}` : ''}`.trim()
  };
  if (Array.isArray(candidates)) out.candidates = candidates;
  if (source.refState) out.refState = source.refState;
  return out;
}

export async function runActionPipeline(tabId: number, method: string, params: Record<string, unknown> | null | undefined, context: CaptureContext | null | undefined, exec: (ref: string | undefined) => Promise<Record<string, unknown> | null>) {
  const started = Date.now();
  const specTimeout = METHOD_SPECS[method]?.timeoutMs ?? 8000;
  const cmdDeadline = Number(context?.deadline) || (started + specTimeout);
  const deadline = Math.min(cmdDeadline, started + specTimeout);
  const refParam = params?.ref;
  const hasRef = typeof refParam === 'string' && refParam.length > 0;
  let attempts = 0;
  let healed = false;
  let waitedMs = 0;
  let state: Record<string, unknown> | null = null;
  let resolveError: string | null = null;
  const resolveState = async () => {
    attempts += 1;
    try {
      state = await contentCall(tabId, 'page.action_state', { ref: params?.ref });
      resolveError = null;
    } catch (error) {
      state = null;
      resolveError = error instanceof Error ? error.message : String(error);
    }
    if (state?.rebound) healed = true;
    return classifyResolve(state);
  };
  let verdict = hasRef ? await resolveState() : 'ready';
  const delays = pollDelays(deadline - started, 0);

  const isExpired = () => state?.refState === 'expired';
  for (let di = 0; hasRef && verdict !== 'ready' && verdict !== 'ambiguous' && !isExpired() && di < delays.length; di += 1) {
    const delay = delays[di];
    if (delay === undefined) break;
    if (Date.now() + delay > deadline - UV_WAIT_FLOOR_MS) break;
    await new Promise((r) => setTimeout(r, delay));
    waitedMs += delay;
    verdict = await resolveState();
  }

  const readState = (): Record<string, unknown> | null => state;
  const snapshot = readState();

  if (verdict === 'not-actionable' && params?.trusted !== true) verdict = 'ready';
  if (verdict === 'ambiguous') {

    throw makeNotReady('ambiguous', waitedMs, snapshot?.refusal || 'Refusal is deliberate (geometry guard). Pick a listed candidate deliberately or re-find with narrower text.', snapshot?.candidates);
  }
  if (verdict !== 'ready') {
    const hints = {
      'not-found': notFoundHint(snapshot?.refState),
      'not-actionable': 'Target is present but not actionable (hidden/offscreen/disabled). Scroll into view or re-find.'
    };
    const gates = snapshot?.gates ? ` [gates: ${JSON.stringify(snapshot.gates)}]` : '';
    const resolver = resolveError ? ` [resolver: ${resolveError}]` : '';
    throw makeNotReady(verdict, waitedMs, hints[verdict] + gates + resolver, undefined, snapshot?.refState);
  }
  const result = await exec(typeof refParam === 'string' ? refParam : undefined);

  const postAction = result && isRecord(result.postAction) ? result.postAction : null;
  if ((method === 'page.click' || method === 'page.fill') && postAction && postAction.verified !== undefined) {
    return attachResolution(result, { attempts, waitedMs, healed, verified: postAction.verified === true });
  }
  return attachResolution(result, { attempts, waitedMs, healed });
}

export async function trustedClick(tabId: number, ref: string | undefined, context: CaptureContext | null | undefined, mode: string = 'background', options: { attempts?: unknown; expect?: unknown } = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts) || 1));
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const info = await contentCall(tabId, 'page.click_info', { ref });
    if (!info) throw new Error('No response from page.click_info.');
    const rect = isRecord(info.rect) ? info.rect : null;
    const x = rect?.centerX;
    const y = rect?.centerY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Element has no clickable rectangle.');
    const action = await withDebugger(tabId, context, (target: chrome.debugger.DebuggerSession) => withInputFocusEmulation(target, mode, () =>
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
    if (!postAction) throw new Error('No response from page.post_action.');
    last = { ...action, postAction, attempts: attempt };
    if (postAction.verified !== false || attempt >= attempts) break;
  }
  return last;
}

export async function trustedFill(tabId: number, ref: string | undefined, value: unknown, context: CaptureContext | null | undefined, mode: string = 'background', options: { expect?: unknown } = {}) {
  const text = String(value ?? '').slice(0, 20000);
  const info = await contentCall(tabId, 'page.fill_info', { ref });
  if (!info) throw new Error('No response from page.fill_info.');
  return withDebugger(tabId, context, (target: chrome.debugger.DebuggerSession) => withInputFocusEmulation(target, mode, () =>
    withForegroundFocusGate(tabId, mode, async () => {
    const active = await contentCall(tabId, 'page.active_state', {});
    if (!active) throw new Error('No response from page.active_state.');
    const activeElement = active.active;
    const activeRef = isRecord(activeElement) ? activeElement.ref : undefined;
    if (active.sensitive || activeRef !== ref) {
      throw new Error('Trusted fill target lost safe document focus before text insertion.');
    }
    let action: { ok: boolean; ref?: unknown; valueLength?: number; method?: string } | undefined;
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
    if (!postAction) throw new Error('No response from page.post_action.');
    return { ...action, postAction };
  })));
}

export async function trustedPointer(tabId: number, params: Record<string, unknown>, context: CaptureContext | null | undefined) {
  const mode = executionMode(params);
  const action = String(params.action || 'click');

  const visiblePointer = params.showCursor === true || (mode === 'foreground' && params.showCursor !== false);
  const start = await contentCall(tabId, 'page.pointer_target', { x: params.x, y: params.y, showCursor: visiblePointer, action });
  if (!start) throw new Error('No response from page.pointer_target.');
  const end = action === 'drag'
    ? await contentCall(tabId, 'page.pointer_target', { x: params.endX, y: params.endY, showCursor: visiblePointer, action })
    : null;
  return withDebugger(tabId, context, (target: chrome.debugger.DebuggerSession) => withInputFocusEmulation(target, mode, () =>
    withForegroundFocusGate(tabId, mode, async () => {
    let scroll: Record<string, unknown> | null = null;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
    if (action === 'click') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    } else if (action === 'drag') {
      if (!end) throw new Error('No response from page.pointer_target (drag).');
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
      if (!scroll) throw new Error('No response from page.scroll_settle.');
      scroll.inputMethod = 'debugger';

      // WHY THE BOUNDARY IS READ PER AXIS AND PER DIRECTION.
      // A wheel that moved down asks whether the bottom was reached, and a wheel that moved up asks about the top; asking the wrong one reports a scroll that stopped when it had room.
      // Written as one expression over four directions it is unreadable, and the answer it gives is what the caller uses to decide whether to scroll again.
      // It is read after the fallback rather than before it, so the boundary describes the scroll the caller ended up with rather than the one the debugger attempted.
      const boundaryFor = (axis: 'X' | 'Y', delta: number) => {
        if (!scroll) return false;
        const after = scroll.after;
        if (delta > 0) return isRecord(after) && after[`reached${axis === 'Y' ? 'Bottom' : 'Right'}`] === true;
        if (delta < 0) return isRecord(after) && after[`reached${axis === 'Y' ? 'Top' : 'Left'}`] === true;
        return false;
      };
      const canMoveY = deltaY !== 0 && !boundaryFor('Y', deltaY);
      const canMoveX = deltaX !== 0 && !boundaryFor('X', deltaX);
      if (!scroll.moved && (canMoveY || canMoveX)) {
        scroll = await contentCall(tabId, 'page.scroll_target', {
          x: start.x,
          y: start.y,
          ref: isRecord(start.scrollTarget) ? start.scrollTarget.ref : undefined,
          before: start.scrollTarget,
          beforeMutationVersion: start.mutationVersion,
          deltaX,
          deltaY
        });
        if (!scroll) throw new Error('No response from page.scroll_target.');
        scroll.inputMethod = 'dom-fallback';
      }
      scroll.reachedBoundary = deltaY !== 0 ? boundaryFor('Y', deltaY) : boundaryFor('X', deltaX);
    }
    return { ok: true, method: 'debugger', action, executionMode: mode, visiblePointer, start, end, ...(scroll ? { scroll } : {}) };
  })));
}

// WHY TEXT SOMETIMES TRAVELS ONE CHARACTER AT A TIME.
// An IME insert carries no key events, and canvas editors commit off key-event sequences, so the insert reports success and paints nothing.
// One keyDown carrying text plus keyUp per character is the shape such editors accept; the caller opts in per call because native inputs are faster and correct on plain inserts.

async function sendTextAsKeys(target: chrome.debugger.DebuggerSession, text: string) {
  const keys = resolveTextKeys(text);
  for (const spec of keys) {
    const modifiers = spec.shift ? { modifiers: MODIFIER_BITS.shift } : {};
    const codes = { key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.vk, nativeVirtualKeyCode: spec.vk };
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', text: spec.text, ...codes, ...modifiers });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...codes, ...modifiers });
  }
  return { ok: true, method: 'debugger', input: 'text-keys', valueLength: keys.length, keys: keys.length };
}

export async function trustedKey(tabId: number, params: Record<string, unknown> | null | undefined, context: CaptureContext | null | undefined, mode: string = 'background') {
  const request = resolveKeyInput({
    key: params?.key,
    modifiers: params?.modifiers,
    text: params?.text
  });
  const active = await contentCall(tabId, 'page.active_state', {});
  if (!active) throw new Error('No response from page.active_state.');
  if (active.sensitive) throw new Error('Keyboard input blocked on sensitive field.');
  return withDebugger(tabId, context, (target: chrome.debugger.DebuggerSession) => withInputFocusEmulation(target, mode, () =>
    withForegroundFocusGate(tabId, mode, async () => {
    if (request.kind === 'text') {
      if (params?.keyEvents === true) {
        return sendTextAsKeys(target, request.text);
      }
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

export async function trustedKeyStream(tabId: number, params: Record<string, unknown> | null | undefined, context: CaptureContext | null | undefined, mode: string = 'background') {
  const events = resolveKeyStream(params?.events);
  const active = await contentCall(tabId, 'page.active_state', {});
  if (!active) throw new Error('No response from page.active_state.');
  if (active.sensitive) throw new Error('Keyboard input blocked on sensitive field.');
  return withDebugger(tabId, context, (target: chrome.debugger.DebuggerSession) => withInputFocusEmulation(target, mode, () =>
    withForegroundFocusGate(tabId, mode, async () => {
    const started = Date.now();
    let chords = 0;
    let chars = 0;
    for (const event of events) {
      if (event.kind === 'text') {
        if (params?.keyEvents === true) {
          const sent = await sendTextAsKeys(target, event.text);
          chars += sent.keys;
        } else {
          for (const chunk of event.chunks) {
            await chrome.debugger.sendCommand(target, 'Input.insertText', { text: chunk });
          }
          chars += event.chars;
        }
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

interface BurstStep {
  action?: unknown;
  pointerAction?: unknown;
  refFromStep?: unknown;
  refIndex?: unknown;
  timeoutMs?: unknown;
  [key: string]: unknown;
}

function burstPassthroughRef(results: Array<Record<string, unknown>>, step: BurstStep) {
  const from = step.refFromStep;
  if (from === undefined || from === null) return null;
  const source = results[Number(from)];
  const items = isRecord(source?.result) ? source.result.items : undefined;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`refFromStep must reference an earlier burst step with items (step ${String(from)} returned none).`);
  }
  const want = step.refIndex;
  const pick: unknown = want === undefined || want === null ? items[0] : items[Number(want)];
  if (!isRecord(pick) || typeof pick.ref !== 'string' || !pick.ref) {
    throw new Error(`refFromStep must reference an earlier burst step with items (step ${String(from)} item has no ref).`);
  }
  return { ref: pick.ref, resolvedFrom: `step:${String(from)}` };
}

export function burstStepParams(step: BurstStep, tabId: number, remainingMs: number, mode: string, results?: Array<Record<string, unknown>>) {
  const { action, pointerAction, ...values } = step;
  const params: Record<string, unknown> = { ...values, tabId, executionMode: mode };

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
