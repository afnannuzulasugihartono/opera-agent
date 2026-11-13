// @last-edited: 2026-10-09 UTC+7.
// @title: watch-registry — event-triggered watchers: persistence, arming and firing.
// @state: owns the WATCH_* caps and both watcher tables; dispatch reads MAX_WATCHERS_PER_TAB and MAX_WATCHERS_GLOBAL from here.
// @dependencies: utils, tab-content, capture, action-focus, burst, background, log, protocol, watch, debugger-session.

import { log } from '../lib/log.js';
import { clamp } from '../lib/protocol.js';
import { evaluateRules, type WatchRule } from '../lib/watch.js';
import { releaseDebuggerSession } from '../lib/debugger-session.js';
import { isRecord } from '../lib/guards.js';
import { getConfig, setState } from './utils.js';
import { fetchJson, contentCall, executeInTab } from './tab-content.js';
import { withDebugger, codedError, type CaptureContext } from './capture.js';
import {
  executionMode,
  withInputFocusEmulation,
  withForegroundFocusGate,
  runActionPipeline,
  trustedClick,
} from './action-focus.js';
import { runBurst } from './burst.js';
import { dispatch } from '../background.js';

export interface WatchEntry {
  id: string;
  tabId: number | null;
  rule: WatchRule;
  createdAt: number;
  runtime?: { fireCount?: number | undefined; lastFireAt?: number | undefined; retired?: boolean | undefined; armedAt?: number | undefined } | undefined;
}

export interface WatchState {
  watchers: WatchEntry[];
  byTab: Record<string, string[]>;
}

const WATCH_STATE_KEY = 'watchers';
export const MAX_WATCHERS_PER_TAB = 8;
export const MAX_WATCHERS_GLOBAL = 32;
const WATCH_MAX_RULES_PER_ARM = 8;

