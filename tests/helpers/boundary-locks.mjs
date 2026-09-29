// Frozen public-boundary locks shared by the P2/P3/P4/P5 checkpoint tests.
// Each entry is the git-blob SHA1 (LF-normalized) of a runtime source whose
// public contract is frozen: U-P1 (2026-09-24) authorizes the accessibility
// observation layer: shadow-piercing collection + computed accessible names in
// content.js, the poverty-triggered CDP axSummary in background.js, MCP
// guidance text, and the 1.6.13 version sweep. U-R (2026-09-28) then authorizes
// timeout/retry/popup parity: an unknown-outcome command timeout in
// background.js, expect-polling and fill retry parity in content.js, the
// popup/openedTabs log, MCP OAuth/openedTabs guidance, and the 1.6.13 version
// sweep. U-Sonar (2026-09-29) authorizes the new-code reliability sweep:
// explicit code-unit sort comparators (order byte-identical, frozen digests
// unchanged) and the ZWJ split in the content.js PUA strip class (same
// code-point set), while the byte-pinned 8D transaction bundle libs and the
// boundary-locked reactive-vm-7d then-field stay byte-identical (false-positive,
// resolved in Sonar). Protocol 1, 26 primitives, 22 tools, and the read_page
// input schema remain frozen.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'f4d15ef55bd68131cff98598328b2ba8d648cc3e'],
  ['../extension/background.js', '4eabbd940898538cd211885b8890e05c9ee4fc25'],
  ['../extension/manifest.json', 'e69324b7c2abb194d15459d55eddd3a838c04e53'],
  ['../supabase/functions/opera-agent-mcp/index.ts', '825651427a13ab3d6d2c404b07f62001fa672c71'],
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'e035d282b642c7fb0dfe687e034ec200072da991'],
  ['../lib/reactive-vm-7c.js', '2e5f63f2c5d7c0ee2341c5a88a407783ae4523f4'],
  ['../lib/reactive-vm-7d.js', 'f08445f142d001aeb45b40a4d1a77fd6d2c7b6c8'],
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance-p3.js', '97ef64a69a1e77d1617c426cbb38407145b6327f'],
  ['../lib/delta-first-observation-p2.js', '5335e1d09a8b8357a2fb20ecb30f1908c3c7d7e3'],
]);
