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

export async function folderHandle() {
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

export async function pickExtensionFolder() {
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

async function updateOnTimer() {
  const manifest = chrome.runtime.getManifest();
  const outcome = await applyNewBuild({ installedVersion: manifest.version });
  if (outcome.ok && outcome.changed) chrome.runtime.reload();
  return outcome;
}

export function scheduleSelfUpdate() {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_ALARM_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== UPDATE_ALARM) return;
    updateOnTimer().catch(() => {});
  });
  updateOnTimer().catch(() => {});
}

export { newerThan, servedVersion };
