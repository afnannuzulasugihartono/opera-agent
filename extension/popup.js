const $ = (id) => document.getElementById(id);
let currentTabId = null;
let currentTabPrivate = false;

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
  } catch {
    return '\u2014';
  }
}

function friendlyStatus(status) {
  const labels = {
    ready: 'Connected',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    starting: 'Starting',
    unpaired: 'Not paired'
  };
  return labels[status] || status.replace(/\b\w/g, (character) => character.toUpperCase());
}

function setBusy(button, busy) {
  button.disabled = busy;
}

async function refresh() {
  const data = await call('status');
  if (!data?.ok) return;
  $('version').textContent = `${data.version} \u00b7 Protocol ${data.protocolVersion}`;
  $('deviceName').textContent = data.config.deviceName || 'opera';
  const state = data.state || {};
  const status = String(state.status || (data.config.paired ? 'connecting' : 'unpaired'));
  $('connection').textContent = friendlyStatus(status);
  $('lastCommand').textContent = friendlyTime(state.lastCommandAt);
  currentTabId = data.currentTabId;
  currentTabPrivate = !!data.currentTabPrivate;
  $('visionPrivacy').textContent = currentTabPrivate ? 'Blocked (private)' : 'Allowed';
  $('visionPrivacy').className = `privacy ${currentTabPrivate ? 'blocked' : 'allowed'}`;
  $('privateTabButton').textContent = currentTabPrivate ? 'Allow vision on current tab' : 'Mark current tab private';
  $('privateTabButton').disabled = currentTabId == null;
  $('statusBadge').textContent = friendlyStatus(status);
  $('statusBadge').className = `badge ${status}`;
  $('pairSection').hidden = !!data.config.paired;
  $('pairedSection').hidden = !data.config.paired;
  $('error').hidden = !state.lastError;
  $('error').textContent = state.lastError || '';
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
    $('error').textContent = String(error?.message || error);
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
    $('error').textContent = String(error?.message || error);
  } finally {
    setBusy($('privateTabButton'), false);
  }
});

refresh();
setInterval(refresh, 1500);
