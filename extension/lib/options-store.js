// @last-edited: 2026-10-09 UTC+7.
// @title: options-store — MV3 runtime library, shared with the Node suite..
// @state: The bridge URL, log level, and the user's own model endpoint, name and key, kept in local storage.
// @dependencies: endpoints.

// Validation and persistence for the Options page: the bridge URL override and the
// log level, stored in chrome.storage.local.
//
// WHY https only: the bridge URL is where the device token is posted, so plain http to
// a remote host is refused. Loopback is served over http and is handled by the caller,
// not here.
//
// The model endpoint, key and model name are the user's own, entered here and kept in
// chrome.storage.local so they never reach our server. Two consequences shape this file:
// the endpoint is held to the same https rule as the bridge, because it receives page
// content, and the key is never handed back to the page. The page is told whether a key
// exists, not what it is, so opening Options cannot read it out of the DOM.

import { DEFAULT_BRIDGE_URL } from './endpoints.js';

export const MODEL_PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'nvidia',
    label: 'NVIDIA',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    defaultModel: 'meta/llama-3.2-11b-vision-instruct',
    models: Object.freeze([
      Object.freeze({ id: 'meta/llama-3.2-11b-vision-instruct', label: 'Llama 3.2 11B (cepat)' }),
      Object.freeze({ id: 'meta/llama-3.2-90b-vision-instruct', label: 'Llama 3.2 90B (teliti)' })
    ])
  }),
  Object.freeze({
    id: 'groq',
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.1-8b-instant',
    models: Object.freeze([
      Object.freeze({ id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (tercepat, 560 t/s)' }),
      Object.freeze({ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (teliti, 280 t/s)' }),
      Object.freeze({ id: 'qwen/qwen3.8-27b', label: 'Qwen3.8 27B (pratinjau, 450 t/s)' })
    ])
  }),
  Object.freeze({
    id: 'ollama',
    label: 'Ollama',
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    defaultModel: '',
    models: Object.freeze([])
  }),
  Object.freeze({
    id: 'lmstudio',
    label: 'LM Studio',
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    defaultModel: '',
    models: Object.freeze([])
  }),
  Object.freeze({
    id: 'custom',
    label: 'Kustom…',
    endpoint: '',
    defaultModel: '',
    models: Object.freeze([])
  })
]);
export const DEFAULT_PROVIDER_ID = 'nvidia';

const DEFAULT_PROVIDER = MODEL_PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER_ID);
if (!DEFAULT_PROVIDER) throw new Error(`DEFAULT_PROVIDER_ID "${DEFAULT_PROVIDER_ID}" names no provider in MODEL_PROVIDERS.`);

const LEVELS = ['debug', 'warn', 'error'];
const DEFAULT_LEVEL = 'warn';
const MODEL_NAME_MAX = 120;

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

// WHY loopback is exempt: a local model on 127.0.0.1 never sends the content off the
// machine, so demanding https of it would only block the one case that is safest.

function isLoopbackHttp(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function loadOptions(storage) {
  const cfg = await storage.get(['bridgeUrl', 'logLevel', 'modelEndpoint', 'modelName', 'modelKey']);
  const bridgeUrl = typeof cfg.bridgeUrl === 'string' && cfg.bridgeUrl ? cfg.bridgeUrl : DEFAULT_BRIDGE_URL;
  const logLevel = LEVELS.includes(cfg.logLevel) ? cfg.logLevel : DEFAULT_LEVEL;
  const storedEndpoint = typeof cfg.modelEndpoint === 'string' ? cfg.modelEndpoint : '';
  const storedModel = typeof cfg.modelName === 'string' ? cfg.modelName : '';
  return {
    bridgeUrl,
    logLevel,

    // Read-time defaults only: an empty store reports the default provider without
    // writing anything, so the provider can move under a user who never chose.
    modelEndpoint: storedEndpoint ? storedEndpoint : DEFAULT_PROVIDER.endpoint,
    modelName: storedModel ? storedModel : DEFAULT_PROVIDER.defaultModel,

    // The key is reported as present or absent, never as a value.
    modelKeySet: typeof cfg.modelKey === 'string' && cfg.modelKey.length > 0
  };
}

export async function saveBridgeUrl(storage, value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    await storage.set({ bridgeUrl: DEFAULT_BRIDGE_URL });
    return DEFAULT_BRIDGE_URL;
  }
  if (!isHttpUrl(trimmed)) throw new Error('Enter an https:// URL or leave empty to reset.');
  await storage.set({ bridgeUrl: trimmed });
  return trimmed;
}

export async function saveLogLevel(storage, value) {
  if (!LEVELS.includes(value)) throw new Error('Log level must be debug, warn, or error.');
  await storage.set({ logLevel: value });
  return value;
}

export async function saveModelEndpoint(storage, value) {
  const trimmed = String(value ?? '').trim();
  if (!isHttpUrl(trimmed) && !isLoopbackHttp(trimmed)) {
    throw new Error('Enter an https:// URL for the model endpoint, or a loopback http:// address for a local model.');
  }
  await storage.set({ modelEndpoint: trimmed });
  return trimmed;
}

export async function saveModelName(storage, value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed.length > MODEL_NAME_MAX) {
    throw new Error('Enter a model name of 1 to 120 characters.');
  }
  await storage.set({ modelName: trimmed });
  return trimmed;
}

// WHY empty clears rather than refuses: revoking a key has to be possible without a
// keyboard, and a store that cannot be emptied is a store nobody trusts.

export async function saveModelKey(storage, value) {
  const trimmed = String(value ?? '').trim();
  await storage.set({ modelKey: trimmed });
  return trimmed;
}

// Fail closed, and say which part is missing: an absent key is the common case and
// a silent plan attempt would look like a broken product rather than an unconfigured one.

export async function readModelConfig(storage) {
  const cfg = await storage.get(['modelEndpoint', 'modelName', 'modelKey']);
  const storedEndpoint = typeof cfg.modelEndpoint === 'string' ? cfg.modelEndpoint.trim() : '';
  const storedModel = typeof cfg.modelName === 'string' ? cfg.modelName.trim() : '';
  const endpoint = storedEndpoint ? storedEndpoint : DEFAULT_PROVIDER.endpoint;
  const model = storedModel ? storedModel : DEFAULT_PROVIDER.defaultModel;
  const key = typeof cfg.modelKey === 'string' ? cfg.modelKey.trim() : '';
  const missing = [];
  if (!endpoint) missing.push('endpoint');
  if (!model) missing.push('model');
  if (!key) missing.push('key');
  if (missing.length > 0) {
    return { configured: false, code: 'MODEL_NOT_CONFIGURED', missing };
  }
  return { configured: true, endpoint, model, key };
}
