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

let serializedResult = {
  value: null,
  text: ''
};

function serializeResult(value) {
  if (serializedResult.value === value) return serializedResult.text;
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new Error('Result is not serializable.');
  }
  serializedResult = {
    value,
    text
  };
  return text;
}

function clearSerializedResult() {
  serializedResult = {
    value: null,
    text: ''
  };
}

export {
  MAX_RESULT_BYTES,
  boundedResult,
  oversized,
  clearSerializedResult,
};
