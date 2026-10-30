// @last-edited: 2026-10-13 UTC+7.
// @title: execute-pull — command execution, pairing and the device socket.
// @state: owns WAKE_ALARM and socketClient; every statement here that runs at load time is listed in tests/background-load.test.mjs.
// @dependencies: utils, tab-content, private-tabs, listen, action-focus, watch-registry, capture, serialize, background, log, protocol, options-store, model-client, external-origins, deadline-race, socket-client, socket-protocol.

import { log } from '../lib/log.js';
import { socketUrl } from '../lib/endpoints.js';
import {
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  METHOD_SPECS,
  validateCommand,
  normalizeError,
} from '../lib/protocol.js';
import {
  readModelConfig,
  saveModelEndpoint,
  saveModelKey,
  saveModelName
} from '../lib/options-store.js';
import {
  buildProbeRequest,
  endpointOk,
  MODEL_TIMEOUT_MS
} from '../lib/model-client.js';
import { originAllowed } from '../lib/external-origins.js';
import { raceWithTimeout } from '../lib/deadline-race.js';
import {
  nowIso,
  randomToken,
  getConfig,
  setState,
  connectionState
} from './utils.js';
import {
  fetchJson,
  publicTab,
  requireTabId,
  contentCall,
  HTTP_URL_RE
} from './tab-content.js';
import {
  privateTabIds,
  isPrivateTab,
  setPrivateTab,
  PRIVATE_TABS_KEY
} from './private-tabs.js';
import {
  readListenSession,
  listenStop,
  postListenChunk
} from './listen.js';
import { notReadyError } from './action-focus.js';
import {
  createSocketClient,
  connectionPatch
} from '../lib/socket-client.js';
import { completionFrame } from '../lib/socket-protocol.js';
import {
  loadWatchers,
  armWatchersForTab,
  handleWatchFacts,
  commandTimeoutError
} from './watch-registry.js';
import { screenshotCache } from './capture.js';
import {
  clearSerializedResult,
  boundedResult
} from '../lib/serialize.js';
import { dispatch } from '../background.js';

const WAKE_ALARM = 'opera-agent-wake';
let socketClient = null;

async function runDispatch(
  dispatch,
  timeoutMs
) {
  try {
    const result = await raceWithTimeout(dispatch, timeoutMs, commandTimeoutError);
    return {
      ok: true,
      result: boundedResult(result)
    };
  } catch (error) {
    if (error && error.code === 'TARGET_NOT_READY') {
      return {
        ok: false,
        error: notReadyError(error)
      };
    }
    if (error && error.code === 'COMMAND_TIMEOUT') {
      return {
        ok: false,
        error: {
          code: 'COMMAND_TIMEOUT',
          outcome: 'unknown',
          message: error.message
        }
      };
    }
    return {
      ok: false,
      error: normalizeError(error)
    };
  }
}

let emitChain = Promise.resolve();

function emitCommandEvent(
  cfg,
  commandId,
  kind,
  envelope
) {
  if (!cfg?.bridgeUrl || !commandId) return;
  const body = {
    action: 'command_event',
    deviceName: cfg.deviceName,
    token: cfg.deviceToken,
    commandId,
    kind,
    envelope
  };
  emitChain = emitChain.then(() => fetchJson(cfg.bridgeUrl, body, 5000)).catch(() => {});
}

// WHY THE CONTROL BUDGETS DIFFER.
// watch.* and loop.* only schedule registry work and answer at once, so ten seconds is generous.
// task.run waits on the one device-local model call, whose own ceiling is MODEL_TIMEOUT_MS, so it gets that budget minus a second and still answers before the caller's await gives up.

/**
 * The dispatch budget a control method gets, in milliseconds.
 * @param {{ method?: unknown }} raw The pulled command.
 * @returns {number} The budget, or 0 when the method is an allowlisted primitive that takes the normal path.
 */

