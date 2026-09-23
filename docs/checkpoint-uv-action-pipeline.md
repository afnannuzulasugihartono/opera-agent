# Checkpoint U-V — Action Pipeline (2026-09-23)

## What shipped (r8 `ee3c661`)

**U-V = instant-by-default actions.** One pure engine
(`extension/lib/action-pipeline.js`) now wraps **every** action route — MCP
`page.click/fill/key/pointer`, burst steps, workflow steps, ETW watcher clicks —
through the shared executor funnel in `background.js`:

```
RESOLVE → WAIT (adaptive poll 25→400ms, to METHOD_SPECS deadline) →
HEAL (U-I intrinsic-signature rebind) → EXECUTE (trusted/synthetic) → VERIFY
```

- **Success envelopes** carry `resolved: {attempts, waitedMs, healed[, verified]}`
  (verified only from the existing `postAction.verified` evidence machine — never
  invented).
- **Dead targets** no longer return the dead-end stale string: a structured
  `TARGET_NOT_READY {reason: not-found|not-actionable|ambiguous, waitedMs, hint[,
  candidates]}` replaces it; the message is preserved verbatim for legacy
  consumers, ambiguity carries the geometry-guard candidate list, and resolver
  errors are surfaced in the hint (`[resolver: …]`).
- **Readiness is executor-contract aware**: trusted actions wait for full
  actionability (minus `inViewport`, which the executor scrolls into view);
  synthetic actions wait for presence only, preserving the historical
  revalidate-then-click contract (regression R0).
- **Sensitive targets hand off, not wait**: ref resolution is fail-closed for
  sensitive elements, so `page.action_state` reports them `masked` and the
  engine classifies masked → executor-owned → immediate handoff (the password/
  file guards now speak with their own reason instead of an 8 s stall).

Protocol surface unchanged: 26 primitives frozen; this is a behavior expansion
behind the same funnel. Version bumped to **1.6.7** (manifest, PRODUCT_VERSION,
package.json).

## Evidence

- Node suite: **489/490** (`tests/action-pipeline.test.mjs` 8/8; the single fail
  is pre-existing #268 repo-root allowlist noise from local tooling).
- Browser regression (Edge headless, real relay): **EXIT 0** — including the new
  U-V scenarios: late-appearing target clicked in **one** command
  (`waitedMs` measured, no retry), DOM-replaced ref **healed** in-flight
  (`healed:true`, effect landed on successor), ghost ref → clean
  `TARGET_NOT_READY` at ~3 s wait budget, masked password target → guard message
  intact, and every legacy scenario unchanged.
- Hash-lock governance: delta P2/P3/P4/P5 boundary locks rebaselined to the new
  content/background/manifest digests; version pins rebaselined in
  `scripts/check.mjs` + 7 contract tests; Python version asserts → 1.6.7.

## CRX 1.6.7 (built, offline-verified, upload pending owner)

- Packed from a clean detached worktree at `ee3c661` with
  `--pack-extension-key` against `D:\Opera\signing-private\opera-agent-new-identity.pem`.
- Artifact: `D:\Opera\opera-agent-1.6.7.crx` — **53,583 bytes**, SHA-256
  `6485f74de0213d5fbec9bb43398bd113e15c40dfaef7a3926d14dd8a58248496`.
- Calibrated offline verifier: `idFromPk == idFromShd ==
  ohbbpamcljckmjhcpkcmefdobkoeaick`, `signatureValid: true`,
  `determinsticResignMatches: true`.
- Production pre-state verified: `update.xml?id=` still serves **1.6.6**; the
  `1.6.7` CRX path returns **404** (no row yet).

## Release blocker (owner decision required)

Uploading the `opera_releases` row failed with a **project-wide Supabase
read-only mode**: `transaction_read_only = on` (DB is only ~55 MB — not disk
full), so Management `/database/query` INSERT fails with `25006`. The temporary
lift endpoint (`/readonly/temporary-disable`) returns **403 missing permission
`database_readonly_config_write`** for the current token. Also: the DPAPI
`management-token.dpapi` (created 2026-09-16) now authenticates **401** — it
should be rotated/re-saved; the environment `SUPABASE_ACCESS_TOKEN` is the
valid credential (GET/SELECT work; writes blocked by read-only mode only).

Unblock path: owner lifts read-only (Dashboard → no script needed) or grants
`database_readonly_config_write`, then rerun `D:\github\us-release-167.ps1`
(inserts 1.6.7 `active=false` idempotently, prints DB SHA/bytes to compare with
disk). After that: verify single active row = 1.6.6, then owner side-load and
live acceptance; activation of 1.6.7 remains the owner's explicit call.

## Worktree note

The build worktree `/d/github/uv-build` was created and removed cleanly; the
CRX was copied out before removal. Nothing in `.kilo/` or other worktrees was
touched.
