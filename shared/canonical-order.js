// @last-edited: 2026-10-21 UTC+7.
// @title: canonical-order — the code-unit ordering every digest sorts by.
// @state: one comparator for the edge and the extension, so a digest is byte-identical on both sides.
// @dependencies: none.

// Shared canonical code-unit ordering for deterministic digests and exact validation strings.
// Array.prototype.sort() without a comparator is the default UTF-16 code-unit order, which is locale-stable but flagged as ambiguous by the S2871 rule; this comparator encodes that exact order explicitly so sorting is provably byte-identical to the default while satisfying static analysis.

export function codeUnitCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
