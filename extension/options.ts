// @last-edited: 2026-10-09 UTC+7.
// @title: options — MV3 runtime.
// @state: Indonesian copy; bridge URL, log level, and model settings.
// @dependencies: endpoints, options-store, error-messages, protocol.

import { DEFAULT_BRIDGE_URL } from './lib/endpoints.js';
import { loadOptions, saveBridgeUrl, saveLogLevel, saveModelEndpoint, saveModelName, MODEL_PROVIDERS } from './lib/options-store.js';
import { userErrorMessage } from './lib/error-messages.js';
import { PROTOCOL_VERSION } from './lib/protocol.js';
import { isRecord } from './lib/guards.js';

// The page ships every id below in options.html; a missing or mis-typed element is a broken build, so refuse loudly instead of crashing on a null access later.

const $ = <T extends HTMLElement>(id: string, ctor: new () => T): T => {
  const element = document.getElementById(id);
  if (!(element instanceof ctor)) throw new Error(`Element #${id} is missing or has the wrong type.`);
  return element;
};
const storage = chrome.storage.local;

async function prefill() {
  const options = await loadOptions(storage);
  $('bridgeUrl', HTMLInputElement).value = options.bridgeUrl;
  $('logLevel', HTMLSelectElement).value = options.logLevel;
  $('modelEndpoint', HTMLInputElement).value = options.modelEndpoint;
  $('modelName', HTMLInputElement).value = options.modelName;
  const providerId = matchProvider(options.modelEndpoint, options.modelName);
  $('modelProvider', HTMLSelectElement).value = providerId;
  fillModelList(providerId);

  $('modelStatus', HTMLElement).textContent = options.modelKeySet
    ? 'Endpoint dan model tersimpan di sini. Kunci sudah tersimpan; atur di popup.'
    : 'Endpoint dan model tersimpan di sini. Belum ada kunci; atur di popup.';
}

function showStatus(text: string | undefined) {
  $('saveStatus', HTMLElement).textContent = text ?? '';
}

function showModelStatus(text: string | undefined) {
  $('modelStatus', HTMLElement).textContent = text ?? '';
}

function showProbeStatus(text: string | undefined) {
  $('modelProbeStatus', HTMLElement).textContent = text ?? '';
}

const providerOf = (id: string) => MODEL_PROVIDERS.find((provider) => provider.id === id);

function matchProvider(endpoint: string, model: string): string {
  const known = MODEL_PROVIDERS.find((provider) =>
    provider.id !== 'custom'
    && provider.endpoint !== ''
    && provider.endpoint === endpoint
    && (provider.models.length === 0 || provider.models.some((entry) => entry.id === model)));
  return known ? known.id : 'custom';
}

function fillModelList(providerId: string) {
  const list = $('modelList', HTMLDataListElement);
  list.replaceChildren();
  for (const entry of providerOf(providerId)?.models ?? []) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.label;
    list.append(option);
  }
}

function init() {
  $('version', HTMLElement).textContent = `${chrome.runtime.getManifest().version} \u00b7 Protocol ${PROTOCOL_VERSION}`;
  prefill().catch((error) => showStatus(userErrorMessage(error instanceof Error ? error.message : String(error))));
  $('settingsForm', HTMLFormElement).addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const bridgeUrl = await saveBridgeUrl(storage, $('bridgeUrl', HTMLInputElement).value);
      await saveLogLevel(storage, $('logLevel', HTMLSelectElement).value);
      $('bridgeUrl', HTMLInputElement).value = bridgeUrl;
      showStatus(bridgeUrl === DEFAULT_BRIDGE_URL ? 'Tersimpan. Memakai bridge bawaan.' : 'Tersimpan.');
    } catch (error) {
      showStatus(userErrorMessage(error instanceof Error ? error.message : String(error)));
    }
  });

  $('modelForm', HTMLFormElement).addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveModelEndpoint(storage, $('modelEndpoint', HTMLInputElement).value);
      await saveModelName(storage, $('modelName', HTMLInputElement).value);
      await prefill();
      showModelStatus('Setelan model tersimpan di device ini.');
    } catch (error) {
      showModelStatus(userErrorMessage(error instanceof Error ? error.message : String(error)));
    }
  });

  $('modelProvider', HTMLSelectElement).addEventListener('change', () => {
    const provider = providerOf($('modelProvider', HTMLSelectElement).value);
    if (!provider) return;
    $('modelEndpoint', HTMLInputElement).value = provider.endpoint;
    $('modelName', HTMLInputElement).value = provider.defaultModel;
    fillModelList(provider.id);
    showModelStatus(provider.id === 'custom'
      ? 'Kustom dipilih — isi endpoint dan model, lalu Simpan.'
      : 'Penyedia dipilih — klik Simpan untuk menyimpan.');
  });
  const syncProviderSelect = () => {
    const providerId = matchProvider($('modelEndpoint', HTMLInputElement).value, $('modelName', HTMLInputElement).value);
    $('modelProvider', HTMLSelectElement).value = providerId;
    fillModelList(providerId);
  };
  $('modelEndpoint', HTMLInputElement).addEventListener('input', syncProviderSelect);
  $('modelName', HTMLInputElement).addEventListener('input', syncProviderSelect);
  $('modelProbe', HTMLButtonElement).addEventListener('click', async () => {
    const probe = $('modelProbe', HTMLButtonElement);
    probe.disabled = true;
    try {
      const reply: unknown = await chrome.runtime.sendMessage({ scope: 'opera-agent-options', action: 'testModel' });
      const record = isRecord(reply) ? reply : {};
      showProbeStatus(record.ok ? 'Tersambung.' : String(record.message || record.error || 'Gagal tersambung.'));
    } catch (error) {
      showProbeStatus(userErrorMessage(error instanceof Error ? error.message : String(error)));
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
