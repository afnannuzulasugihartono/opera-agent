// @last-edited: 2026-10-09 UTC+7.
// @title: serialize — bound and memoize a command result before it crosses the wire.
// @state: owns the single memo that executeCommand clears per command; chrome-free, so it lives in lib/.
// @dependencies: none.

const MAX_RESULT_BYTES = 512 * 1024;

function boundedResult(value) {
  const text = serializeResult(value);
  if (text.length > MAX_RESULT_BYTES) {
    throw new Error(`Result exceeds ${MAX_RESULT_BYTES} bytes. Use bounded/chunked reads.`);
  }
  return value;
}

function oversized(value) {
  return serializeResult(value).length > MAX_RESULT_BYTES;
}

// Single-entry memo for result serialization. page.read measures the result
// against the ceiling and the dispatcher then measures it again; without this,
// every read paid a second full JSON.stringify on the hottest observation path.
// Keyed on object identity, so a rebuilt result serializes exactly once, and
// cleared per command so nothing large is retained between commands.
let serializedResult = { value: null, text: '' };

function serializeResult(value) {
  if (serializedResult.value === value) return serializedResult.text;
  let text;
  try { text = JSON.stringify(value); } catch { throw new Error('Result is not serializable.'); }
  serializedResult = { value, text };
  return text;
}

function clearSerializedResult() {
  // Drop the memo so a large previous result is not pinned for the worker's
  // lifetime. Exported as a function because an imported binding is read-only.
  serializedResult = { value: null, text: '' };
}

export {
  MAX_RESULT_BYTES,
  boundedResult,
  oversized,
  serializeResult,
  clearSerializedResult,
};
