# Releases

Detailed release notes are stored in this directory. Release documents are historical records: once a release is published, its release note should only receive factual corrections, not be rewritten to describe newer behavior.

## Stable Opera Agent line

- [1.0.0](1.0.0.md) — first clean Opera Agent release.
- [1.0.1](1.0.1.md) — durable completion/two-phase command fix and verified same-ID signed update.
- [1.1.0](1.1.0.md) — new-signing-identity candidate: text-only reads, pointer groundwork, 23 primitives retained.
- [1.1.1](1.1.1.md) — first signed production update under the new identity; generic `page.pointer` input.
- [1.2.0](1.2.0.md) — bounded same-tab action bursts through one relay command.
- [1.3.0](1.3.0.md) — invisible-coordinate input candidate; superseded by 1.3.1 after CDP-focus issues on Maps.
- [1.3.1](1.3.1.md) — stable background CDP input with bounded page-focus emulation and no real tab activation.
- [1.4.0](1.4.0.md) — bounded adaptive screenshots with native ChatGPT image delivery and background-focus preservation.
- [1.5.0](1.5.0.md) — generic vision-navigation observability and deterministic nested scrolling with an unchanged MCP tool inventory.
- [1.5.1](1.5.1.md) — professional responsive popup while preserving extension identity, pairing, protocol, and capability inventory.
- [1.5.2](1.5.2.md) — popup intrinsic-width correction that prevents scrollbar-width collapse in Opera.
- [1.6.0](1.6.0.md) — semantic identity, bounded deltas, generic materialized views, causal invalidation, and scoped completion evidence.
- [1.6.1](1.6.1.md) — unique exact-actionable find candidate; deactivated after failing the R8 live Skip path.
- [1.6.2](1.6.2.md) — same-identity forward rollback carrying accepted 1.6.0 behavior.
- [1.6.3](1.6.3.md) — bounded R8 explicit-limit and viewport-truth repair; signed and uploaded to the release registry inactive.

## 1.6.4–1.6.13

Per-version notes were not written for the r8 checkpoint line; these releases
shipped exclusively through the private signed-update service and are
recorded per checkpoint in `docs/project-context.md` and the
`docs/pre-8e-performance-usability-r*.md` evidence families. Activation
sequence (owner-ordered, from the records): 1.6.6 (2026-09-23, ETW watch
line), then 1.6.7, 1.6.9, and 1.6.10 (2026-09-24), and **1.6.13
(2026-09-29, current production)**. `1.6.11` remains an uploaded-inactive
candidate and `1.6.12` source was never packed as a signed CRX; superseded
rows stay intact as rollback targets.

Future stable releases should use simple SemVer filenames:

```text
1.1.0.md
1.1.1.md
2.0.0.md
```

Each stable extension release should have a matching changelog entry, GitHub Release, signed CRX/hash evidence, and acceptance record. Server-side workflow revisions do **not** retroactively change an extension release document.

## Superseded release candidates

- [1.3.0](1.3.0.md) — background CDP input and no-focus execution, retaining protocol 1 and the established signing identity.
- [1.1.1](1.1.1.md) — generic pointer input for dynamic and canvas-based interfaces, retaining protocol 1 and the new signing identity.
- [1.1.0](1.1.0.md) — protocol-1 generic efficiency candidate with a deliberately separate signing identity; manual installation and fresh pairing are required.

## Unreleased experiments

- [Experimental v2 local-plan work](experimental-v2.md) — `browser.plan`/v2 workflow experiment preserved for history and quarantined because stable extension 1.0.1 does not advertise or implement the method.

An experiment is not a release. It must not be added to the stable SemVer line until the matching extension artifact is signed with the established identity and passes acceptance.

## Legacy Local Opera Agent archive

The pre-rebuild versions remain available as historical/fallback documentation and are not renamed into the new SemVer line:

- [Legacy Final 1](legacy-final1.md)
- [Legacy Final 2](legacy-final2.md)

Legacy Final 2 remains a fallback until it is explicitly retired. New development must not silently mutate its tables/functions in order to optimize Opera Agent.
