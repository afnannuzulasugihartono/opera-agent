// @last-edited: 2026-10-09 UTC+7.
// @title: execute-pull — command execution, pairing and the device pull loop.
// @state: owns WAKE_ALARM, loopPromise and loopGeneration; every statement here that runs at load time is listed in tests/background-load.test.mjs.
// @dependencies: utils, tab-content, private-tabs, listen, action-focus, watch-registry, loop-engine, capture, serialize, background, log, protocol, options-store, model-client, external-origins, deadline-race.

import { log } from '../lib/log.js';
import {
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  METHOD_SPECS,
  validateCommand,
  normalizeError,
} from '../lib/protocol.js';
import { readModelConfig, saveModelEndpoint, saveModelKey, saveModelName } from '../lib/options-store.js';
import { buildProbeRequest, endpointOk, MODEL_TIMEOUT_MS } from '../lib/model-client.js';
import { originAllowed } from '../lib/external-origins.js';
import { raceWithTimeout } from '../lib/deadline-race.js';
import { sleep, nowIso, randomToken, getConfig, setState, connectionState } from './utils.js';
import { fetchJson, publicTab, requireTabId, contentCall, HTTP_URL_RE } from './tab-content.js';
import { privateTabIds, isPrivateTab, setPrivateTab, PRIVATE_TABS_KEY } from './private-tabs.js';
import { readListenSession, listenStop, postListenChunk } from './listen.js';
import { notReadyError } from './action-focus.js';
import { handleStateEvent } from './loop-engine.js';
import { loadWatchers, armWatchersForTab, handleWatchFacts, commandTimeoutError } from './watch-registry.js';
import { screenshotCache } from './capture.js';
import { clearSerializedResult, boundedResult } from '../lib/serialize.js';
import { dispatch } from '../background.js';

const WAKE_ALARM = 'opera-agent-wake';
let loopPromise = null;
let loopGeneration = 0;

async function runDispatch(dispatch, timeoutMs) {
  try {
    const result = await raceWithTimeout(dispatch, timeoutMs, commandTimeoutError);
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

async function executeCommand(raw) {

  clearSerializedResult();

  if (raw && typeof raw.method === 'string' && (raw.method.startsWith('watch.') || raw.method.startsWith('loop.'))) {
    const deadlineW = Date.now() + 10000;
    return runDispatch(() => dispatch(raw.method, raw.params || {}, { deadline: deadlineW }), 10000);
  }
  const validated = validateCommand(raw);
  if (!validated.ok) return { ok: false, error: { code: 'INVALID_COMMAND', message: validated.error } };
  const { command } = validated;
  const deadline = Date.now() + command.timeoutMs;
  return runDispatch(() => dispatch(command.method, command.params, { deadline }), Math.max(1, deadline - Date.now()));
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

  heartbeat().finally(ensurePullLoop).catch((error) => { log.warn('HEARTBEAT_FAILED', error?.message || String(error)); });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.paired || changes.deviceToken || changes.bridgeUrl || changes.deviceName || changes.logLevel) {
    restartPullLoop();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {

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

    if (existing?.tabId === tabId) listenStop().catch(() => {});
  }).catch(() => {});
  privateTabIds().then((ids) => {
    if (!ids.delete(tabId)) return;
    return chrome.storage.local.set({ [PRIVATE_TABS_KEY]: [...ids] });
  }).catch((error) => { log.debug('PRIVATE_TAB_CLEANUP_FAILED', error?.message || String(error)); });
});

chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 }).catch((error) => { log.warn('WAKE_ALARM_CREATE_FAILED', error?.message || String(error)); });
ensurePullLoop();
