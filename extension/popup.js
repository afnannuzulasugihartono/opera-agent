// @last-edited: 2026-11-11 UTC+7.
// @title: popup — MV3 runtime.
// @state: Indonesian copy; one firm status line, the facts of the device, and the doors out: dashboard, docs, the signed package, and the update.
// @dependencies: agent-log, error-messages, endpoints.

import './lib/agent-log.js';
import { userErrorMessage } from './lib/error-messages.js';
import { SITE_ORIGIN, UPDATE_BASE_URL } from './lib/endpoints.js';
const log = globalThis.OperaAgentLog || {};
if (typeof log.warn !== 'function') throw new Error('Agent log runtime is unavailable.');
const $ = (id) => document.getElementById(id);
let currentTabId = null;
let currentTabPrivate = false;
let servedBuild = null;

// WHY THE POPUP ASKS THE SERVER WHICH VERSION IS SERVED.
// Chrome updates an installed extension on its own, but only when it was installed as a signed package; an extension loaded unpacked never asks the update service, and the person sees a version that simply stands still.
// The popup therefore asks what the server serves and says so out loud, because a version that does not move is otherwise a mystery with no handle on it.

async function servedVersion() {
  try {
    const response = await fetch(`${UPDATE_BASE_URL}/health`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = await response.json();
    const version = String(body?.version ?? '').trim();
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch (error) {
    log.debug('UPDATE_CHECK_FAILED', error?.message || String(error));
    return null;
  }
}

function newerThan(installed, served) {
  const a = String(installed || '').split('.').map((part) => Number(part) || 0);
  const b = String(served || '').split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((b[index] || 0) !== (a[index] || 0)) return (b[index] || 0) > (a[index] || 0);
  }
  return false;
}

// WHY THE UPDATE IS A BUTTON AND NOT ONLY A LINE.
// A line that says a newer version exists leaves the reader to guess what to do about it.
// The button does the whole job the browser cannot do from here: it fetches the signed package into the downloads folder and opens the page where it is dropped in, and every browser then keeps it fresh on its own.

async function installSignedPackage() {
  const url = `${UPDATE_BASE_URL}/download/opera-agent.crx`;
  try {
    await chrome.downloads.download({ url, filename: `opera-agent-${servedBuild || 'latest'}.crx`, saveAs: false });
  } catch (error) {
    log.warn('UPDATE_DOWNLOAD_FAILED', error?.message || String(error));
  }
  await chrome.tabs.create({ url: 'chrome://extensions' });
}

async function showServedVersion(installed) {
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
  if (newerThan(installed, served)) {
    line.hidden = false;
    if (text) text.textContent = `Versi ${served} sudah tersedia.`;
    button.textContent = `Pasang ${served}`;
    button.classList.add('isNew');
    return;
  }
  line.hidden = true;
  button.textContent = 'Perbarui';
  button.classList.remove('isNew');
}

async function call(action, extra = {}) {
  return chrome.runtime.sendMessage({ scope: 'opera-agent-popup', action, ...extra });
}

function friendlyTime(value) {
  if (!value) return '\u2014';
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    log.debug('TIME_FORMAT_FAILED', error?.message || String(error));
    return '\u2014';
  }
}

// WHY THE STATUS IS ONE FIRM LINE.
// The reader opens the popup to answer one question first: is it connected?
// Everything else is detail under that answer, so the answer is one line with one colour and no hedging.

function statusLine(status, paired) {
  if (!paired) return { text: 'Belum dipair', tone: 'idle' };
  if (status === 'ready') return { text: 'Terhubung', tone: 'ready' };
  if (status === 'connecting') return { text: 'Menghubungkan…', tone: 'pending' };
  if (status === 'reconnecting') return { text: 'Menyambung ulang…', tone: 'pending' };
  if (status === 'starting') return { text: 'Memulai…', tone: 'pending' };
  return { text: 'Terputus', tone: 'idle' };
}

function setBusy(button, busy) {
  button.disabled = busy;
}

