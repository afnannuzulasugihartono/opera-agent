// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: options — MV3 runtime.
// @context: MV3 browser runtime.
// @state: options page with bridge URL and log level settings.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: endpoints, options-store, error-messages, protocol.

import { DEFAULT_BRIDGE_URL } from './lib/endpoints.js';
import { loadOptions, saveBridgeUrl, saveLogLevel } from './lib/options-store.js';
import { userErrorMessage } from './lib/error-messages.js';
import { PROTOCOL_VERSION } from './lib/protocol.js';

const $ = (id) => document.getElementById(id);
const storage = chrome.storage.local;

async function prefill() {
  const options = await loadOptions(storage);
  $('bridgeUrl').value = options.bridgeUrl;
  $('logLevel').value = options.logLevel;
}

function showStatus(text) {
  $('saveStatus').textContent = text;
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
