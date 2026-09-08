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

## Legacy Local Opera Agent archive

The pre-rebuild versions remain available as historical/fallback documentation and are not renamed into the new SemVer line:

- [Legacy Final 1](legacy-final1.md)
- [Legacy Final 2](legacy-final2.md)

Legacy Final 2 remains a fallback until it is explicitly retired. New development must not silently mutate its tables/functions in order to optimize Opera Agent.
