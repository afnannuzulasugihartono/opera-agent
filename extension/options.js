// @last-edited: 2026-10-05 01:36 UTC+7.
// @title: options — MV3 runtime.
// @state: options page with bridge URL and log level settings.
// @dependencies: endpoints, options-store, error-messages, protocol.

import { DEFAULT_BRIDGE_URL } from './lib/endpoints.js';
import { loadOptions, saveBridgeUrl, saveLogLevel, saveModelEndpoint, saveModelName } from './lib/options-store.js';
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
  // The page is told whether a key exists and never what it is. The key itself is
  // entered in the popup, next to pairing: a secret has no business here.
  $('modelStatus').textContent = options.modelKeySet
    ? 'Endpoint and model saved here. A key is stored; set it in the popup.'
    : 'Endpoint and model saved here. No key is stored yet; set one in the popup.';
}

function showStatus(text) {
  $('saveStatus').textContent = text;
}

function showModelStatus(text) {
  $('modelStatus').textContent = text;
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
      showStatus(bridgeUrl === DEFAULT_BRIDGE_URL ? 'Saved. Using the default bridge.' : 'Saved.');
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
      showModelStatus('Model settings saved on this device.');
    } catch (error) {
      showModelStatus(userErrorMessage(error?.message || error));
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
