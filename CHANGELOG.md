# Changelog

Simplify first. State what is true now, never its history.

Related: [AGENTS.md](AGENTS.md) rules - [HANDOFF.md](docs/HANDOFF.md) - [api.md](docs/api.md)

Notable changes. Semantic versioning.

- Release history for versions below this line is in git history.
- `[docs/api.md](docs/api.md)` is the contract reference; `[docs/HANDOFF.md](docs/HANDOFF.md)` holds
  what shipped and when.

## [Unreleased]

Shipped to `main` after 1.6.15. Source only — cutting a release is an owner decision,
never implied by CI green.

- **The observation reports the user's current state.** `page.read` carries
  `userState`: `tabActive`, `windowFocused`, `watching`, and `lastInputMs`. An agent
  cannot choose foreground over background, or decide whether it may interrupt,
  without knowing whether the person is there.
- **The pointer cursor stays visible.** It dims to 0.3 after 2.5s idle instead of
  disappearing, so an owner returning to the tab can see where an unattended run
  stopped. Solid means working, faint means stopped.
- **`page.fill` requires a string `value`.** A misspelled parameter used to dispatch an
  empty fill, which pressed Backspace in the field and still answered `ok: true`. An
  explicit `""` remains legal, because clearing a field is a real intent.
- **Named `generic` accessibility nodes are kept.** Maps and YouTube label their
  controls `generic`, and the summary discarded the role outright. Maps went from 89
  characters with no named controls to 60 named nodes.
- **The MCP text stopped claiming a background pointer is invisible.** Three places
  said so, and it is false: the cursor is drawn in both modes. A model reading it would
  conclude it could not watch a run it is not present for.
- **CI can no longer be blocked forever by one hung job.** Every job has a timeout and
  superseded runs are cancelled. CI acceptance is still unobtainable on this machine
  because the python.org installer hangs; see `[docs/HANDOFF.md](docs/HANDOFF.md)`.

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
