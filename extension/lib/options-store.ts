// @last-edited: 2026-10-09 UTC+7.
// @title: options-store — validation and persistence for the Options page.
// @state: The bridge URL, log level, and the user's own model endpoint, name and key, kept in local storage.
// @dependencies: endpoints.

// Validation and persistence for the Options page: the bridge URL override and the log level, stored in chrome.storage.local.

// WHY https only: the bridge URL is where the device token is posted, so plain http to a remote host is refused.
// Loopback is served over http and is handled by the caller, not here.

// The model endpoint, key and model name are the user's own, entered here and kept in chrome.storage.local so they never reach our server.
// Two consequences shape this file: the endpoint is held to the same https rule as the bridge, because it receives page content, and the key is never handed back to the page.
// The page is told whether a key exists, not what it is, so opening Options cannot read it out of the DOM.

import { DEFAULT_BRIDGE_URL } from './endpoints.js';
import { isString } from './guards.js';

// WHY NOT chrome.storage.StorageArea.
// lib/ is the chrome-free home: the storage area is injected so the module loads without a browser.
// Naming the chrome namespace here would chain the type dependency through every caller.
// This is the structural slice of the injected area those callers pass.

export interface StorageAreaLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface ModelProviderModel {
  readonly id: string;
  readonly label: string;
}

interface ModelProvider {
  readonly id: string;
  readonly label: string;
  readonly endpoint: string;
  readonly defaultModel: string;
  readonly models: readonly ModelProviderModel[];
}

export const MODEL_PROVIDERS: readonly ModelProvider[] = Object.freeze([
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
      Object.freeze({ id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (cepat)' }),
      Object.freeze({ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (teliti)' }),
      Object.freeze({ id: 'qwen/qwen3.8-27b', label: 'Qwen3.8 27B (pratinjau)' })
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

const DEFAULT_PROVIDER = (() => {
  const provider = MODEL_PROVIDERS.find((entry) => entry.id === DEFAULT_PROVIDER_ID);
  if (!provider) throw new Error(`DEFAULT_PROVIDER_ID "${DEFAULT_PROVIDER_ID}" names no provider in MODEL_PROVIDERS.`);
  return provider;
})();

const LEVELS = ['debug', 'warn', 'error'];
const DEFAULT_LEVEL = 'warn';
const MODEL_NAME_MAX = 120;

function isHttpUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLoopbackHttp(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function loadOptions(storage: StorageAreaLike) {
  const cfg = await storage.get(['bridgeUrl', 'logLevel', 'modelEndpoint', 'modelName', 'modelKey']);
  const bridgeUrl = isString(cfg.bridgeUrl) && cfg.bridgeUrl ? cfg.bridgeUrl : DEFAULT_BRIDGE_URL;
  const logLevel = isString(cfg.logLevel) && LEVELS.includes(cfg.logLevel) ? cfg.logLevel : DEFAULT_LEVEL;
  const storedEndpoint = isString(cfg.modelEndpoint) ? cfg.modelEndpoint : '';
  const storedModel = isString(cfg.modelName) ? cfg.modelName : '';
  return {
    bridgeUrl,
    logLevel,

    modelEndpoint: storedEndpoint ? storedEndpoint : DEFAULT_PROVIDER.endpoint,
    modelName: storedModel ? storedModel : DEFAULT_PROVIDER.defaultModel,

    modelKeySet: isString(cfg.modelKey) && cfg.modelKey.length > 0
  };
}

export async function saveBridgeUrl(storage: StorageAreaLike, value: unknown) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    await storage.set({ bridgeUrl: DEFAULT_BRIDGE_URL });
    return DEFAULT_BRIDGE_URL;
  }
  if (!isHttpUrl(trimmed)) throw new Error('Enter an https:// URL or leave empty to reset.');
  await storage.set({ bridgeUrl: trimmed });
  return trimmed;
}

export async function saveLogLevel(storage: StorageAreaLike, value: unknown) {
  if (!isString(value) || !LEVELS.includes(value)) throw new Error('Log level must be debug, warn, or error.');
  await storage.set({ logLevel: value });
  return value;
}

export async function saveModelEndpoint(storage: StorageAreaLike, value: unknown) {
  const trimmed = String(value ?? '').trim();
  if (!isHttpUrl(trimmed) && !isLoopbackHttp(trimmed)) {
    throw new Error('Enter an https:// URL for the model endpoint, or a loopback http:// address for a local model.');
  }
  await storage.set({ modelEndpoint: trimmed });
  return trimmed;
}

export async function saveModelName(storage: StorageAreaLike, value: unknown) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed.length > MODEL_NAME_MAX) {
    throw new Error('Enter a model name of 1 to 120 characters.');
  }
  await storage.set({ modelName: trimmed });
  return trimmed;
}

export async function saveModelKey(storage: StorageAreaLike, value: unknown) {
  const trimmed = String(value ?? '').trim();
  await storage.set({ modelKey: trimmed });
  return trimmed;
}

export async function readModelConfig(storage: StorageAreaLike) {
  const cfg = await storage.get(['modelEndpoint', 'modelName', 'modelKey']);
  const storedEndpoint = isString(cfg.modelEndpoint) ? cfg.modelEndpoint.trim() : '';
  const storedModel = isString(cfg.modelName) ? cfg.modelName.trim() : '';
  const endpoint = storedEndpoint ? storedEndpoint : DEFAULT_PROVIDER.endpoint;
  const model = storedModel ? storedModel : DEFAULT_PROVIDER.defaultModel;
  const key = isString(cfg.modelKey) ? cfg.modelKey.trim() : '';
  const missing = [];
  if (!endpoint) missing.push('endpoint');
  if (!model) missing.push('model');
  if (!key) missing.push('key');
  if (missing.length > 0) {
    return { configured: false, code: 'MODEL_NOT_CONFIGURED', missing };
  }
  return { configured: true, endpoint, model, key };
}
