const $ = (id) => document.getElementById(id);

async function call(action, extra = {}) {
  return chrome.runtime.sendMessage({ scope: 'opera-agent-popup', action, ...extra });
}

function friendlyTime(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleTimeString(); } catch { return '—'; }
}

function setBusy(button, busy) {
  button.disabled = busy;
}

async function refresh() {
  const data = await call('status');
  if (!data?.ok) return;
  $('version').textContent = `v${data.version} · protocol ${data.protocolVersion}`;
  $('deviceName').textContent = data.config.deviceName || 'opera';
  const state = data.state || {};
  const status = String(state.status || (data.config.paired ? 'connecting' : 'unpaired'));
  $('connection').textContent = status;
  $('lastCommand').textContent = friendlyTime(state.lastCommandAt);
  $('statusBadge').textContent = status.replace(/\b\w/g, (m) => m.toUpperCase());
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

refresh();
setInterval(refresh, 1500);