export function watchRuleId(prefix: string) {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function loadWatchers(): Promise<WatchState> {
  const bag = await chrome.storage.local.get(WATCH_STATE_KEY);
  return (bag[WATCH_STATE_KEY] || { watchers: [], byTab: {} }) as WatchState;
}

export async function saveWatchers(w: WatchState) {
  await chrome.storage.local.set({ [WATCH_STATE_KEY]: w });
}

export function watcherIdsForTab(w: WatchState, tabId: number | undefined): string[] {
  return (tabId === undefined ? [] : w.byTab[tabId] || []).filter((id) => w.watchers.some((e) => e.id === id));
}

export async function pruneWatchers(): Promise<WatchState> {
  const w = await loadWatchers();
  const now = Date.now();
  const alive: WatchEntry[] = [];
  let changed = false;
  for (const entry of w.watchers) {

    const expired = entry.rule.deadlineMs == null || now - entry.createdAt > entry.rule.deadlineMs;
    const tabGone = entry.tabId != null && !await tabExists(entry.tabId);
    if (expired || tabGone) { changed = true; continue; }
    alive.push(entry);
  }
  if (!changed) return w;
  const byTab: Record<string, string[]> = {};
  for (const entry of alive) {
    const key = entry.tabId === null ? 'null' : String(entry.tabId);
    let byTabEntry = byTab[key];
    if (!byTabEntry) {
      byTabEntry = [];
      byTab[key] = byTabEntry;
    }
    byTabEntry.push(entry.id);
  }
  const next = { watchers: alive, byTab };
  await saveWatchers(next);
  return next;
}

async function tabExists(tabId: number) {
  try { await chrome.tabs.get(tabId); return true; } catch (error) { log.debug('TAB_EXISTS_PROBE_FAILED', error instanceof Error ? error.message : String(error)); return false; }
}

export async function armWatchersForTab(tabId: number | undefined) {
  const w = await pruneWatchers();
  const entries = watcherIdsForTab(w, tabId)
    .map((id) => w.watchers.find((e) => e.id === id))
    .filter((e): e is WatchEntry => e !== undefined);
  const rules = entries.map((e) => e.rule);
  if (!rules.length) return { armed: 0 };
  try {
    const r = await executeInTab(tabId as number, 'watch.arm', { rules: rules.slice(0, WATCH_MAX_RULES_PER_ARM) });
    if (!r?.ok) return { armed: 0, error: typeof r?.error === 'object' && r?.error && 'code' in r.error ? String((r.error as { code?: string }).code) : 'ARM_FAILED' };
    return { armed: rules.length, facts: (r as { facts?: unknown }).facts || null };
  } catch (error) {
    return { armed: 0, error: String(error instanceof Error ? error.message : error).slice(0, 200) };
  }
}

export interface WatchFacts {
  url?: string | undefined;
  adState?: boolean | undefined;
  mediaTime?: unknown | undefined;
  context?: unknown | undefined;
  now?: number | undefined;
  state?: Record<string, { armedAt?: number | undefined; fireCount?: number | undefined; armed?: boolean | undefined; retired?: boolean | undefined; baselineUrl?: string | undefined; prevMediaTime?: number | undefined; priorPresent?: boolean | undefined; lastFireAt?: number | undefined; retiredReason?: string | undefined }> | undefined;
}

export interface WatchFire {
  ruleId: string;
  kind: string;
  atMs: number;
  fireCount: number;
  matched?: boolean | undefined;
}

// evaluateRules' inferred fired-item shape; WatchFire above is the older exported contract.

type EvaluateFire = ReturnType<typeof evaluateRules>['fired'][number];

export async function handleWatchFacts(tabId: number | undefined, facts: WatchFacts) {
  const w = await pruneWatchers();
  const entries = watcherIdsForTab(w, tabId)
    .map((id) => w.watchers.find((e) => e.id === id))
    .filter((e): e is WatchEntry => e !== undefined);
  if (!entries.length) return { fired: 0, state: {} };
  const rules = entries.map((e) => e.rule);
  const out = evaluateRules(rules, facts, facts.state || {}, facts.now || Date.now());

  for (const entry of entries) {
    const st = out.state[entry.rule.ruleId ?? ''];
    if (st) entry.runtime = st;
  }
  await saveWatchers(w);
  for (const fire of out.fired) {
    const entry = entries.find((e) => e.rule.ruleId === fire.ruleId);
    if (entry) handleWatchFire(entry, fire, facts).catch((error) => { log.warn('WATCH_FIRE_FAILED', error instanceof Error ? error.message : String(error)); });
  }

  return { fired: out.fired.length, state: out.state };
}

async function emitWatchEvent(entry: WatchEntry, fire: EvaluateFire, facts: WatchFacts, actionResult: unknown) {
  const cfg = await getConfig();
  if (!cfg.paired || !cfg.deviceToken) return;
  const envelope = {
    watcherId: entry.id,
    tabId: entry.tabId,
    rule: {
      ruleId: entry.rule.ruleId ?? '',
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
    await setState({ lastError: `watch_event delivery failed: ${String(error instanceof Error ? error.message : error).slice(0, 300)}` });
  }
}

export interface ActionContext {
  deadline: number;
  debuggerSession: { tabId: number | null; attached: boolean };
}

async function executeWatchAction(entry: WatchEntry, facts: WatchFacts): Promise<{ type: string | undefined; ok: boolean; error?: unknown; steps?: number | undefined; [key: string]: unknown }> {
  const action = entry.rule.action ?? { type: 'report' };
  void facts;
  try {
    if (action.type === 'report' || action.type === 'confirm') {
      return { type: action.type, ok: true };
    }
    if (action.type === 'click') {
      const tabId = entry.tabId as number;
      const sel = action.selector ?? (typeof entry.rule.trigger === 'object' && entry.rule.trigger ? entry.rule.trigger.selector : undefined);
      const q = await executeInTab(tabId, 'page.query', { selector: sel, index: 0, limit: 1 });
      const item = q && isRecord(q.item) ? q.item : null;
      const ref = q?.ok && item?.ref ? item.ref : null;
      if (!ref) return { type: 'click', ok: false, error: { code: 'TARGET_GONE', message: 'Matched element had no actionable ref.' } };
      const clickContext = { deadline: Date.now() + 15000, debuggerSession: { tabId, attached: false } };

      try {
        const result: unknown = action.trusted === true
          ? await runActionPipeline(tabId, 'page.click', { ref }, clickContext, (ref2) => trustedClick(tabId, ref2, clickContext, 'background', {}))
          : await dispatch('page.click', { tabId, ref, trusted: false }, clickContext);
        return { type: 'click', ok: isRecord(result) && !!result.ok, error: isRecord(result) ? result.error || null : null };
      } finally {
        await releaseDebuggerSession(clickContext.debuggerSession, log);
      }
    }
    if (action.type === 'burst') {
      const res = await runBurst({ tabId: entry.tabId, steps: action.steps }, { deadline: Date.now() + 15000 });
      return { type: 'burst', ok: !!res?.ok, steps: res?.completedSteps, error: res?.error || null };
    }
    if (action.type === 'workflow') {

      const cfg = await getConfig();
      if (!cfg.paired || !cfg.deviceToken) {
        return { type: 'workflow', ok: false, error: { code: 'NOT_PAIRED', message: 'Device is not paired.' } };
      }
      const res = await fetchJson(cfg.bridgeUrl, {
        action: 'start_workflow',
        token: cfg.deviceToken,
        deviceId: cfg.deviceId,
        name: action.workflowName,
        params: 'params' in action ? action.params || {} : {}
      }, 8000);
      return { type: 'workflow', ok: !!res?.ok, runId: res?.runId || null, error: res?.error || null };
    }
    return { type: action.type, ok: false, error: 'UNSUPPORTED_ACTION' };
  } catch (error) {
    const message = isRecord(error) && typeof error.message === 'string' && error.message ? error.message : String(error);
    return { type: action.type, ok: false, error: { code: 'WATCH_ACTION_FAILED', message: message.slice(0, 300) } };
  }
}

async function handleWatchFire(entry: WatchEntry, fire: EvaluateFire, facts: WatchFacts) {
  const actionResult = await executeWatchAction(entry, facts);
  await emitWatchEvent(entry, fire, facts, actionResult);
  return actionResult;
}

export function commandTimeoutError() {
  return codedError('COMMAND_TIMEOUT', 'Command timed out: the browser action may have taken effect. Verify page state before repeating it.');
}

export async function trustedHover(tabId: number, params: { ref?: unknown; timeoutMs?: unknown; text?: unknown; executionMode?: unknown }, context: CaptureContext) {
  const mode = executionMode(params);
  const info = await contentCall(tabId, 'page.click_info', { ref: params.ref });
  const rect = info && isRecord(info.rect) ? info.rect : undefined;
  const rawX = rect?.centerX;
  const rawY = rect?.centerY;
  const x = typeof rawX === 'number' ? rawX : Number.NaN;
  const y = typeof rawY === 'number' ? rawY : Number.NaN;
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
