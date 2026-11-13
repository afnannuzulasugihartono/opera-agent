// @last-edited: 2026-11-11 UTC+7.
// @title: popup — MV3 runtime.
// @state: Indonesian copy; one firm status line, the facts of the device, and the doors out: dashboard, docs, the signed package, and the update.
// @dependencies: agent-log, error-messages, endpoints.

import './lib/agent-log.js';
import { userErrorMessage } from './lib/error-messages.js';
import { SITE_ORIGIN, UPDATE_BASE_URL } from './lib/endpoints.js';
import { browserFamily } from './lib/browser-id.js';
import { applyNewBuild, forgetFolderHandle, folderPermission } from './worker/self-update.js';
import { servedVersion, newerThan } from './lib/self-update.js';
import { t, applyI18n } from './lib/i18n.js';
import { STATUS_ICONS } from './lib/status-icons.js';
import { isRecord } from './lib/guards.js';
applyI18n(document);
const log = globalThis.OperaAgentLog;
if (typeof log?.warn !== 'function') throw new Error('Agent log runtime is unavailable.');
const $ = (id: string) => document.getElementById(id);
let pairBoxPinned = false;
let servedBuild: string | null = null;

// WHY A LOCAL SHAPE: the one line of status this file draws is always this triple, and the icons are a known closed set.

interface StatusLine {
  icon: keyof typeof STATUS_ICONS;
  text: string;
  tone: string;
}

const setStatusLine = (line: StatusLine) => {
  const statusEl = $('statusLine');
  if (!statusEl) return;
  statusEl.innerHTML = `${STATUS_ICONS[line.icon] ?? ''}<span>${line.text}</span>`;
  statusEl.className = `statusLine ${line.tone}`;
};

setStatusLine({ icon: 'clock', text: t('status.starting'), tone: 'pending' });

// WHY THE POPUP ASKS THE SERVER WHICH VERSION IS SERVED.
// Chrome updates an installed extension on its own, but only when it was installed as a signed package; an extension loaded unpacked never asks the update service, and the person sees a version that simply stands still.
// The popup therefore asks what the server serves and says so out loud, because a version that does not move is otherwise a mystery with no handle on it.

// WHY THE BUTTON FETCHES THE ARCHIVE AND NOT THE SIGNED PACKAGE.
// Chromium refuses a hand-installed package that the Web Store did not sign - the reader sees CRX_REQUIRED_PROOF_MISSING and no extension at all - and an extension loaded from a folder is never asked about updates, so its version stands still.
// The one update that works for that reader is the one the reader can do: take the new build, put it over the folder, and reload.
// The button fetches the build into the downloads folder and opens the extensions page where the reload button lives, and the page says in one line which way to go.

async function fetchNewBuild() {
  const browser = browserFamily().toLowerCase();
  const url = `${UPDATE_BASE_URL}/download/opera-agent.zip${browser ? `?for=${browser}` : ''}`;
  try {
    await chrome.downloads.download({ url, filename: `opera-agent-${browser || 'browser'}-${servedBuild || 'latest'}.zip`, saveAs: false });
  } catch (error) {
    log?.warn?.('UPDATE_DOWNLOAD_FAILED', error instanceof Error ? error.message : String(error));
  }
  await chrome.tabs.create({ url: 'chrome://extensions' });
}

// WHY THE RELOAD IS OURS TO DO.
// A browser only reloads an unpacked extension when a person presses the button on the extensions page; the extension can restart itself, and that is the last click of the update.

async function reloadExtension() {
  try {
    chrome.runtime.reload();
  } catch (error) {
    log?.debug?.('RELOAD_FAILED', error instanceof Error ? error.message : String(error));
  }
}

async function showServedVersion(installed: string) {
  const served = await servedVersion();
  servedBuild = served;
  const line = $('updateHint');
  const button = $('updateButton');
  const text = $('updateText');
  if (!line || !button) return;
  if (!served) {
    line.hidden = true;
    button.textContent = 'Perbarui';
    return;
  }
  if (newerThan(installed, served ?? undefined)) {
    line.hidden = false;
    if (text) text.textContent = t('update.available', { v: served });
    button.textContent = t('update.download', { v: served });
    const reload = $('reloadButton');
    if (reload) reload.hidden = false;
    return;
  }
  line.hidden = true;
  const reload = $('reloadButton');
  if (reload) reload.hidden = true;
}

async function call(action: string, extra: Record<string, unknown> = {}) {
  return chrome.runtime.sendMessage({ scope: 'opera-agent-popup', action, ...extra });
}

// WHY THE STATUS IS ONE FIRM LINE.
// The reader opens the popup to answer one question first: is it connected?
// Everything else is detail under that answer, so the answer is one line with one colour and no hedging.

function statusLine(status: unknown, paired: boolean): StatusLine {
  if (!paired) return { text: t('status.notPaired'), tone: 'idle', icon: 'power' };
  if (status === 'ready') return { text: t('status.connected'), tone: 'ready', icon: 'check' };
  if (status === 'connecting') return { text: t('status.connecting'), tone: 'pending', icon: 'clock' };
  if (status === 'reconnecting') return { text: t('status.reconnecting'), tone: 'pending', icon: 'clock' };
  if (status === 'starting') return { text: t('status.starting'), tone: 'pending', icon: 'clock' };
  return { text: t('status.disconnected'), tone: 'idle', icon: 'power' };
}



function setBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy;
}