async function refresh() {
  let data;
  try {
    data = await call('status');
  } catch (error) {
    log.debug('POPUP_REFRESH_FAILED', error?.message || String(error));
    return;
  }
  if (!data?.ok) return;
  $('version').textContent = `${data.version} \u00b7 Protocol ${data.protocolVersion}`;
  void showServedVersion(data.version);
  $('deviceName').textContent = data.config.deviceName || 'opera';
  const state = data.state || {};
  const status = String(state.status || (data.config.paired ? 'connecting' : 'unpaired'));
  $('lastCommand').textContent = friendlyTime(state.lastCommandAt);
  currentTabId = data.currentTabId;
  currentTabPrivate = !!data.currentTabPrivate;
  $('visionPrivacy').textContent = currentTabPrivate ? 'Diblokir (privat)' : 'Diizinkan';
  $('visionPrivacy').className = `privacy ${currentTabPrivate ? 'blocked' : 'allowed'}`;
  $('privateTabButton').textContent = currentTabPrivate ? 'Izinkan visi di tab ini' : 'Tandai tab ini privat';
  $('privateTabButton').disabled = currentTabId == null;
  const line = statusLine(status, !!data.config.paired);
  const statusEl = $('statusLine');
  if (statusEl) {
    statusEl.textContent = line.text;
    statusEl.className = `statusLine ${line.tone}`;
  }
  $('pairSection').hidden = !!data.config.paired;
  $('pairedSection').hidden = !data.config.paired;
  $('error').hidden = !state.lastError;
  $('error').textContent = state.lastError ? userErrorMessage(state.lastError) : '';
}

$('pairButton').addEventListener('click', async () => {
  const code = $('pairCode').value.trim();
  if (!code) return;
  setBusy($('pairButton'), true);
  try {
    const result = await call('pair', { code });
    if (!result?.ok) throw new Error(result?.error || 'Pairing failed.');
    $('pairCode').value = '';
    await refresh();
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = userErrorMessage(error?.message || error);
  } finally {
    setBusy($('pairButton'), false);
  }
});
$('unpairButton').addEventListener('click', async () => {
  setBusy($('unpairButton'), true);
  try {
    await call('unpair');
    $('selfTestResult').hidden = true;
    await refresh();
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = userErrorMessage(error?.message || error);
  } finally {
    setBusy($('unpairButton'), false);
  }
});

$('selfTestButton').addEventListener('click', async () => {
  setBusy($('selfTestButton'), true);
  try {
    const result = await call('self-test');
    $('selfTestResult').textContent = JSON.stringify(result, null, 2);
    $('selfTestResult').hidden = false;
  } catch (error) {
    $('selfTestResult').textContent = userErrorMessage(error?.message || error);
    $('selfTestResult').hidden = false;
  } finally {
    setBusy($('selfTestButton'), false);
  }
});

$('privateTabButton').addEventListener('click', async () => {
  if (currentTabId == null) return;
  setBusy($('privateTabButton'), true);
  try {
    const result = await call('toggle-private-tab', { tabId: currentTabId, private: !currentTabPrivate });
    if (!result?.ok) throw new Error(result?.error || 'Unable to update tab privacy.');
    await refresh();
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = userErrorMessage(error?.message || error);
  } finally {
    setBusy($('privateTabButton'), false);
  }
});

// WHY THE DOORS OPEN A TAB AND NOT A WINDOW.
// The person is already in a browser with the tabs they work in; a door that opens a separate window is a second place to look for the same thing.

const openTab = async (url) => {
  try {
    await chrome.tabs.create({ url });
  } catch (error) {
    log.debug('TAB_OPEN_FAILED', error?.message || String(error));
  }
};

$('dashboardButton').addEventListener('click', () => { void openTab(`${SITE_ORIGIN}/dashboard.html`); });
$('docsButton').addEventListener('click', () => { void openTab(`${SITE_ORIGIN}/docs.html`); });
$('downloadButton').addEventListener('click', () => { void openTab(`${SITE_ORIGIN}/unduh-berkas.html`); });
$('updateButton').addEventListener('click', () => { void installSignedPackage(); });

const refreshQuietly = () => { refresh().catch(() => {}) };

refreshQuietly();
setInterval(refreshQuietly, 1500);
