@last-edited: 2026-10-22 UTC+7.
@related: [`README.md`](README.md) - [`docs/handoff.md`](docs/handoff.md) - [`docs/releases/`](docs/releases/)

# Changelog

What each release contained, and why. The notes live in
[`docs/releases/`](docs/releases/) and are written when the release ships.

| Release | Date | Notes |
| --- | --- | --- |
| 1.6.27 | 2026-10-15 | [the local loop tells the truth about itself](docs/releases/1.6.27.md) |
| 1.6.24 | 2026-10-11 | [notes](docs/releases/1.6.24.md) |
| 1.6.23 | 2026-10-11 | [notes](docs/releases/1.6.23.md) |
| 1.6.22 | 2026-10-10 | [notes](docs/releases/1.6.22.md) |

The version in [`extension/manifest.json`](extension/manifest.json) is the source
of truth, and `npm run check` fails if the extension, the MCP server, the store
form and this file disagree about it.

Two versions have no note here: **1.6.25** and **1.6.26** reached the update
service but were never tagged and never got a GitHub Release. The gap is recorded
in [`docs/handoff.md`](docs/handoff.md) under what is still open, and it is a
real hole in the record rather than a formatting choice.
