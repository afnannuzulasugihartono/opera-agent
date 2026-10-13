// @last-edited: 2026-10-10 UTC+7.
// @title: background — the thin MV3 entry: dispatch's own state and dispatch.
// @state: holds two constants dispatch reads, the role-reconcile bridge, and the one load-time listener; every other region of the original 2646-line file moved to worker/ and lib/.
// @dependencies: protocol, watch, loop, role-reconcile, log, popup-events,
// debugger-session, serialize, utils, capture, tab-content, listen, capture-page,
// action-focus, burst, loop-engine, watch-registry, execute-pull.

import {
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  METHOD_SPECS,
  safeUrl,
  clamp
} from './lib/protocol.js';
import { validateRule } from './lib/watch.js';
import {
  startLoopState,
  validateLoopProgram
} from './lib/loop.js';

import './role-reconcile.js';
const { axRoleIndex, reconcileElements, hasRoleGap } = globalThis.OperaAgentRoleReconcile || {};

import { log } from './lib/log.js';
import { popupsSince } from './lib/popup-events.js';
import {
  registerDebuggerSession,
  handleDebuggerDetach
} from './lib/debugger-session.js';
import { oversized, MAX_RESULT_BYTES } from './lib/serialize.js';
import { mutateTabs, nowIso, randomToken, getConfig } from './worker/utils.js';
import { codedError, collectAxSummary } from './worker/capture.js';
import { publicTab, requireTabId, resolveTabId, waitTabReady, contentCall } from './worker/tab-content.js';
import { listenStart, listenStop } from './worker/listen.js';
import { capturePage } from './worker/capture-page.js';
import {
  executionMode,
  sampleTabFocus,
  withActionPopupTracking,
  runActionPipeline,
  trustedClick,
  trustedFill,
  trustedPointer,
  trustedKey,
  trustedKeyStream,
  popupLog,
} from './worker/action-focus.js';
import { runBurst } from './worker/burst.js';
import {
  loopSummary,
  finishLoop,
  loopSessionOnTab,
  stateSummary,
  finishStateLoop,
  loopDecodeTemplate,
  loopTickLater,
  LOOP_MAX_ACTIVE,
  loopSessions,
  loopResults,
  STATE_READERS,
  stateSessions,
  stateResults,
} from './worker/loop-engine.js';
import {
  watchRuleId,
  saveWatchers,
  watcherIdsForTab,
  pruneWatchers,
  armWatchersForTab,
  trustedHover,
  MAX_WATCHERS_PER_TAB,
  MAX_WATCHERS_GLOBAL,
} from './worker/watch-registry.js';
import './worker/execute-pull.js';
import { bridgeLinkState, ensureBridgeLink } from './worker/bridge-link.js';

chrome.debugger.onDetach.addListener(handleDebuggerDetach);

const SEMANTIC_RUNTIME_EPOCH = crypto.randomUUID();

const AX_SUMMARY_TEXT_POVERTY_CHARS = 400;

export async function dispatch(method, params = {}, context = {}) {
  ensureBridgeLink();
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
        bridge: bridgeLinkState(),
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

      const r9SemanticGap = hasRoleGap(result?.page?.elements);
      const shouldCollectAx = result?.ok !== false && result?.page
        && (Number(result.page.totalTextChars) <= AX_SUMMARY_TEXT_POVERTY_CHARS || r9SemanticGap);
      if (shouldCollectAx) {
        const summary = await collectAxSummary(tabId, context);
        if (summary) {
          result.page.axSummary = summary;

          const index = axRoleIndex?.(summary.items);
          if (index && index.size > 0 && Array.isArray(result.page.elements)) {
            result.page.elements = reconcileElements?.(result.page.elements, index) || result.page.elements;
          }
        }
      }

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
    case 'page.stream': {
      const tabId = await resolveTabId(params);
      const result = await runActionPipeline(tabId, 'page.stream', params, context, () => trustedKeyStream(tabId, params, context, executionMode(params)));
      return { ...result, tabId };
    }
    default:
      throw new Error('Method is not implemented by this extension build.');
  }
}
