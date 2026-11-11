// @last-edited: 2026-11-11 UTC+7.
// @title: self-update - the reader's folder permission, the alarm, and the restart that finishes an update.
// @state: the folder the reader allowed, the update that writes the build over it, and the timer that asks for it.
// @dependencies: ../lib/self-update.js.

// WHY THE EXTENSION HOLDS A FOLDER PERMISSION.
// A browser never updates an extension that was loaded from a folder: it has no updater for one, so the version stands still and the reader is left with the same ritual every time.
// The one thing a reader can give that turns the ritual into nothing at all is a permission: pick the extension's own folder once, and the extension writes the next build over it and restarts itself.
// The permission is the reader's, it is remembered for that folder only, and the extension refuses to write anything outside it.

// WHY THE CHECK RUNS ON A TIMER AND NOT ONLY ON A CLICK.
// The reader asked for updates that happen; a button that has to be pressed is the ritual this replaces.
// The worker wakes on an alarm, asks the update service what it serves, and writes the build when it is newer and the permission is still there.

import { applyBuild, newerThan, servedVersion } from '../lib/self-update.js';
import { t, applyI18n } from '../lib/i18n.js';
import { STATUS_ICONS } from '../lib/status-icons.js';

const DB_NAME = 'opera-agent-self-update';
const STORE_NAME = 'handles';
const FOLDER_KEY = 'extension-folder';
const UPDATE_ALARM = 'opera-agent-self-update';
const UPDATE_ALARM_MINUTES = 30;

const openDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const withStore = async (mode, work) => {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = work(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
};

async function folderHandle() {
  try {
    return (await withStore('readonly', (store) => store.get(FOLDER_KEY))) ?? null;
  } catch (error) {
    return null;
  }
}

async function saveFolderHandle(handle) {
  await withStore('readwrite', (store) => store.put(handle, FOLDER_KEY));
  return handle;
}

export async function forgetFolderHandle() {
  await withStore('readwrite', (store) => store.delete(FOLDER_KEY));
}

async function pickExtensionFolder() {
  if (typeof showDirectoryPicker !== 'function') {
    throw new Error(t('update.braveFlag'));
  }
  const handle = await showDirectoryPicker({ mode: 'readwrite', id: 'opera-agent-extension-folder' });
  await saveFolderHandle(handle);
  return handle.name;
}

export async function folderPermission() {
  const handle = await folderHandle();
  if (!handle) return 'none';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch (error) {
    return 'none';
  }
}

export async function applyNewBuild({ installedVersion } = {}) {
  const handle = await folderHandle();
  if (!handle) return { ok: false, reason: 'no-folder' };
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') return { ok: false, reason: 'needs-permission' };
  return applyBuild({ folder: handle, installedVersion });
}

// WHY THE AGENT CAN PULL AN UPDATE WITHOUT THE READER'S HANDS.
// The reader may close the update page and never open it again, and the agent still has to be able to bring the newest build down.
// So the device can be asked to apply it: the write is the same write the page does, and the restart follows it.

export async function applyNewestBuild() {
  const manifest = chrome.runtime.getManifest();
  const outcome = await applyNewBuild({ installedVersion: manifest.version });
  if (outcome.ok && outcome.changed) {
    setTimeout(() => {
      try {
        chrome.runtime.reload();
      } catch (error) {
        void error;
      }
    }, 500);
    return { ok: true, updated: true, version: outcome.version };
  }
  return { ok: outcome.ok !== false, updated: false, version: outcome.version ?? manifest.version, reason: outcome.reason ?? null };
}

async function updateOnTimer() {
  const manifest = chrome.runtime.getManifest();
  const outcome = await applyNewBuild({ installedVersion: manifest.version });
  if (outcome.ok && outcome.changed) chrome.runtime.reload();
  return outcome;
}

export function scheduleSelfUpdate() {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_ALARM_MINUTES }).catch(() => {});
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== UPDATE_ALARM) return;
    updateOnTimer().catch(() => {});
  });
  updateOnTimer().catch(() => {});
}

export { newerThan, servedVersion };

// WHY THE PAGE WIRING LIVES HERE AND NOT IN A FILE OF ITS OWN.
// The page that asks for the permission is this module loaded as a page script, and the worker imports the same module for the alarm.
// A page script of its own would be reachable by nothing but itself, because the product reaches a page by its address and not by an import.

const pageElement = (id) => document.getElementById(id);

const showPageError = (message) => {
  const line = pageElement('gateError');
  if (!line) return;
  line.hidden = !message;
  line.textContent = message || '';
};

const showPageState = async () => {
  const permission = await folderPermission();
  const state = pageElement('gateState');
  const pick = pageElement('gatePick');
  const pickLabel = pageElement('gatePickText');
  const update = pageElement('gateUpdate');
  const forget = pageElement('gateForget');
  if (!state || !pick || !update || !forget) return;
  const setTone = (tone) => { state.className = `statusLine ${tone}`; };
  const setLine = (tone, icon, text) => {
    setTone(tone);
    state.innerHTML = `${STATUS_ICONS[icon] ?? ''}<span>${text}</span>`;
  };
  const setPickLabel = (text) => { if (pickLabel) pickLabel.textContent = text; };
  if (permission === 'granted') {
    const handle = await folderHandle();
    const name = handle?.name ? handle.name : 'folder extension';
    setLine('ready', 'check', t('update.state.granted', { name }));
    pick.hidden = true;
    update.hidden = false;
    forget.hidden = false;
    return;
  }
  if (permission === 'prompt') {
    setLine('pending', 'clock', t('update.state.prompt'));
    pick.hidden = false;
    update.hidden = true;
    forget.hidden = true;
    setPickLabel(t('update.pickAgain'));
    return;
  }
  setLine('idle', 'power', t('update.state.none'));
  pick.hidden = false;
  setPickLabel(t('update.pickLabel'));
  update.hidden = true;
  forget.hidden = true;
};

function wireUpdatePage() {
  applyI18n(document);
  const pick = pageElement('gatePick');
  if (!pick) return;
  pick.addEventListener('click', async () => {
    showPageError('');
    pick.disabled = true;
    try {
      await pickExtensionFolder();
      await showPageState();
    } catch (error) {
      if (error?.name === 'AbortError') {
        showPageError(t('update.pickAbort'));
      } else {
        showPageError(t('update.pickFailed', { message: String(error?.message || error) }));
      }
    } finally {
      pick.disabled = false;
    }
  });
  pageElement('gateUpdate').addEventListener('click', async () => {
    showPageError('');
    const button = pageElement('gateUpdate');
    button.disabled = true;
    try {
      const outcome = await applyNewBuild({ installedVersion: chrome.runtime.getManifest().version });
      if (outcome.ok && outcome.changed) {
        chrome.runtime.reload();
        return;
      }
      if (outcome.ok) {
        pageElement('gateState').innerHTML = `${STATUS_ICONS.check}<span>${t('update.upToDate', { v: outcome.version || chrome.runtime.getManifest().version })}</span>`;
        return;
      }
      showPageError(t('update.needsFolder'));
    } catch (error) {
      showPageError(t('update.failed', { message: String(error?.message || error) }));
    } finally {
      button.disabled = false;
    }
  });
  pageElement('gateForget').addEventListener('click', async () => {
    await forgetFolderHandle();
    await showPageState();
  });
  void showPageState();
}

// WHY THE PAGE WIRING ONLY RUNS WHERE THERE IS A PAGE.
// The worker has no document, and a module that reaches for one there would take the whole service worker down over a page that is not open.

if (typeof document !== 'undefined') wireUpdatePage();
