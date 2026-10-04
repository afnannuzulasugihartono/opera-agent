// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: canonical-order — Shared pure module, server and extension..
// @context: Shared pure module, server and extension.
// @state: Shared pure module, server and extension..
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

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
