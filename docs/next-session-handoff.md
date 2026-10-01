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

- Branch `main`, tip `b2991b2`, pushed and in sync with `origin/main`.
- `npm test` **659/659**, `npm run check` ok (26 browser primitives, 88 runtime
  safety files, version 1.6.13). Pinned Deno 2.9.6 lint clean and 9/9
  per-function checks green. Browser harness green.
- All 8 CircleCI workflows green on `b2991b2`, combined status `success`.
- Remote holds exactly one branch, `main`.

## What happened most recently

1. **Enterprise Phase 5 (UI and docs) merged to `main`** as `629631d..b2991b2`.
   Shipped an Options page for bridge URL and log level, a single endpoint source
   per deploy unit, `docs/api.md`, `docs/runbook.md`, and a permissions rationale
   in `extension/README.md`.
2. **Accessibility structure checks and two documentation-truth locks added.**
   `tests/ui-accessibility.test.mjs`, `tests/device-status-truth.test.mjs`,
   `tests/source-scan.test.mjs`, `tests/helpers/source-scan.mjs`.
3. **Two audit-gated items specified but deliberately NOT implemented**:
   server-side device revoke (the popup Unpair action only clears local storage,
   so a copied device token stays valid until a human edits the row) and enforced
   data retention (no scheduler exists; `pg_cron` is not installed and nothing in
   the repository calls the cleanup RPCs). See
   `docs/audit-request-device-revoke-and-retention.md`.
4. **This context trimming** — this file and `docs/project-context.md` were
   rewritten short, with all prior content moved to `docs/context-archive.md`.

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

Nothing is in progress. Await an owner decision from the list above. If new work
is requested, branch from `main` and follow the session lifecycle rules in
`AGENTS.md`.

## Rules for the next session

- Verify the tree is clean and that `main` equals the recorded tip before the
  first write.
- Do not merge, promote, or sign anything without an explicit owner instruction.
- A claim in a commit message or a test comment is not evidence. If it says
  something is locked, make the lock fail before you repeat it.
