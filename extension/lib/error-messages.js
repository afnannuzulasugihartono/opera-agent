// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: error-messages — messages — User-facing error mapping for the popup and options page (page lang `en`).
// @state: lock store error strings against mapper drift.
// @dependencies: none.

// User-facing error mapping for the popup and options page (page lang `en`).
//
// Background-supplied strings can carry raw internals (fetch TypeErrors,
// `HTTP <status>`, gateway `data.error`, chrome tab errors, truncated
// `lastError` payloads). Only exact static source strings are mapped; every
// dynamic, unknown, or token-shaped input falls back to GENERIC so raw
// internals never reach the popup label. The two options-page keys below are
// client-side settings validation literals thrown by `lib/options-store.js`
// (static, authored here, safe to surface), not backend internals.

const KNOWN = new Map([
  ['Pairing failed.', 'Pairing failed. Check the code and try again.'],
  ['Unable to update tab privacy.', 'Could not update this tab. Try reloading the page.'],
  ['Invalid pairing code.', 'That pairing code is invalid. Check the code and try again.'],
  ['Invalid tabId.', 'Could not update this tab. Try reloading the page.'],
  ['Invalid bridge URL.', 'The bridge address is invalid. Check the address and try again.'],
  [
    'Enter an https:// URL or leave empty to reset.',
    'Enter an https:// address, or leave the field empty to use the default bridge.',
  ],
  [
    'Log level must be debug, warn, or error.',
    'Choose a log level: debug, warn, or error.',
  ],
  [
    'Enter an https:// URL for the model endpoint, or a loopback http:// address for a local model.',
    'Enter an https:// address for the model endpoint, or a loopback http:// address if the model runs on this machine.',
  ],
  [
    'Enter a model name of 1 to 120 characters.',
    'Enter the model name your provider uses, up to 120 characters.',
  ],
]);

const GENERIC = 'Something went wrong. Run self-test, then check the connection.';

export function userErrorMessage(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (KNOWN.has(text)) return KNOWN.get(text);
  return GENERIC;
}