function controlMethodBudget(raw) {
  if (!raw || typeof raw.method !== 'string') return 0;
  if (raw.method === 'task.run') return MODEL_TIMEOUT_MS - 1000;
  if (raw.method.startsWith('watch.') || raw.method.startsWith('loop.')) return 10000;
  return 0;
}

async function executeCommand(
  raw,
  cfg
) {
  clearSerializedResult();

  const onStep = cfg
    ? (info) => emitCommandEvent(cfg, raw?.id, 'step', {
      method: raw?.method,
      ...info
    })
    : null;

  // WHY task.run AND watch./loop.
  // SKIP THE PRIMITIVE ALLOWLIST.
  // They are control methods, not browser primitives: each one compiles or schedules work that is itself gated before it touches a page, so the 31-method allowlist would only refuse the door.
  // task.run gets the model budget, because its one device-local model call is what it waits on.

  const controlBudget = controlMethodBudget(raw);
  if (controlBudget) {
    const deadlineC = Date.now() + controlBudget;
    return runDispatch(() => dispatch(raw.method, raw.params || {}, {
      deadline: deadlineC,
      onStep
    }), controlBudget);
  }
  const validated = validateCommand(raw);
  if (!validated.ok) return {
    ok: false,
    error: {
      code: 'INVALID_COMMAND',
      message: validated.error
    }
  };
  const { command } = validated;
  const deadline = Date.now() + command.timeoutMs;
  return runDispatch(() => dispatch(command.method, command.params, {
    deadline,
    onStep
  }), Math.max(1, deadline - Date.now()));
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
  await setState({
    status: 'connecting',
    lastError: null,
    retryMs: 250
  });
  restartSocket();
  return data;
}

async function unpair() {
  await listenStop().catch(() => {});
  await chrome.storage.local.remove([
    'paired',
    'deviceToken',
    'deviceId'
  ]);
  try {
    socketClient?.stop();
  } catch {}
  socketClient = null;
  await setState({
    status: 'unpaired',
    lastError: null
  });
  return { ok: true };
}

function completionPayload(
  commandId,
  execution
) {
  return {
    commandId,
    ok: execution.ok,
    result: execution.ok ? execution.result : null,
    error: execution.ok ? null : execution.error,
    createdAt: nowIso()
  };
}

async function flushPendingCompletion(cfg) {
  const { pendingCompletion } = await chrome.storage.local.get('pendingCompletion');
  if (!pendingCompletion?.commandId) return;
  const createdAt = Date.parse(String(pendingCompletion.createdAt || ''));
  if (Number.isFinite(createdAt) && Date.now() - createdAt > 5 * 60 * 1000) {
    await chrome.storage.local.remove('pendingCompletion');
    return;
  }

  const sent = socketClient?.send(completionFrame(
    pendingCompletion.commandId,
    pendingCompletion.ok,
    pendingCompletion.result,
    pendingCompletion.error
  ));
  if (sent) await chrome.storage.local.remove('pendingCompletion');
}

// WHY the poll loop is gone.
// It asked the bridge whether work existed, then asked again to report the result, and every action paid two round trips plus a blocking wait inside each.
// Measured here, a six step burst spent 238 ms in the browser and 496 ms in transport.
// One socket carries work down and completions back up, so nothing on the hot path asks a question.

// WHY there is no poll underneath to fall back to.
// A quiet fallback would restore exactly the latency this replaces while looking perfectly healthy, which is worse than an outage because it is invisible.

// WHY a stored completion is only cleared once the frame is written.
// A disconnect between finishing a command and reporting it would otherwise lose the result silently, and the caller would wait out its timeout for a device that had already finished.
// Reconnecting is also the moment that owed completion is resent.

// WHY there is one way to start, and no generation counter.
// The old loop was generation guarded so a restart could not fight an in-flight poll, and that guard lost a wake-up: bumping the generation made the in-flight loop exit without connecting and made its own reschedule refuse, so after a pairing nothing ever started.
// A socket that owns its own reconnect needs no guard, only one true shape: no client, then start one.

