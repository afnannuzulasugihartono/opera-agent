// @last-edited: 2026-10-09 UTC+7.
// @title: utils — storage access, tab mutation retry and time helpers.
// @state: owns STORAGE_KEYS and connectionState; every module that reads pair status imports these from here.
// @dependencies: log, endpoints.

import { log } from '../lib/log.js';
import { DEFAULT_BRIDGE_URL } from '../lib/endpoints.js';

const STORAGE_KEYS = ['paired', 'deviceName', 'deviceToken', 'bridgeUrl', 'deviceId', 'logLevel', 'listenSession'];

export const connectionState = {
  status: 'starting',
  lastError: null,
  lastConnectedAt: null,
  lastCommandAt: null,
  retryMs: 250
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TAB_DRAG_ATTEMPTS = 6;
const TAB_DRAG_BACKOFF_MS = 250;

function isTabDragRefusal(error) {
  return /tabs cannot be edited right now/i.test(String((error && error.message) || error));
}

export async function mutateTabs(run) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isTabDragRefusal(error) || attempt >= TAB_DRAG_ATTEMPTS) throw error;
      await sleep(TAB_DRAG_BACKOFF_MS * attempt);
    }
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getConfig() {
  const cfg = await chrome.storage.local.get(STORAGE_KEYS);

  try {
    globalThis.OperaAgentLog?.configure?.({ level: ['debug', 'warn', 'error'].includes(cfg.logLevel) ? cfg.logLevel : 'warn' });
  } catch (error) {
    globalThis.OperaAgentLog?.debug?.('LOG_CONFIGURE_FAILED', error?.message || String(error));
  }
  return {
    paired: !!cfg.paired,
    deviceName: String(cfg.deviceName || 'opera'),
    deviceToken: String(cfg.deviceToken || ''),
    deviceId: String(cfg.deviceId || ''),
    bridgeUrl: String(cfg.bridgeUrl || DEFAULT_BRIDGE_URL),
    logLevel: ['debug', 'warn', 'error'].includes(cfg.logLevel) ? cfg.logLevel : 'warn'
  };
}

export async function setState(patch) {

  Object.assign(connectionState, patch);
  try {
    await chrome.storage.local.set({ connectionState });
  } catch (error) {
    log.warn('STATE_PERSIST_FAILED', error?.message || String(error));
  }
}
