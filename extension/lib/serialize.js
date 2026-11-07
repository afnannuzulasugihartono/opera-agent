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

let serializedResult = { value: null, text: '' };

function serializeResult(value) {
  if (serializedResult.value === value) return serializedResult.text;
  let text;
  try { text = JSON.stringify(value); } catch { throw new Error('Result is not serializable.'); }
  serializedResult = { value, text };
  return text;
}

function clearSerializedResult() {

  serializedResult = { value: null, text: '' };
}

// The cut is found by halving, because a longer prefix only ever serializes longer, and stringifying every prefix is that work squared.

function fitWithinBudget(elements, budget) {
  const list = Array.isArray(elements) ? elements : [];
  const limit = Math.max(0, Number(budget) || 0);
  if (!list.length) return { elements: [], truncated: false };
  if (JSON.stringify(list).length <= limit) return { elements: list, truncated: false };
  if (JSON.stringify([]).length > limit) return { elements: [], truncated: true };
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (JSON.stringify(list.slice(0, mid)).length <= limit) low = mid;
    else high = mid - 1;
  }
  return { elements: list.slice(0, low), truncated: true };
}

export {
  MAX_RESULT_BYTES,
  boundedResult,
  oversized,
  fitWithinBudget,
  clearSerializedResult,
};