async function refresh() {
  let data: unknown;
  try {
    data = await call('status');
  } catch (error) {
    log?.debug?.('POPUP_REFRESH_FAILED', error instanceof Error ? error.message : String(error));
    return;
  }
  const reply = isRecord(data) ? data : undefined;
  if (!reply?.ok) return;
  const versionEl = $('version');
  if (versionEl) versionEl.textContent = `${reply.version} \u00b7 Protocol ${reply.protocolVersion}`;
  void showServedVersion(String(reply.version));
  const state = isRecord(reply.state) ? reply.state : {};
  const config = isRecord(reply.config) ? reply.config : {};
  const status = String(state.status || (config.paired ? 'connecting' : 'unpaired'));
  const line = statusLine(status, !!config.paired);
  setStatusLine(line);
  const paired = !!config.paired;
  const pairSection = $('pairSection');
  if (pairSection) pairSection.hidden = paired && !pairBoxPinned;
  const toggle = $('pairToggleButton');
  if (toggle && pairSection) toggle.setAttribute('aria-expanded', String(!pairSection.hidden));
  const errorEl = $('error');
  if (errorEl) {
    errorEl.hidden = !state.lastError;
    errorEl.textContent = state.lastError ? userErrorMessage(state.lastError) ?? '' : '';
  }
  void showAutoUpdateState();
}

// WHY THE POPUP SHOWS WHETHER THE FOLDER IS ALLOWED.
// The automatic update is a permission the reader gave once; the popup says whether it is still there, so a version that does not move is never a mystery again.

async function showAutoUpdateState() {
  const allow = $('autoUpdateButton');
  const now = $('updateNowButton');
  const forget = $('forgetFolderButton');
  if (!allow || !now) return;
  const permission = await folderPermission();
  if (permission === 'granted') {
    allow.hidden = true;
    now.hidden = false;
    if (forget) forget.hidden = false;
    return;
  }
  allow.hidden = false;
  now.hidden = true;
  if (forget) forget.hidden = true;
}

$('pairToggleButton')?.addEventListener('click', () => {
  const section = $('pairSection');
  if (!section) return;
  pairBoxPinned = section.hidden;
  section.hidden = !pairBoxPinned;
  $('pairToggleButton')?.setAttribute('aria-expanded', String(pairBoxPinned));
  if (pairBoxPinned) $('pairCode')?.focus();
});

$('pairButton')?.addEventListener('click', async () => {
  const pairCode = $('pairCode');
  const pairButton = $('pairButton');
  if (!(pairCode instanceof HTMLInputElement) || !(pairButton instanceof HTMLButtonElement)) return;
  const code = pairCode.value.trim();
  if (!code) return;
  setBusy(pairButton, true);
  try {
    const result = await call('pair', { code });
    if (!result?.ok) throw new Error(result?.error || 'Pairing failed.');
    pairCode.value = '';
    pairBoxPinned = false;
    await refresh();
  } catch (error) {
    const errorEl = $('error');
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = userErrorMessage(error instanceof Error ? error.message : String(error)) ?? '';
    }
  } finally {
    setBusy(pairButton, false);
  }
});

// WHY THE DOORS OPEN A TAB AND NOT A WINDOW.
// The person is already in a browser with the tabs they work in; a door that opens a separate window is a second place to look for the same thing.

const openTab = async (url: string) => {
  try {
    await chrome.tabs.create({ url });
  } catch (error) {
    log?.debug?.('TAB_OPEN_FAILED', error instanceof Error ? error.message : String(error));
  }
};

$('dashboardButton')?.addEventListener('click', async () => { void openTab(`${SITE_ORIGIN}/dashboard.html`); });
$('docsButton')?.addEventListener('click', async () => { void openTab(`${SITE_ORIGIN}/docs.html`); });
$('updateButton')?.addEventListener('click', () => { void fetchNewBuild(); });
$('reloadButton')?.addEventListener('click', () => { void reloadExtension(); });

// WHY THE BUTTON OPENS A PAGE INSTEAD OF A PICKER.
// The folder picker takes the focus from the extension, and a popup that loses the focus closes with it, so the reader presses the button and sees nothing happen.
// A tab stays open, holds the picker, and can say what went wrong in words.

$('autoUpdateButton')?.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('update.html') });
});

$('forgetFolderButton')?.addEventListener('click', async () => {
  try {
    await forgetFolderHandle();
    await showAutoUpdateState();
  } catch (error) {
    const errorEl = $('error');
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = userErrorMessage(error instanceof Error ? error.message : String(error)) ?? '';
    }
  }
});

$('updateNowButton')?.addEventListener('click', async () => {
  const button = $('updateNowButton');
  if (!(button instanceof HTMLButtonElement)) return;
  button.disabled = true;
  try {
    const outcome = await applyNewBuild({ installedVersion: chrome.runtime.getManifest().version });
    if (outcome.ok && outcome.changed) {
      chrome.runtime.reload();
      return;
    }
    const rowText = button.querySelector('.rowText');
    const original = rowText ? rowText.textContent : '';
    if (rowText) {
      rowText.textContent = outcome.ok
        ? t('update.upToDate', { v: outcome.version || chrome.runtime.getManifest().version })
        : t('update.needsFolder');
      window.setTimeout(() => { rowText.textContent = original; }, 2400);
    }
    await showAutoUpdateState();
  } catch (error) {
    log?.warn?.('AUTO_UPDATE_FAILED', error instanceof Error ? error.message : String(error));
  } finally {
    button.disabled = false;
  }
});

const refreshQuietly = () => { refresh().catch(() => {}) };

refreshQuietly();
setInterval(refreshQuietly, 1500);
