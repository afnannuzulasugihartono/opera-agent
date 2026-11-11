@last-edited: 2026-11-09 UTC+7.
@related: [`README.md`](README.md) - [`docs/handoff.md`](docs/handoff.md) - [`docs/releases/`](docs/releases/)

# Changelog

What each release contained, and why. The notes live in
[`docs/releases/`](docs/releases/) and are written when the release ships.

| Release | Date | Notes |
| --- | --- | --- |
| 1.6.37 | 2026-11-11 | [the dashboard tells the truth, and a device knows which browser it is](docs/releases/1.6.37.md) |
| 1.6.36 | 2026-11-09 | [one browser, one device, even when the extension is removed and installed again](docs/releases/1.6.36.md) |
| 1.6.35 | 2026-11-09 | [the plan you are on is visible before it runs out, and the dashboard says so](docs/releases/1.6.35.md) |
| 1.6.34 | 2026-11-09 | [the local bridge retries once its socket drops](docs/releases/1.6.34.md) |
| 1.6.33 | 2026-11-09 | [no websocket at a dead bridge, and the second browser keeps its name](docs/releases/1.6.33.md) |
| 1.6.32 | 2026-11-09 | [the everyday browser names itself to the meter](docs/releases/1.6.32.md) |
| 1.6.31 | 2026-11-09 | [a second browser is a device, not a rejection](docs/releases/1.6.31.md) |
| 1.6.30 | 2026-11-09 | [a full-page capture that comes back in time to be read](docs/releases/1.6.30.md) |
| 1.6.29 | 2026-11-08 | [a full-page capture that survives the whole document](docs/releases/1.6.29.md) |
| 1.6.28 | 2026-11-08 | [the whole page in one answer, and a worker that says what broke](docs/releases/1.6.28.md) |
| 1.6.27 | 2026-10-15 | [the local loop tells the truth about itself](docs/releases/1.6.27.md) |
| 1.6.26 | 2026-10-25 | [the bridge link stops going silently deaf](docs/releases/1.6.26.md) |
| 1.6.25 | 2026-10-25 | [the product stopped asking the network on the hot path](docs/releases/1.6.25.md) |
| 1.6.24 | 2026-10-11 | [notes](docs/releases/1.6.24.md) |
| 1.6.23 | 2026-10-11 | [notes](docs/releases/1.6.23.md) |
| 1.6.22 | 2026-10-10 | [notes](docs/releases/1.6.22.md) |

The version in [`extension/manifest.json`](extension/manifest.json) is the source
of truth, and `npm run check` fails if the extension, the MCP server, the store
form and this file disagree about it.

Two versions in that table never reached the release page: **1.6.25** and **1.6.26**
were tagged on 2026-10-25 and exist as draft releases, with their notes in
[`docs/releases/`](docs/releases/). They were never published; the update service
is what served them. That is a real gap in the record, not a formatting choice.