async function ensureSocket() {
  if (socketClient) return;
  const cfg = await getConfig();
  if (socketClient) return;
  if (!cfg.paired || !cfg.deviceToken) return;

  const url = socketUrl(cfg.bridgeUrl);
  if (!url) {
    await setState({
      status: 'unreachable',
      lastError: 'No bridge url configured.'
    });
    return;
  }

  socketClient = createSocketClient({
    url,
    token: cfg.deviceToken,
    deviceName: cfg.deviceName,
    execute: async (command) => {
      emitCommandEvent(cfg, command.id, 'received', { method: command.method });
      const execution = await executeCommand(command, cfg);
      emitCommandEvent(cfg, command.id, 'done', { ok: execution?.ok !== false });
      const pending = completionPayload(command.id, execution);
      await chrome.storage.local.set({ pendingCompletion: pending });
      return execution;
    },
    onState: (state) => {
      if (state.status === 'error') {
        log.warn('SOCKET_ERROR_FRAME', state.message);
      }
      setState(connectionPatch(state, nowIso())).catch(() => {});
      if (state.status === 'connected') {
        flushPendingCompletion(cfg).catch(() => {});
      }
    }
  });

  socketClient.start();
}

function restartSocket() {
  try {
    socketClient?.stop();
  } catch {}
  socketClient = null;
  ensureSocket().catch((error) => {
    log.debug('SOCKET_START_FAILED', String(error?.message || error));
  });
}

// WHY the heartbeat no longer reports a connection status.
// It used to, back when it was the poll loop's status writer as well as its keepalive, and it went on doing that job after the socket took ownership of it: every thirty seconds it stamped lastConnectedAt over the socket's own state, and a heartbeat that failed set the status to reconnecting while the socket was healthy and connected.
// Observed live against the deployed bridge.
// The heartbeat's job is to keep the device row's last_seen_at fresh, and that is all it does now.

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
  } catch (error) {
    log.debug('HEARTBEAT_FAILED', String(error?.message || error));
  }
}

