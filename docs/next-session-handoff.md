# Opera Agent next-session handoff

> **Scope:** what just happened and what to do next. Nothing else. **Cap:** roughly
> 150 lines; relocate detail into `docs/context-archive.md` rather than appending
> here. Durable traps live in `docs/project-context.md`.

## Current state (2026-10-03)

- `main` = `origin/main`, tree clean, `origin/main` is the only remote branch, and
  every merge was `--ff-only`. The **code head is `2facfa0`**; context-record
  commits sit on top of it and touch no runtime file, so read `git log --oneline
  -3` rather than expecting the code head to still be HEAD.
- Gate evidence: `npm run check` ok (26 primitives, 93 files, **1.6.14**) and
  **8 of 9 check-runs green** — `ci-audit`, `ci-browser`, `ci-deno-check`,
  `ci-deno-install`, `ci-deno-lint`, `ci-sbom`, `ci-secrets`, `ci-unit`.
  **SonarCloud Code Analysis is `cancelled`, not green** — verified pre-existing
  on `5fe91aa`, missing project access. Never describe a head as fully green.
  Suite is 797/797. Browser harness exit 0 on Brave headless against the bumped
  tree, version asserts included.
- Commits after `a9af637`: `57cfa7b` restore `opera_run_fast`, `b0f14ed` extend
  rule 6, `2facfa0` karpathy skill, `4a79713` machine audit, `c3fa582` audit fix,
  `f313d66` 1.6.14 sweep, then context records.

## Production database — measured, not assumed

The six pending migrations are **applied**, verified by query against
`supabase_migrations.schema_migrations` rather than by reading the repo:

- **48 migrations** recorded, last `20261004090000`. **0 pending**, 0 name
  divergence, so `supabase db push` will not re-apply anything.
- `opera_claim_next_wait(text,text,text,integer,jsonb,integer)` **exists**; it did
  not before 2026-10-03. `opera_run_fast` is present again, so the drop/restore
  pair in `20261003110000` + `20261004090000` round-tripped cleanly.
- Workflows live: `media.sample_at` v1, `youtube.play_recommendation` v3,
  `youtube.get_transcript` v5. 58 `opera_*` functions in `public`.

**The ordering hazard is closed.** The bridge is no longer blocked on a migration.

## Deploy gate — machine audit done, findings fixed, 2026-10-03

Live acceptance is done: Brave, headless and headed, both exit 0. The audit the
owner first waived was then performed by a machine instead, per the rule change
below — a separate, read-only session that did not write the code, given the head
and the `5fe91aa..main` range. Verdict: **CONDITIONAL PASS**, with two findings,
both fixed in `c3fa582`:

- The `BURST_CROSS_TAB_REF` fence missed consume-on-active-tab; the check now
  compares the source step's recorded tab via a pure helper pinned both ways.
- The MCP schema rejected the per-step `tabId` the extension executes; all nine
  step kinds accept it now, strictness kept. Phase D is reachable from the tool.

`tests/browser_extension_test.py` ran twice against Brave with structurally
identical results, and `ci-browser` runs that same file under `xvfb`, so local
runs are the same suite with a different binary. Production verified by query:
48 migrations, 0 pending, `opera_claim_next_wait` present. That is evidence, not
review of live production behavior, which no audit here exercised.

`AGENTS.md` now requires a machine audit by default (Codex permitted, not
mandated) and a recorded waiver with residual risk. Pinned by
`tests/machine-audit-policy.test.mjs`, proven to fail on 8 violations.

**Deployed 2026-10-03:** bridge v31→v32, MCP v36→v37, both ACTIVE (CLI v2.119.0).
Smoke `browser.ping` on the new claim-wait path: 366ms total / 85ms queued,
device on 1.6.13 with all 26 capabilities.
**Bridge v32→v33 same-code redeploy:** serving isolate wedged (401 on authed paths, direct SQL fine); probe proved it, redeploy cleared it, probe removed.

## Incoming change: Opera removed, Brave next, rename planned

Owner has uninstalled Opera and is moving to Brave. A rename to match a
Chromium-based browser is planned. Known, not started:

- **The rename is a production migration, not a rename.** The `opera_` prefix is
  load-bearing in the database: **58 `opera_*` functions** in production, plus
  tables and every RPC name the bridge and MCP call. Repo-side surface is
  256 files, ~1982 `opera_*` identifiers and ~572 `Opera` strings, concentrated
  in `supabase/migrations`, `tests`, and `docs`.
