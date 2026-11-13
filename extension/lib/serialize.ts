// @last-edited: 2026-11-08 UTC+7.
// @title: serialize — bound and memoize a command result before it crosses the wire.
// @state: owns the single memo that executeCommand clears per command and the result budget derived from the frame budget; chrome-free, so it lives in lib/.
// @dependencies: socket-protocol.js.

import { FRAME_MAX_BYTES } from './socket-protocol.js';

// The result budget is the frame budget less room for the command envelope, so one number moves the whole chain.

const RESULT_ENVELOPE_BYTES = 256 * 1024;
const RESULT_BUDGET_BYTES = FRAME_MAX_BYTES - RESULT_ENVELOPE_BYTES;
export { RESULT_ENVELOPE_BYTES };

function boundedResult(value: unknown) {
  const text = serializeResult(value);
  if (text.length > RESULT_BUDGET_BYTES) {
    throw new Error(`Result exceeds ${RESULT_BUDGET_BYTES} bytes. Use bounded/chunked reads.`);
  }
  return value;
}

function oversized(value: unknown) {
  return serializeResult(value).length > RESULT_BUDGET_BYTES;
}

let serializedResult: { value: unknown; text: string } = { value: null, text: '' };

function serializeResult(value: unknown) {
  if (serializedResult.value === value) return serializedResult.text;
  let text: string;
  try { text = JSON.stringify(value); } catch { throw new Error('Result is not serializable.'); }
  serializedResult = { value, text };
  return text;
}

function clearSerializedResult() {

  serializedResult = { value: null, text: '' };
}

// The cut is found by halving, because a longer prefix only ever serializes longer, and stringifying every prefix is that work squared.

function fitWithinBudget(elements: unknown, budget: unknown) {
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
  RESULT_BUDGET_BYTES,
  boundedResult,
  oversized,
  fitWithinBudget,
  clearSerializedResult,
};
