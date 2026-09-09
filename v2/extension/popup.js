const $ = (id) => document.getElementById(id);

function send(action, extra = {}) {
  return chrome.runtime.sendMessage({ scope: 'opera-agent-popup', action, ...extra });
}

function showError(message = '') {
  const el = $('error');
  el.textContent = message;
  el.hidden = !message;
}

async function refresh() {
  try {
    const data = await send('status');
    if (!data?.ok) throw new Error(data?.error || 'Unable to read status.');
    $('version').textContent = data.version || '2.0.0';
    $('deviceName').textContent = data.config?.deviceName || 'opera-v2';
    $('connection').textContent = data.state?.status || 'unknown';
    $('lastCommand').textContent = data.state?.lastCommandAt || '—';
    $('statusBadge').textContent = data.config?.paired ? (data.state?.status || 'Paired') : 'Unpaired';
    $('pairSection').hidden = !!data.config?.paired;
    $('pairedSection').hidden = !data.config?.paired;
    showError(data.state?.lastError || '');
  } catch (error) {
    showError(String(error?.message || error));
  }
}

$('pairButton').addEventListener('click', async () => {
  showError('');
  try {
    const result = await send('pair', { code: $('pairCode').value.trim() });
    if (!result?.ok) throw new Error(result?.error || 'Pairing failed.');
    $('pairCode').value = '';
    await refresh();
  } catch (error) { showError(String(error?.message || error)); }
});

$('unpairButton').addEventListener('click', async () => {
  showError('');
  try { await send('unpair'); await refresh(); }
  catch (error) { showError(String(error?.message || error)); }
});

$('selfTestButton').addEventListener('click', async () => {
  const out = $('selfTestResult');
  out.hidden = false;
  out.textContent = 'Running…';
  try { out.textContent = JSON.stringify(await send('self-test'), null, 2); }
  catch (error) { out.textContent = String(error?.message || error); }
});

refresh();
setInterval(refresh, 1500);
