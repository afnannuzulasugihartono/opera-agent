// @last-edited: 2026-10-13 UTC+7.
// @title: background — the thin MV3 entry: dispatch's own state and dispatch.
// @state: holds two constants dispatch reads, the role-reconcile bridge, and the one load-time listener; every other region of the original 2646-line file moved to worker/ and lib/.
// @dependencies: protocol, watch, role-reconcile, log, popup-events, debugger-session, serialize, utils, capture, tab-content, listen, capture-page, action-focus, burst, watch-registry, execute-pull.

import {
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  METHOD_SPECS,
  safeUrl,
  clamp
} from './lib/protocol.js';
import { validateRule, type WatchRule, type WatchTrigger } from './lib/watch.js';
import { isRecord } from './lib/guards.js';

import './role-reconcile.js';
const { axRoleIndex, reconcileElements, hasRoleGap } = globalThis.OperaAgentRoleReconcile ?? { axRoleIndex: undefined, reconcileElements: undefined, hasRoleGap: undefined };

import { log } from './lib/log.js';
import { popupsSince } from './lib/popup-events.js';
import { windowUpdateFor, windowUpdateCase } from './lib/window-restore.js';
import { handleDebuggerDetach } from './lib/debugger-session.js';
import { oversized, fitWithinBudget, RESULT_BUDGET_BYTES } from './lib/serialize.js';
import { mutateTabs, nowIso, getConfig } from './worker/utils.js';
import { collectAxSummary, type CaptureContext } from './worker/capture.js';
import { publicTab, requireTabId, resolveTabId, waitTabReady, contentCall } from './worker/tab-content.js';
import { listenStart, listenStop } from './worker/listen.js';
import { capturePage } from './worker/capture-page.js';
import { recordStart, recordStop } from './worker/record-session.js';
import { scanPage } from './worker/scan-page.js';
import { dumpPage } from './worker/dump-page.js';
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
import { statementDownload, statementManifest } from './worker/statement.js';
import { applyNewestBuild } from './worker/self-update.js';
import { captureWorkerErrors } from './lib/error-capture.js';

captureWorkerErrors({ target: typeof self === 'undefined' ? null : self, log });

chrome.debugger.onDetach.addListener(handleDebuggerDetach);

const SEMANTIC_RUNTIME_EPOCH = crypto.randomUUID();

const AX_SUMMARY_TEXT_POVERTY_CHARS = 400;

// WHY EVERY FIELD IS UNKNOWN: the bridge speaks JSON the boundary cannot vouch for; each reader narrows before it reads.
// The optional-chain readers (params?.foo) stay valid for a missing key, and the index signature keeps a plain Record<string, unknown> assignable.

interface DispatchParams {
  action?: unknown;
  active?: unknown;
  bypassCache?: unknown;
  currentWindow?: unknown;
  expect?: unknown;
  executionMode?: unknown;
  focusWindow?: unknown;
  index?: unknown;
  limit?: unknown;
  ref?: unknown;
  retry?: unknown;
  rule?: unknown;
  tabId?: unknown;
  titleContains?: unknown;
  trusted?: unknown;
  url?: unknown;
  urlContains?: unknown;
  value?: unknown;
  wait?: unknown;
  waitTimeoutMs?: unknown;
  watcherId?: unknown;
  [key: string]: unknown;
}

// WHY A HELPER: waitTabReady takes a plain number and already owns the default and the clamp; undefined means "the default", exactly what passing the parameter through would have done.

const waitTimeoutMsOf = (value: unknown): number | undefined => (value == null ? undefined : Number(value));

