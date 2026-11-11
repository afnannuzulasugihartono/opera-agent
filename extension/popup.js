// @last-edited: 2026-11-11 UTC+7.
// @title: popup — MV3 runtime.
// @state: Indonesian copy; pairing help follows SITE_ORIGIN, errors mapped to Indonesian, and the version the server serves next to the one installed.
// @dependencies: agent-log, error-messages, endpoints.

import './lib/agent-log.js';
import { userErrorMessage } from './lib/error-messages.js';
import { SITE_ORIGIN, UPDATE_BASE_URL } from './lib/endpoints.js';
const log = globalThis.OperaAgentLog || {};
if (typeof log.warn !== 'function') throw new Error('Agent log runtime is unavailable.');
const $ = (id) => document.getElementById(id);
let currentTabId = null;
let currentTabPrivate = false;

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

async function showServedVersion(installed) {
  const served = await servedVersion();
  const line = $('updateHint');
  if (!line) return;
  if (!served || !newerThan(installed, served)) {
    line.hidden = true;
    line.textContent = '';
    return;
  }
  line.hidden = false;
  line.textContent = `Versi ${served} sudah tersedia. Pasang paket bertanda tangan dari halaman unduh agar browser memperbaruinya sendiri.`;
  const link = $('updateLink');
  if (link) link.href = `${SITE_ORIGIN}/unduh.html`;
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

function friendlyStatus(status) {
  const labels = {
    ready: 'Terhubung',
    connecting: 'Menghubungkan',
    reconnecting: 'Menyambung ulang',
    starting: 'Memulai',
    unpaired: 'Belum dipairing'
  };
  return labels[status] || status.replace(/\b\w/g, (character) => character.toUpperCase());
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
  $('connection').textContent = friendlyStatus(status);
  $('lastCommand').textContent = friendlyTime(state.lastCommandAt);
  currentTabId = data.currentTabId;
  currentTabPrivate = !!data.currentTabPrivate;
  $('visionPrivacy').textContent = currentTabPrivate ? 'Diblokir (privat)' : 'Diizinkan';
  $('visionPrivacy').className = `privacy ${currentTabPrivate ? 'blocked' : 'allowed'}`;
  $('privateTabButton').textContent = currentTabPrivate ? 'Izinkan visi di tab ini' : 'Tandai tab ini privat';
  $('privateTabButton').disabled = currentTabId == null;
  $('statusBadge').textContent = friendlyStatus(status);
  $('statusBadge').className = `badge ${status}`;
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

const refreshQuietly = () => { refresh().catch(() => {}) };

refreshQuietly();
setInterval(refreshQuietly, 1500);

try {
  $('pairHelp').href = `${SITE_ORIGIN}/dashboard.html#pairing`;
} catch (error) {
  log.debug('PAIR_HELP_LINK_FAILED', error?.message || String(error));
}
