// Last edited: 2026-10-04 17:52. Title: canonical-order — Shared canonical code-unit ordering for deterministic digests and exact Now: refactor(quality): centralize code-unit comparator in lib/canonical-order.js - removes token-identical inline comparator blocks that tripped.

// Shared canonical code-unit ordering for deterministic digests and exact
// validation strings. Array.prototype.sort() without a comparator is the
// default UTF-16 code-unit order, which is locale-stable but flagged as
// ambiguous by the S2871 rule; this comparator encodes that exact order
// explicitly so sorting is provably byte-identical to the default while
// satisfying static analysis.
export function codeUnitCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
