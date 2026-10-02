# Opera Agent next-session handoff

> **Scope:** what just happened and what to do next. Nothing else.
> **Cap:** roughly 150 lines. Relocate detail into `docs/context-archive.md`
> instead of appending here. Durable traps live in `docs/project-context.md`.

## Current state (2026-10-03)

- `main` = `origin/main`, tree clean, `origin/main` is the only remote branch, and
  every merge was `--ff-only`. The **code head is `2facfa0`**; context-record
  commits sit on top of it and touch no runtime file, so read `git log --oneline
  -3` rather than expecting the code head to still be HEAD.
- Gate evidence on `2facfa0`: `npm test` **781/781**, `npm run check` ok (26
  primitives, 93 runtime safety files), **8 of 9 check-runs green** —
  `ci-audit`, `ci-browser`, `ci-deno-check`, `ci-deno-install`, `ci-deno-lint`,
  `ci-sbom`, `ci-secrets`, `ci-unit`. **SonarCloud Code Analysis is `cancelled`,
  not green** — verified pre-existing on `5fe91aa`, caused by missing project
  access. Never describe a head as fully green.
- Commits after `a9af637`: `57cfa7b` restore `opera_run_fast`, `b0f14ed` extend
  AGENTS.md rule 6, `2facfa0` install the karpathy-guidelines skill, then this
  context record.

## Production database — measured, not assumed

The six pending migrations are **applied**. Verified by query against
`supabase_migrations.schema_migrations`, not by reading the repo:

- **48 migrations** recorded, last `20261004090000`. **0 pending**, 0 name
  divergence, so `supabase db push` will not re-apply anything.
- `opera_claim_next_wait(text,text,text,integer,jsonb,integer)` **exists** — it
  did not before 2026-10-03.
- `opera_run_fast` present again, so the drop/restore pair in
  `20261003110000` + `20261004090000` round-tripped cleanly.
- Workflows live: `media.sample_at` v1, `youtube.play_recommendation` v3,
  `youtube.get_transcript` v5. 58 `opera_*` functions in `public`.

**The ordering hazard is closed.** Deploying the bridge is no longer blocked on
a migration. It is still blocked on the audit below.

## Deploy gate — unchanged and still binding

Phase D changes real input handling and debugger attach, so it needs an
**independent audit and live browser acceptance** before any deployment. Neither
has happened, and an agent cannot self-certify either one.

## Incoming change: Opera removed, Brave next, rename planned

Owner has uninstalled Opera and is moving to Brave. A rename so the product
matches a Chromium-based browser is planned. Treat this as known, not started:

- **The rename is a production migration, not a rename.** The `opera_` prefix is
  load-bearing in the database: **58 `opera_*` functions** in production, plus
  tables and every RPC name the bridge and MCP call. Repo-side surface is
  256 files, ~1982 `opera_*` identifiers and ~572 `Opera` strings, concentrated
  in `supabase/migrations`, `tests`, and `docs`.
- **A digest freeze will block the first edit.** `tests/fixtures/*.json` pin
  `sourceSha256` for `opera-agent-mcp/index.ts` and `extension/background.js`,
  and `tests/helpers/boundary-locks.mjs` pins them by blob SHA.
  `tests/repo-naming-governance.test.mjs` also allowlists root entries.
- **Nothing has been tested on Brave.** `ci-browser` drives Chrome via Puppeteer.
  Brave is Chromium so MV3 loads, but Shields, `chrome.debugger`, and
  cross-extension messaging behaviour are unverified. Prior browser evidence was
  gathered against Opera and no longer applies.
- Sequence matters: verify on Brave first, then rename, then re-freeze digests.
  Renaming before the Brave check would make a Brave regression indistinguishable
  from a rename regression.

## Do not touch

- **`stash@{0}` — "preserve accidental 8E files before completing checkpoint 8D"**,
  on `feat/semantic-runtime-1.6.0`. Do **not** pop, apply, delete, or build from
  it. 8E is paused and must not start implicitly.
- `archive/*` tags, `docs/releases/`, and existing sections of
  `docs/context-archive.md` are historical; never rewrite them.

## Still open

1. **Independent audit** of Phase D and Phase C's public MCP surface.
2. **Live browser acceptance** — now against Brave, and it must actually run.
3. **Release so the shipped CRX contains the Options page.** The manifest in
   `main` registers `options_page`; the installed build predates it. Needs the
   private signing key.
4. **Remove the unused `activeTab` permission.** Verified unused, held out of
   scope because it touches the extension's declared surface.
5. **SonarCloud project access** — the pre-existing New Code wall.
6. **Publishable-key rotation** — a production secret, deliberately untouched.

## Unfinished code work, all needing an owner instruction

- An **optimistic `ensureContent`** — `content.ping` per call is redundant in the
  normal case and costs 2 IPCs, two or three times per action. A behaviour
  change, so it needs its own before/after measurement.
- The **gateway's redundant `last_seen_at` re-read**: four HTTP round trips per
  command where three would do.
- A **navigation action inside a burst**. Phase D let a step *address* a tab but
  did not add `navigate` to the burst vocabulary.
- **Unmeasured, and the largest unknown:** how many model round trips a real task
  actually costs. Every latency figure in this repo is a deterministic model of
  the server and extension path, not an observation of the model loop.

## Credentials left open by the 2026-10-03 session

Three Supabase PATs need owner action; none can be revoked programmatically —
there is no Management API for PATs.

- Two tokens were **printed into this session's transcript** by a PowerShell
  alias collision and are burned. One is confirmed still live.
- A third live PAT sits in plaintext in `~/.config/kilo/kilo.jsonc` plus two
  `.bak` copies, scoped to two projects. It was never in the transcript.
- A fourth token is the active one, correctly scoped to `opera-agent` alone.
- The repo and its history are clean: 1017 files scanned, no `sbp_` anywhere, and
  `.kilo/` and `.superpowers/` are untracked.

## Exact next action

**Await owner instruction.** Nothing is in progress; the tree is clean and
pushed. The migration blocker is resolved, so the next real step is
commissioning the audit and running live browser acceptance against Brave.

## Rules for the next session

- Before the first write, verify the tree is clean and `HEAD` equals the tip you
  are on.
- Do not merge, promote, sign, rename, or deploy without an explicit owner
  instruction.
- A claim in a commit message or a test comment is not evidence. Make the lock
  fail before you repeat it.
- Relocate detail into `docs/context-archive.md` once it stops being actionable
  rather than appending it here; this file has a 150-line cap.