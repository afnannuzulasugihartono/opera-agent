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
import { popupsSince } from './lib/popup-events.js';
import { raceWithTimeout } from './lib/deadline-race.js';
import {
  registerDebuggerSession,
  releaseDebuggerSession,
  handleDebuggerDetach
} from './lib/debugger-session.js';
import { oversized, MAX_RESULT_BYTES, clearSerializedResult, boundedResult } from './lib/serialize.js';
import { sleep, mutateTabs, nowIso, randomToken, getConfig, setState, connectionState } from './worker/utils.js';
import { withDebugger, codedError, collectAxSummary, screenshotCache } from './worker/capture.js';
import { privateTabIds, isPrivateTab, setPrivateTab, PRIVATE_TABS_KEY } from './worker/private-tabs.js';
import { fetchJson, publicTab, requireTabId, resolveTabId, waitTabReady, contentCall, executeInTab, HTTP_URL_RE } from './worker/tab-content.js';
import { readListenSession, listenStart, listenStop, postListenChunk } from './worker/listen.js';
import { capturePage } from './worker/capture-page.js';
import {
  executionMode,
  withInputFocusEmulation,
  sampleTabFocus,
  withForegroundFocusGate,
  withActionPopupTracking,
  notReadyError,
  runActionPipeline,
  trustedClick,
  trustedFill,
  trustedPointer,
  trustedKey,
  burstStepParams,
  popupLog,
} from './worker/action-focus.js';
import { runBurst } from './worker/burst.js';
import {
  loopSummary,
  finishLoop,
  loopSessionOnTab,
  stateSummary,
  finishStateLoop,
  handleStateEvent,
  loopDecodeTemplate,
  loopTickLater,
  LOOP_MAX_ACTIVE,
  loopSessions,
  loopResults,
  STATE_READERS,
  stateSessions,
  stateResults,
} from './worker/loop-engine.js';

// Without this, a cached `attached: true` outlives the debugger: if the user
// opens DevTools on a tab we are attached to, or the tab closes, Chrome ends
// the session and every later CDP call in it fails against a dead debugger.

chrome.debugger.onDetach.addListener(handleDebuggerDetach);

const WAKE_ALARM = 'opera-agent-wake';
const SEMANTIC_RUNTIME_EPOCH = crypto.randomUUID();

// Canvas-class pages expose almost no DOM text while their
// accessibility tree still carries state. A read this text-poor attaches a
// bounded read-only axSummary; rich pages keep the unchanged fast path.

const AX_SUMMARY_TEXT_POVERTY_CHARS = 400;

let loopPromise = null;
let loopGeneration = 0;


export async function dispatch(method, params = {}, context = {}) {
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