- **A digest freeze will block the first edit.** `tests/fixtures/*.json` pin
  `sourceSha256` for `opera-agent-mcp/index.ts` and `extension/background.js`, and
  `tests/helpers/boundary-locks.mjs` pins them by blob SHA.
- **Brave is verified** — see the deploy gate above. Still unverified there: the
  production backend, and Brave Shields against real sites.
- Sequence matters: verify on Brave first, then rename, then re-freeze digests, or a
  Brave regression becomes indistinguishable from a rename regression.

## Do not touch

- **`stash@{0}` — "preserve accidental 8E files before completing checkpoint 8D"**,
  on `feat/semantic-runtime-1.6.0`. Do **not** pop, apply, delete, or build from it.
  8E is paused and must not start implicitly.
- `archive/*` tags, `docs/releases/`, and existing `docs/context-archive.md`
  sections are historical; never rewrite them.

## Still open

1. **Three burned Supabase tokens — revoked 2026-10-03.** One scoped token
   remains, verified `opera-agent` only.
2. **Three debris edge functions — deleted 2026-10-03** via the Management API
   (`local-opera-agent-final`, `opera-clipboard-test`, `opera-agent-update-v2`;
   the last documented as experimental in `docs/releases/experimental-v2.md`).
   Production holds 9 functions, all with repo counterparts.
3. **Release so the shipped CRX contains the Options page.** The manifest in
   `main` registers `options_page`; the installed build predates it. Needs the
   private signing key.
4. **Remove the unused `activeTab` permission.** Verified unused; held out of scope
   because it touches the extension's declared surface.
5. **SonarCloud project access** — the pre-existing New Code wall.
6. **Publishable-key rotation** — a production secret, untouched.

## Unfinished code work, all needing an owner instruction

- An **optimistic `ensureContent`** — `content.ping` per call is redundant in the
  normal case and costs 2 IPCs, two or three times per action. A behaviour change,
  so it needs its own before/after measurement.
- The **gateway's redundant `last_seen_at` re-read**: four HTTP round trips per
  command where three would do.
- A **navigation action inside a burst**. Phase D let a step *address* a tab but did
  not add `navigate` to the burst vocabulary.
- **Unmeasured, and the largest unknown:** how many model round trips a real task
  actually costs. Every latency figure in this repo is a deterministic model of
  the server and extension path, not an observation of the model loop.

## Credentials left open by the 2026-10-03 session

Three Supabase PATs need owner action. **None can be revoked programmatically —
there is no Management API for PATs**, so nothing further is possible from here.

- Two were **printed into this session's transcript** by a PowerShell alias
  collision. Burned. One is confirmed still live.
- A third sat in plaintext in `~/.config/kilo/kilo.jsonc` plus two `.bak` copies,
  scoped to two projects. **Cleaned:** the `--access-token` flag and its value
  removed, both `.bak` files deleted, backups kept outside the repo. Kilo's
  Supabase MCP will not start until reconfigured — a loud failure, not a silent one.
- A fourth is active and correctly scoped to `opera-agent` alone.
- The repo and its history are clean: 1017 files scanned, no `sbp_` anywhere, and
  `.kilo/` and `.superpowers/` are untracked.

## Exact next action

**1.6.14 ACTIVATED (owner-ordered).** Flip dua-statement transaksional (indeks
parsial menolak single-UPDATE). Tepat satu baris aktif per identitas; update.xml
sajikan 1.6.14; CRX tersaji 89.287 byte sha `6e038bb2…` = DB = disk; path 1.6.13
404. Rollback = flip yang sama ke 1.6.13 (baris utuh).
**Gateway v3 deployed:** offline-check folded into auth (4→3 trip, migrasi
`20261004120000`, 49 migrasi). Health 200. Smoke penuh menunggu command AI
pertama (butuh device token, hanya di extension).

## Rules for the next session

- Before the first write, verify the tree is clean and `HEAD` is the tip you are on.
- Do not merge, promote, sign, rename, or deploy without an explicit owner
  instruction.
- A claim in a commit message or a test comment is not evidence. Make the lock fail before you repeat it.
- Relocate detail into `docs/context-archive.md` once it stops being actionable rather than appending it here.