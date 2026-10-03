# Changelog

Related: [AGENTS.md](AGENTS.md) rules - [HANDOFF.md](docs/HANDOFF.md) - [api.md](docs/api.md)

Notable changes. Semantic versioning.

- Per-checkpoint release history is in git history for versions below this line.
- `docs/api.md` is the contract reference; `docs/HANDOFF.md` holds
  what shipped and when.

## [1.6.15] - 2026-10-03

Latency and capability work on the 1.6.14 line. **Source only** — activation is
an explicit owner decision, never implied by CI.

- **Burst `navigate` step** — tenth burst kind, mapped onto the existing
  `tabs.navigate`; primitive count stays 26. Post-navigate refs refused with
  `BURST_STALE_REF`. Per-step `tabId` on all ten kinds makes cross-tab bursts
  reachable from `run_browser_burst`.
- **Optimistic `contentCall`** — the command goes out before any ensure step, so
  the normal case costs one sendMessage instead of tabs.get + ping + send. A
  page-bridge refusal (`ok:false`) is an answer, not a transport failure, and
  never triggers re-injection.
- **Gateway offline-check folded into auth** — 4 trips to 3, behavior kept.
- **Version sweep** 1.6.14 → 1.6.15 across protocol, manifest, package, and
  every version pin. Required, not cosmetic: update checks compare version
  numbers, so a same-version repack would never propagate.

## [1.6.14] - 2026-10-03

Machine-audit repair of the 1.6.13 line. **Source only.**

- **Burst cross-tab ref fence closed** — `runBurst` refused a `refFromStep` only
  when the consuming step itself switched tabs, so a step staying on the
  already-active tab could consume a ref minted elsewhere. The check now
  compares the source step's recorded tab via pure helper `burstCrossTabRef`,
  pinned behaviorally in both directions. Same error code, same 26 primitives.
