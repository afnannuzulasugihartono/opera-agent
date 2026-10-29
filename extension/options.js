// @last-edited: 2026-10-09 UTC+7.
// @title: options — MV3 runtime.
// @state: Indonesian copy; bridge URL, log level, and model settings.
// @dependencies: endpoints, options-store, error-messages, protocol.

import { DEFAULT_BRIDGE_URL } from './lib/endpoints.js';
import {
  loadOptions,
  saveBridgeUrl,
  saveLogLevel,
  saveModelEndpoint,
  saveModelName,
  MODEL_PROVIDERS
} from './lib/options-store.js';
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
  const providerId = matchProvider(options.modelEndpoint, options.modelName);
  $('modelProvider').value = providerId;
  fillModelList(providerId);

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

const providerOf = (id) => MODEL_PROVIDERS.find((provider) => provider.id === id);

function matchProvider(
  endpoint,
  model
) {
  const known = MODEL_PROVIDERS.find((provider) =>
    provider.id !== 'custom'
    && provider.endpoint !== ''
    && provider.endpoint === endpoint
    && (provider.models.length === 0 || provider.models.some((entry) => entry.id === model)));
  return known ? known.id : 'custom';
}

function fillModelList(providerId) {
  const list = $('modelList');
  list.replaceChildren();
  for (const entry of providerOf(providerId)?.models ?? []) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.label;
    list.append(option);
  }
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

  $('modelProvider').addEventListener('change', () => {
    const provider = providerOf($('modelProvider').value);
    if (!provider) return;
    $('modelEndpoint').value = provider.endpoint;
    $('modelName').value = provider.defaultModel;
    fillModelList(provider.id);
    showModelStatus(provider.id === 'custom'
      ? 'Kustom dipilih — isi endpoint dan model, lalu Simpan.'
      : 'Penyedia dipilih — klik Simpan untuk menyimpan.');
  });
  const syncProviderSelect = () => {
    const providerId = matchProvider($('modelEndpoint').value, $('modelName').value);
    $('modelProvider').value = providerId;
    fillModelList(providerId);
  };
  $('modelEndpoint').addEventListener('input', syncProviderSelect);
  $('modelName').addEventListener('input', syncProviderSelect);
  $('modelProbe').addEventListener('click', async () => {
    const probe = $('modelProbe');
    probe.disabled = true;
    try {
      const reply = await chrome.runtime.sendMessage({
        scope: 'opera-agent-options',
        action: 'testModel'
      });
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