export async function dispatch(method: string, params: DispatchParams = {}, context: CaptureContext = {}) {
  ensureBridgeLink();
  switch (method) {
    case 'browser.ping': {
      const cfg = await getConfig();
      const faults = log.errors();
      const fitted = fitWithinBudget(faults, RESULT_BUDGET_BYTES - 16 * 1024);
      return {
        ok: true,
        product: 'Opera Agent',
        version: PRODUCT_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        deviceName: cfg.deviceName,
        paired: cfg.paired,
        bridge: bridgeLinkState(),
        capabilities: Object.keys(METHOD_SPECS),
        errors: fitted.elements,
        errorCount: log.errorCount(),
        ...(fitted.truncated ? { errorsTruncated: true, omittedErrors: faults.length - fitted.elements.length } : {}),
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
      // WHY THE ASSERTION: the rule is JSON the bridge cannot vouch for; validateRule is the runtime gate that proves the shape (it throws otherwise), so the type only has to be honest about the boundary, not pre-approve it.
      const rawRule = isRecord(params.rule) ? params.rule : undefined;
      const candidate = { ...rawRule, ruleId: rawRule?.ruleId || watchRuleId('w') } as WatchRule & { trigger?: WatchTrigger };
      const v = validateRule(candidate);
      if (!v.ok) throw new Error('reason' in v && typeof v.reason === 'string' ? v.reason : 'The watch rule is invalid.');

      if (candidate.deadlineMs == null) candidate.deadlineMs = 60000;
      const entry = { id: String(candidate.ruleId), tabId, rule: candidate, createdAt: Date.now(), runtime: {} };
      w.watchers.push(entry);
      let byTabEntry = w.byTab[tabId];
      if (!byTabEntry) { byTabEntry = []; w.byTab[tabId] = byTabEntry; }
      byTabEntry.push(entry.id);
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
        const i = typeof watcherId === 'string' ? ids.indexOf(watcherId) : -1; if (i >= 0) ids.splice(i, 1);
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
      const index = typeof params.index === 'number' && Number.isInteger(params.index) ? params.index : 0;
      return { ok: true, count: matches.length, tab: matches[index] || null, tabs: matches.slice(0, clamp(params.limit, 1, 100, 20)) };
    }
    case 'tabs.open': {
      const url = safeUrl(params.url || 'https://www.google.com/');
      if (!url) throw new Error('Only http/https URLs are allowed.');
      const tab = await mutateTabs(() => chrome.tabs.create({ url, active: params.active !== false }));
      const ready = params.wait === false ? publicTab(tab) : await waitTabReady(requireTabId(tab.id), waitTimeoutMsOf(params.waitTimeoutMs));
      return { ok: true, tab: ready };
    }
    case 'tabs.activate': {
      const tabId = requireTabId(params.tabId);
      let tab = await chrome.tabs.get(tabId);
      let reused = !!tab.active;
      if (!tab.active) {
        const updated = await mutateTabs(() => chrome.tabs.update(tabId, { active: true }));
        if (!updated) throw new Error('The tab disappeared while it was being activated.');
        tab = updated;
        reused = false;
      }
      let windowUpdate: string | null = null;
      if (params.focusWindow !== false) {
        const window = await chrome.windows.get(tab.windowId);
        const update = windowUpdateFor(window, { focus: params.focusWindow !== false });

        // WHY A MINIMIZED WINDOW IS RESTORED AND NOT ONLY FOCUSED.
        // Measured live on this machine: chrome.windows.update with focused:true alone leaves a window on the taskbar minimized, and chrome.debugger serves no Browser domain on a bridge session, so nothing else in the tree can bring it back.
        // A drive that typed after that went nowhere, which is the one failure the focus gate refuses rather than guessing about.
        // state:'normal' is the only call that takes a window off the taskbar, so the rule is one pure decision and the window is read again to say what actually happened.
        if (update) {
          // WHY THE NARROWING: windowUpdateFor widens 'normal' to string; only the literal member survives an UpdateInfo, and the value IS that literal.
          const { focused, state } = update;
          await chrome.windows.update(tab.windowId, state === 'normal' ? { focused, state } : { focused });
          reused = false;
        }
        windowUpdate = windowUpdateCase(update);
      }
      return { ok: true, tab: publicTab(tab), reused, windowUpdate };
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
        const ready = params.wait === false ? publicTab(current) : await waitTabReady(tabId, waitTimeoutMsOf(params.waitTimeoutMs));
        return { ok: true, tab: ready, reused: true };
      }
      const tab = await mutateTabs(() => chrome.tabs.update(tabId, { url }));
      if (!tab) throw new Error('The tab disappeared while it was being navigated.');
      const ready = params.wait === false ? publicTab(tab) : await waitTabReady(tabId, waitTimeoutMsOf(params.waitTimeoutMs));
      return { ok: true, tab: ready, reused: false };
    }
    case 'tabs.reload': {
      const tabId = await resolveTabId(params);
      await chrome.tabs.reload(tabId, { bypassCache: !!params.bypassCache });
      const ready = params.wait === false ? publicTab(await chrome.tabs.get(tabId)) : await waitTabReady(tabId, waitTimeoutMsOf(params.waitTimeoutMs));
      return { ok: true, tab: ready };
    }
    case 'page.read': {
      const tabId = await resolveTabId(params);
      let result = await contentCall(tabId, method, { ...params, __semanticRuntimeEpoch: SEMANTIC_RUNTIME_EPOCH });

      if (result?.page && oversized(result)) {
        // WHY THE LOCAL: the page payload is a boundary object from the content bridge; isRecord narrows it once instead of asserting it.
        const page = isRecord(result.page) ? result.page : {};
        const isMapPull = (typeof page.class === 'string' || page.all === true) && Array.isArray(page.elements);
        if (isMapPull) {
          const pulled = Array.isArray(page.elements) ? page.elements : [];
          const fitted = fitWithinBudget(pulled, RESULT_BUDGET_BYTES);
          const total = Number(page.total ?? page.totalElements ?? pulled.length);
          result = {
            ...result,
            page: {
              ...page,
              elements: fitted.elements,
              truncated: true,
              truncationReason: `Element list trimmed: the result exceeded the ${RESULT_BUDGET_BYTES}-byte budget. Re-read with a smaller limit.`,
              omittedElementCount: pulled.length - fitted.elements.length,
              nextOffset: Number(page.offset || 0) + fitted.elements.length,
              hasMore: fitted.elements.length < total
            }
          };
        } else {
          const { elements, ...withoutElements } = page;
          result = {
            ...result,
            page: {
              ...withoutElements,
              truncated: true,
              truncationReason: `Element list omitted: the result exceeded the ${RESULT_BUDGET_BYTES}-byte budget. Re-read with a narrower offset, a smaller maxElements, or includeElements disabled.`,
              omittedElementCount: Array.isArray(elements) ? elements.length : 0
            }
          };
        }
      }
      const zoomPage = isRecord(result?.page) ? result.page : undefined;
      if (zoomPage?.viewport) {
        try { if (isRecord(zoomPage.viewport)) { zoomPage.viewport.zoomFactor = await chrome.tabs.getZoom(tabId); } } catch (error) { log.error('TAB_ZOOM_PROBE_FAILED', error instanceof Error ? error.message : String(error)); }
      }

      const axPage = isRecord(result?.page) ? result.page : undefined;
      const isMapPull = typeof axPage?.class === 'string';
      const r9SemanticGap = !isMapPull && hasRoleGap?.(axPage?.elements);
      const shouldCollectAx = !isMapPull && result?.ok !== false && axPage
        && (Number(axPage.totalTextChars) <= AX_SUMMARY_TEXT_POVERTY_CHARS || r9SemanticGap);
      if (shouldCollectAx && axPage) {
        const summary = await collectAxSummary(tabId, context);
        if (summary) {
          axPage.axSummary = summary;

          const index = axRoleIndex?.(summary.items);
          if (isRecord(index) && typeof index.size === 'number' && index.size > 0 && Array.isArray(axPage.elements)) {
            axPage.elements = reconcileElements?.(axPage.elements, index) || axPage.elements;
          }
        }
      }

      const userStatePage = isRecord(result?.page) ? result.page : undefined;
      if (userStatePage) {
        try {
          const { tabActive, windowFocused } = await sampleTabFocus(tabId);
          const userInput = isRecord(userStatePage.userInput) ? userStatePage.userInput : undefined;
          userStatePage.userState = {
            tabActive,
            windowFocused,
            watching: tabActive === true && windowFocused === true,
            lastInputMs: userInput?.lastInputMs ?? null
          };
        } catch (error) {
          log.error('USER_STATE_PROBE_FAILED', error instanceof Error ? error.message : String(error));
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
      const retry = isRecord(params.retry) ? params.retry : undefined;
      const fillOptions = { expect: params.expect, attempts: retry?.attempts };
      const actionStart = Date.now();
      const result = await withActionPopupTracking(tabId, () => runActionPipeline(tabId, 'page.fill', params, context, (ref: string | undefined) => (params.trusted ? trustedFill(tabId, ref, params.value, context, executionMode(params), fillOptions) : contentCall(tabId, 'page.fill', { ...params, ref }))));
      const openedTabs = popupsSince(popupLog, tabId, actionStart);
      return { ...result, tabId, ...(openedTabs.length ? { openedTabs } : {}) };
    }
    case 'page.click': {
      const tabId = await resolveTabId(params);
      const retry = isRecord(params.retry) ? params.retry : undefined;
      const clickOptions = { expect: params.expect, attempts: retry?.attempts };
      const actionStart = Date.now();
      const result = await withActionPopupTracking(tabId, () => runActionPipeline(tabId, 'page.click', params, context, (ref: string | undefined) => (params.trusted ? trustedClick(tabId, ref, context, executionMode(params), clickOptions) : contentCall(tabId, 'page.click', { ...params, ref }))));
      const openedTabs = popupsSince(popupLog, tabId, actionStart);
      return { ...result, tabId, ...(openedTabs.length ? { openedTabs } : {}) };
    }
    case 'page.pointer': {
      const tabId = await resolveTabId(params);
      if (String(params.action || '') === 'hover' && (typeof params.ref !== 'string' || !params.ref)) {
        throw new Error('Pointer hover requires a ref target.');
      }
      const runPointer = String(params.action || '') === 'hover' ? trustedHover : trustedPointer;
      const result = await runActionPipeline(tabId, 'page.pointer', params, context, () => runPointer(tabId, params, context));
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
    case 'page.record_start': {
      const tabId = await resolveTabId(params);
      return recordStart(tabId, params, context);
    }
    case 'page.record_stop': {
      const tabId = await resolveTabId(params);
      return recordStop(tabId, params, context);
    }
    case 'page.scan': {
      const tabId = await resolveTabId(params);
      return scanPage(tabId, params, context);
    }
    case 'page.dump': {
      const tabId = await resolveTabId(params);
      return dumpPage(tabId, params, context);
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
    case 'statement.download': {
      const tabId = await resolveTabId(params);
      return { ...(await statementDownload({ ...params, tabId })), tabId };
    }
    case 'statement.manifest':
      return statementManifest();
    case 'extension.update':
      return applyNewestBuild();
    default:
      throw new Error('Method is not implemented by this extension build.');
  }
}
