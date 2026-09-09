# Releases

Detailed release notes are stored in this directory. Release documents are historical records: once a release is published, its release note should only receive factual corrections, not be rewritten to describe newer behavior.

## Stable Opera Agent line

- [1.0.0](1.0.0.md) — first clean Opera Agent release.
- [1.0.1](1.0.1.md) — durable completion/two-phase command fix and verified same-ID signed update.

Future stable releases should use simple SemVer filenames:

```text
1.1.0.md
1.1.1.md
2.0.0.md
```

Each stable extension release should have a matching changelog entry, GitHub Release, signed CRX/hash evidence, and acceptance record. Server-side workflow revisions do **not** retroactively change an extension release document.

## Prepared release candidates

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
