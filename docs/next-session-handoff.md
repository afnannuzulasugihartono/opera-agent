# Opera Agent next-session handoff

> **Scope:** what just happened and what to do next. Nothing else.
> **Cap:** keep this file under roughly 150 lines. When a session's detail is no
> longer actionable, move it to `docs/context-archive.md` rather than appending
> here. This file grew to 67 sections and 135 KB before that rule existed, and
> both context files were read at the start of every task.
>
> Durable facts — the ones that must never be lost — live in
> `docs/project-context.md`. Historical detail lives in `docs/context-archive.md`.

## Current state (2026-10-02)

- `main` and `origin/main` are both at `b2991b2`, green. That is the baseline
  this work forked from.
- The one active work branch is `chore/trim-context-docs`. **Its head is the
  branch tip — resolve it with `git log -1` and compare against
  `origin/chore/trim-context-docs` before the next write.** Do not assume
  `b2991b2`; the repo's pre-write rule requires HEAD to match this record, and
  after the merge both advance together.
- Baseline gate evidence at `b2991b2`: `npm test` **659/659**, `npm run check`
  ok (26 browser primitives, 88 runtime safety files, version 1.6.13), pinned
  Deno 2.9.6 lint clean and 9/9 per-function checks green, browser harness green,
  all 8 CircleCI workflows green.
- Before this trim the remote held exactly one branch, `main`. `main` must not lag
  an accepted CI-green head by more than one closed checkpoint.

## Do not touch

- **`stash@{0}` — "preserve accidental 8E files before completing checkpoint 8D"**,
  on `feat/semantic-runtime-1.6.0`. Do **not** pop, apply, delete, or build from
  it. Inspect it only against canonical Milestone 8E scope if 8E ever resumes.
  8E is paused and must not start implicitly.
- `archive/*` tags and `docs/releases/` are historical records; do not rewrite.

## What happened most recently

1. **Enterprise Phase 5 (UI and docs) merged to `main`** as `eef35e5..41a2ae7`.
   Shipped an Options page for bridge URL and log level, a single endpoint source
   per deploy unit, `docs/api.md`, `docs/runbook.md`, and a permissions rationale
   in `extension/README.md`.
2. **Accessibility structure checks and two documentation-truth locks added** in
   `629631d..b2991b2`, together with
   `docs/audit-request-device-revoke-and-retention.md`. Two audit-gated items are
   specified there but deliberately **not implemented**: server-side device revoke
   (the popup Unpair action only clears local storage, so a copied device token
   stays valid until a human edits the row) and enforced data retention (no
   scheduler exists; `pg_cron` is not installed and nothing in the repository
   calls the cleanup RPCs).
3. **This context trimming** — this file and `docs/project-context.md` were
   rewritten short, with all prior content relocated to
   `docs/context-archive.md`.

## Awaiting an owner decision

None of these is blocked on engineering work:

1. **Release so the shipped CRX contains the Options page.** The manifest in
   `main` registers `options_page`, but the installed CRX predates it, so users do
   not have the page yet. Requires the private signing key.
2. **Remove the unused `activeTab` manifest permission.** Verified unused; held
   out of scope because it touches the manifest, which is the extension's
   declared surface.
3. **Commission the audit** that `docs/audit-request-device-revoke-and-retention.md`
   asks for.
4. **SonarCloud project access** — the pre-existing C Reliability wall on New Code
   cannot be investigated without it.
5. **Publishable-key rotation** — a production secret, deliberately untouched.

## Exact next action

`chore/trim-context-docs` is complete and awaiting its closeout:

1. Confirm all 8 CircleCI workflows are green on the branch tip.
2. Fast-forward `main` onto this branch with `--ff-only` and push.
3. Create `archive/chore/trim-context-docs` at the merged head, then delete the
   remote track branch.
4. Then there is nothing in progress. Await an owner decision from the list above.

## Rules for the next session

- Before the first write, verify the tree is clean and that `HEAD` equals the
  branch tip you are on. Do not assume `main` is the baseline; resolve the current
  branch with `git branch --show-current` and its tip with `git log -1`.
- Do not merge, promote, or sign anything without an explicit owner instruction.
- A claim in a commit message or a test comment is not evidence. If it says
  something is locked, make the lock fail before you repeat it.
