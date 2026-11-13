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
import { isRecord } from '../lib/guards.js';

const DB_NAME = 'opera-agent-self-update';
const STORE_NAME = 'handles';
const FOLDER_KEY = 'extension-folder';
const UPDATE_ALARM = 'opera-agent-self-update';
const UPDATE_ALARM_MINUTES = 30;

interface PermissionedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite' | undefined; id?: string | undefined }) => Promise<PermissionedDirectoryHandle>;

interface ApplyOutcome {
  ok: boolean;
  changed?: boolean | undefined;
  version?: string | undefined;
  reason?: string | null | undefined;
}

const isDirectoryHandle = (value: unknown): value is PermissionedDirectoryHandle =>
  isRecord(value)
  && value.kind === 'directory'
  && typeof value.name === 'string'
  && typeof value.getDirectoryHandle === 'function'
  && typeof value.getFileHandle === 'function'
  && typeof value.queryPermission === 'function';

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const withStore = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = work(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
};

async function folderHandle(): Promise<PermissionedDirectoryHandle | null> {
  try {
    const stored: unknown = await withStore('readonly', (store) => store.get(FOLDER_KEY));
    return isDirectoryHandle(stored) ? stored : null;
  } catch {
    return null;
  }
}

async function saveFolderHandle(handle: PermissionedDirectoryHandle) {
  await withStore('readwrite', (store) => store.put(handle, FOLDER_KEY));
  return handle;
}

export async function forgetFolderHandle() {
  await withStore('readwrite', (store) => store.delete(FOLDER_KEY));
}

async function pickExtensionFolder() {
  const picker = (globalThis as { showDirectoryPicker?: DirectoryPicker | undefined }).showDirectoryPicker;
  if (typeof picker !== 'function') {
    throw new Error(t('update.braveFlag'));
  }
  const handle = await picker({ mode: 'readwrite', id: 'opera-agent-extension-folder' });
  await saveFolderHandle(handle);
  return handle.name;
}

export async function folderPermission() {
  const handle = await folderHandle();
  if (!handle) return 'none';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'none';
  }
}

export async function applyNewBuild({ installedVersion }: { installedVersion?: string | undefined } = {}): Promise<ApplyOutcome> {
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

const pageElement = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

const showPageError = (message: string) => {
  const line = pageElement('gateError');
  if (!line) return;
  line.hidden = !message;
  line.textContent = message || '';
};

const showPageState = async () => {
  const permission = await folderPermission();
  const state = pageElement<HTMLElement>('gateState');
  const pick = pageElement<HTMLButtonElement>('gatePick');
  const pickLabel = pageElement<HTMLElement>('gatePickText');
  const update = pageElement<HTMLButtonElement>('gateUpdate');
  const forget = pageElement<HTMLButtonElement>('gateForget');
  if (!state || !pick || !update || !forget) return;
  const setTone = (tone: string) => { state.className = `statusLine ${tone}`; };
  const setLine = (tone: string, icon: keyof typeof STATUS_ICONS, text: string) => {
    setTone(tone);
    state.innerHTML = `${STATUS_ICONS[icon] ?? ''}<span>${text}</span>`;
  };
  const setPickLabel = (text: string) => { if (pickLabel) pickLabel.textContent = text; };
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
  const pick = pageElement<HTMLButtonElement>('gatePick');
  if (!pick) return;
  pick.addEventListener('click', async () => {
    showPageError('');
    pick.disabled = true;
    try {
      await pickExtensionFolder();
      await showPageState();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        showPageError(t('update.pickAbort'));
      } else {
        showPageError(t('update.pickFailed', { message: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      pick.disabled = false;
    }
  });
  const gateUpdate = pageElement<HTMLButtonElement>('gateUpdate');
  if (gateUpdate) gateUpdate.addEventListener('click', async () => {
    showPageError('');
    gateUpdate.disabled = true;
    try {
      const outcome = await applyNewBuild({ installedVersion: chrome.runtime.getManifest().version });
      if (outcome.ok && outcome.changed) {
        chrome.runtime.reload();
        return;
      }
      if (outcome.ok) {
        const stateLine = pageElement<HTMLElement>('gateState');
        if (stateLine) stateLine.innerHTML = `${STATUS_ICONS.check}<span>${t('update.upToDate', { v: outcome.version || chrome.runtime.getManifest().version })}</span>`;
        return;
      }
      showPageError(t('update.needsFolder'));
    } catch (error) {
      showPageError(t('update.failed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      gateUpdate.disabled = false;
    }
  });
  const gateForget = pageElement<HTMLElement>('gateForget');
  if (gateForget) gateForget.addEventListener('click', async () => {
    await forgetFolderHandle();
    await showPageState();
  });
  void showPageState();
}

// WHY THE PAGE WIRING ONLY RUNS WHERE THERE IS A PAGE.
// The worker has no document, and a module that reaches for one there would take the whole service worker down over a page that is not open.

if (typeof document !== 'undefined') wireUpdatePage();
