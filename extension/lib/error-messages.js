// User-facing error mapping for the popup (page lang `en`).
//
// Background-supplied strings can carry raw internals (fetch TypeErrors,
// `HTTP <status>`, gateway `data.error`, chrome tab errors, truncated
// `lastError` payloads). Only exact static source strings are mapped; every
// dynamic, unknown, or token-shaped input falls back to GENERIC so raw
// internals never reach the popup label.
const KNOWN = new Map([
  ['Pairing failed.', 'Pairing failed. Check the code and try again.'],
  ['Unable to update tab privacy.', 'Could not update this tab. Try reloading the page.'],
  ['Invalid pairing code.', 'That pairing code is invalid. Check the code and try again.'],
  ['Invalid tabId.', 'Could not update this tab. Try reloading the page.'],
  ['Invalid bridge URL.', 'The bridge address is invalid. Check the address and try again.'],
]);

const GENERIC = 'Something went wrong. Run self-test, then check the connection.';

export function userErrorMessage(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (KNOWN.has(text)) return KNOWN.get(text);
  return GENERIC;
}