async function localSelfTest() {
  const tabs = await chrome.tabs.query({});
  const active = (await chrome.tabs.query({
    active: true,
    currentWindow: true
  }))[0] || null;
  let page = null;
  if (active?.id && HTTP_URL_RE.test(active.url || '')) {
    try {
      page = await contentCall(active.id, 'page.read', {
        limit: 600,
        maxElements: 10
      });
    } catch (error) {
      page = {
        ok: false,
        error: String(error?.message || error)
      };
    }
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

chrome.runtime.onMessageExternal?.addListener((
  message,
  sender,
  sendResponse
) => {
  if (!message || message.type !== 'applyModelConfig') return false;
  const from = String(sender?.origin || sender?.url || '');
  if (!originAllowed(from)) {
    sendResponse({
      ok: false,
      message: 'That page may not configure this extension.'
    });
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
    .catch((error) => sendResponse({
      ok: false,
      message: String(error?.message || error).slice(0, 200)
    }));
  return true;
});

chrome.runtime.onMessage.addListener((
  message,
  sender,
  sendResponse
) => {
  if (message && message.scope === 'opera-agent-listen-chunk') {
    const tabId = sender?.tab?.id;
    Promise.resolve(postListenChunk(tabId, message.seq, message.audio, message.mime))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: String(error?.message || error).slice(0, 200)
      }));
    return true;
  }
  if (message && message.scope === 'opera-agent-watch' && message.method === 'watch.facts') {
    const tabId = sender?.tab?.id;
      if (tabId == null) {
        sendResponse({
          ok: false,
          error: 'No sender tab.'
        }); return true;
      }
      Promise.resolve(handleWatchFacts(tabId, message.params || {}))
        .then((r) => sendResponse({
          ok: true,
          ...r
        }))
        .catch((error) => sendResponse({
          ok: false,
          error: String(error?.message || error).slice(0, 500)
        }));
      return true;
  }
  if (message && message.scope === 'opera-agent-options' && message.action === 'testModel') {
    (async () => {
      const cfg = await readModelConfig(chrome.storage.local);
      if (!cfg.configured) return {
        ok: false,
        code: 'MODEL_NOT_CONFIGURED',
        message: `Belum dikonfigurasi: ${cfg.missing.join(', ')}.`
      };
      if (!endpointOk(cfg.endpoint)) return {
        ok: false,
        code: 'MODEL_BAD_ENDPOINT',
        message: 'The model endpoint must be https or loopback http.'
      };
      const probe = buildProbeRequest({ model: cfg.model });
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${cfg.key}`
        },
        body: JSON.stringify({ ...probe }),
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
      });
      if (!res || !res.ok) return {
        ok: false,
        code: 'MODEL_HTTP_ERROR',
        message: `Endpoint menjawab ${res?.status ?? 'nothing'}.`
      };
      return { ok: true };
    })()
      .then((reply) => sendResponse(reply))
      .catch((error) => sendResponse({
        ok: false,
        code: 'MODEL_HTTP_ERROR',
        message: String(error?.message || error).slice(0, 200)
      }));
    return true;
  }
  if (!message || message.scope !== 'opera-agent-popup') return false;
  Promise.resolve().then(async () => {
    if (message.action === 'status') {
      const cfg = await getConfig();
      const [active] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      });
      const currentTabPrivate = active?.id != null ? await isPrivateTab(active.id) : false;
      return {
        ok: true,
        config: {
          paired: cfg.paired,
          deviceName: cfg.deviceName,
          deviceId: cfg.deviceId,
          bridgeUrl: cfg.bridgeUrl
        },
        state: connectionState,
        version: PRODUCT_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        currentTabId: active?.id ?? null,
        currentTabPrivate
      };
    }
    if (message.action === 'pair') return pair(message.code);
    if (message.action === 'unpair') return unpair();
    if (message.action === 'self-test') return localSelfTest();
    if (message.action === 'toggle-private-tab') {
      const tabId = requireTabId(message.tabId);
      await chrome.tabs.get(tabId);
      return {
        ok: true,
        tabId,
        private: await setPrivateTab(tabId, !!message.private)
      };
    }
    throw new Error('Unknown popup action.');
  }).then(sendResponse).catch((error) => sendResponse({
    ok: false,
    error: String(error?.message || error)
  }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 });

  await listenStop().catch(() => {});
  ensureSocket().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 });
  await listenStop().catch(() => {});
  ensureSocket().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== WAKE_ALARM) return;

  heartbeat().finally(ensureSocket).catch((error) => {
    log.warn('HEARTBEAT_FAILED', error?.message || String(error));
  });
});

chrome.storage.onChanged.addListener((
  changes,
  area
) => {
  if (area !== 'local') return;
  if (changes.paired || changes.deviceToken || changes.bridgeUrl || changes.deviceName) {
    restartSocket();
  }
});

chrome.tabs.onUpdated.addListener((
  tabId,
  changeInfo,
  tab
) => {
  if (changeInfo.status === 'complete' && /^https?:/i.test(tab.url || '')) {
    const w = loadWatchers();
    Promise.resolve(w).then((watchers) => {
      if ((watchers.byTab[tabId] || []).length) armWatchersForTab(tabId).catch((error) => {
        log.warn('WATCH_ARM_FAILED', error?.message || String(error));
      });
    }).catch((error) => {
      log.warn('WATCHERS_LOAD_FAILED', error?.message || String(error));
    });
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
  }).catch((error) => {
    log.debug('PRIVATE_TAB_CLEANUP_FAILED', error?.message || String(error));
  });
});

chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 }).catch((error) => {
  log.warn('WAKE_ALARM_CREATE_FAILED', error?.message || String(error));
});
ensureSocket().catch(() => {});
