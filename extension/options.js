// @last-edited: 2026-10-09 UTC+7.
// @title: options — MV3 runtime.
// @state: Indonesian copy; bridge URL, log level, and model settings.
// @dependencies: endpoints, options-store, error-messages, protocol.

import { DEFAULT_BRIDGE_URL } from './lib/endpoints.js';
import { loadOptions, saveBridgeUrl, saveLogLevel, saveModelEndpoint, saveModelName, MODEL_PRESETS } from './lib/options-store.js';
import { userErrorMessage } from './lib/error-messages.js';
import { PROTOCOL_VERSION } from './lib/protocol.js';

const $ = (id) => document.getElementById(id);
const storage = chrome.storage.local;

async function prefill() {
  const options = await loadOptions(storage);
  $('bridgeUrl').value = options.bridgeUrl;
  $('logLevel').value = options.logLevel;
  $('modelEndpoint').value = options.modelEndpoint;
  $('modelName').value = options.modelName;
  const match = MODEL_PRESETS.find((preset) => preset.endpoint === options.modelEndpoint && preset.model === options.modelName);
  $('modelPreset').value = match ? match.id : 'custom';

  // The page is told whether a key exists and never what it is. The key itself is
  // entered in the popup, next to pairing: a secret has no business here.
  $('modelStatus').textContent = options.modelKeySet
    ? 'Endpoint dan model tersimpan di sini. Kunci sudah tersimpan; atur di popup.'
    : 'Endpoint dan model tersimpan di sini. Belum ada kunci; atur di popup.';
}

function showStatus(text) {
  $('saveStatus').textContent = text;
}

function showModelStatus(text) {
  $('modelStatus').textContent = text;
}

function showProbeStatus(text) {
  $('modelProbeStatus').textContent = text;
}

function init() {
  $('version').textContent = `${chrome.runtime.getManifest().version} \u00b7 Protocol ${PROTOCOL_VERSION}`;
  prefill().catch((error) => showStatus(userErrorMessage(error?.message || error)));
  $('settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const bridgeUrl = await saveBridgeUrl(storage, $('bridgeUrl').value);
      await saveLogLevel(storage, $('logLevel').value);
      $('bridgeUrl').value = bridgeUrl;
      showStatus(bridgeUrl === DEFAULT_BRIDGE_URL ? 'Tersimpan. Memakai bridge bawaan.' : 'Tersimpan.');
    } catch (error) {
      showStatus(userErrorMessage(error?.message || error));
    }
  });
  // WHY its own form and button: one shared submit would mix two unrelated saves,
  // and a failure in one would leave the other silently unwritten.
  $('modelForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveModelEndpoint(storage, $('modelEndpoint').value);
      await saveModelName(storage, $('modelName').value);
      await prefill();
      showModelStatus('Setelan model tersimpan di device ini.');
    } catch (error) {
      showModelStatus(userErrorMessage(error?.message || error));
    }
  });
  // WHY fill without saving: picking a preset stages the values in the inputs and
  // the existing Simpan button commits them, so one save path stays the only save path.
  $('modelPreset').addEventListener('change', () => {
    const preset = MODEL_PRESETS.find((entry) => entry.id === $('modelPreset').value);
    if (!preset) return;
    $('modelEndpoint').value = preset.endpoint;
    $('modelName').value = preset.model;
    showModelStatus('Preset dipilih — klik Simpan untuk menyimpan.');
  });
  $('modelProbe').addEventListener('click', async () => {
    const probe = $('modelProbe');
    probe.disabled = true;
    try {
      const reply = await chrome.runtime.sendMessage({ scope: 'opera-agent-options', action: 'testModel' });
      showProbeStatus(reply && reply.ok ? 'Tersambung.' : String(reply?.message || reply?.error || 'Gagal tersambung.'));
    } catch (error) {
      showProbeStatus(userErrorMessage(error?.message || error));
    } finally {
      probe.disabled = false;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
