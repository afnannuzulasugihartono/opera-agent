# Pre-8E Performance Usability Repair — R3 Evidence

Status: **R3 IMPLEMENTED / GATES GREEN — STOPPED FOR R3 ACCEPTANCE. R4 NOT AUTHORIZED**

Date: 2026-09-19

Branch: `feat/pre-8e-usability-repair-r3`

R2 accepted closeout base:
`f468230986101f09880ce1e38cf69b705570c507`

R3 runtime evidence head (last runtime change):
`285374f20ef1592d16246fe1e53ab4c9d8b8da81` — CircleCI SUCCESS + Vercel SUCCESS

R3 governance/synchronization head:
`5b5ed172770e5b1ce6bc428c84902d48762ce8bf` — CircleCI SUCCESS + Vercel SUCCESS

## Scope

R3 implements only T017–T020 bounded local act + verify.

R4 compact model-facing observation is not implemented. Protocol 1, the 26
allowlisted browser primitives, the 18 public MCP tool names/input schemas,
background-first behavior, canonical semantic state/delta authority, VM
enablement, transaction authority, production schema/deployment, Milestone 8E,
and the preserved accidental 8E stash remain outside this checkpoint.

## T017 — tests-first red evidence

Tests-only head:
`e2d99a1ca83710adbaeb0e0beb1fd2c24280cdc9`

Controlled fixture `tests/fixtures/pre-8e-usability-r3.html` covers:

- a button that mutates itself on click (text change, `aria-pressed=true`,
  companion status output);
- a button that removes itself on click.

`tests/browser_extension_test.py` added the R3 acceptance assertions: both the
synthetic `page.click` path and the trusted click-info path must return a
bounded `postAction` evidence block directly in the action result — the changed
target must report fresh present/`aria-pressed` evidence without a mandatory
full reread, and the removed target must report `present=false`.

CircleCI on the tests-first head failed as required (Vercel deployment
independently succeeded). This proved the pre-R3 runtime did not return
post-action evidence.

## T018/T019 — bounded post-action verification

Runtime head:
`860432260fdfdbc849831d88d7f338cc1c774341`

`extension/content.js` (with minimal `extension/background.js` plumbing) now
performs an inspect-only bounded settle/verification after a simple action and
returns fresh `postAction` evidence inside the same command result:

- bounded revision/reset metadata plus mutation/target evidence;
- no task-completion declaration — goal completion remains a controller
  decision;
- no mandatory full reread — the next observation continues from the canonical
  semantic UPDATE/RESET state machinery;
- no foreground takeover and no activation of the target tab.

T019 proof lives in the controlled-browser R3 acceptance assertions: a click
that changes its target returns fresh evidence (`present=true`, updated
`aria-pressed`), and a click that removes its target returns `present=false`
without a full reread and without stale-target revival.

## R3 failure chains (Evidence -> Research -> Regression Proof -> Minimal Repair -> Verification)

Every unexpected CI regression encountered during R3 was resolved through the
mandatory failure branch; each chain is recorded here and in the corresponding
commit:

1. `c7a914b9a800b31bcc8ad99086b17a919531c934` — a route reset could allow a
   stale ref to revive. Fix: route-key continuity guard inside the bounded
   recovery path; the four runtime hash locks were rebaselined for the
   authorized `extension/content.js` change.
2. `317d1fee1362a92261a0b183b1e853b9d6cf66ea` — reset evidence was not
   preserved for the next observation. Fix: preserve reset evidence in the
   post-action path and codify the Evidence-First Bug Repair Loop in
   `AGENTS.md`.
3. `9006dabe3bea46673909792b40657412c18c2f9f` — post-action verification
   risked bypassing canonical semantic delta authority. Fix: postAction is
   inspect-only; canonical UPDATE/RESET remains the semantic authority for the
   next observation.
4. `d2844d3b1b6fb9a3b574cb528dd1ba965486392f` — `page.read` compatibility
   regression. Fix: preserve read compatibility; authorized rebaseline of the
   four runtime lock constants.
5. `fe16f13c4620bc37ba30c0aca75aa7e0e82bd687` — runtime lock mechanism
   hardened: plain content SHA-1 locks replaced by git blob-hash locks so the
   committed-bytes contract is explicit.
6. `285374f20ef1592d16246fe1e53ab4c9d8b8da81` — post-action verification must
   not weaken the connected file-upload guard. Fix: explicit file-upload
   rejection preserved; sensitive stale-target revalidation still forbidden.
   CircleCI returned SUCCESS at this head.

CI was green from `285374f` onward, including the governance/synchronization
head `5b5ed17`.

### Local Windows CRLF hash-lock chain (2026-09-19)

- **Evidence**: local full suite on this Windows machine returned 419/423 with
  exactly four `sha1Blob` frozen-byte lock failures: `extension/content.js`
  (P2 test), `lib/delta-first-observation-p2.js` (P3 test),
  `lib/multi-signal-relevance-p3.js` (P4 test),
  `lib/event-driven-local-execution-p4.js` (P5 test). The same head was green
  in CI, so no runtime drift existed.
- **Research**: the lock constants are git blob hashes of the committed LF
  bytes. This clone uses `core.autocrlf=true` and the repository has no
  `.gitattributes`, so text files are checked out with CRLF; the helpers
  hashed raw worktree bytes instead of committed bytes.
- **Regression proof**: deterministic node reproduction — raw (CRLF) bytes
  hash to `bf73795ca6cb19a17af5c1634f2394cda34f1f2e` (the local "actual"),
  CRLF→LF-normalized bytes hash to `508201e936d8540f0ab4b07854cb841834c531ad`
  (the lock constant, equal to `git hash-object` of the committed blob).
- **Minimal repair**: normalize CRLF→LF inside the four `sha1Blob` helpers
  (test-only change; no runtime file touched; lock constants unchanged and
  assertions remain byte-exact against committed content).
- **Verification**: focused regression 65/65 PASS; full local suite 423/423
  PASS; `npm run check` PASS.

## T020 — gate results

- Local full suite: **423/423 PASS** (0 fail, 0 skipped).
- Local `npm run check`: **PASS** — 26 allowlisted browser primitives,
  version 1.6.0.
- Browser gate (Playwright/Chromium controlled extension regression including
  the R3 acceptance assertions) runs in CI on this operator path:
  **CircleCI SUCCESS + Vercel SUCCESS** at `285374f` and `5b5ed17`. The local
  browser gate is not executable on this machine (no Python toolchain); CI is
  the canonical browser evidence, consistent with R0–R2 practice.

## Invariants

Diff from the R2 accepted base to the R3 runtime head changes runtime only in
`extension/background.js` and `extension/content.js`; it does not modify
`extension/lib/protocol.js`, `extension/manifest.json`, or any
`supabase/` source. Current exact-head inventory read from source and locked
by the frozen-byte tests:

- Protocol version: **1**;
- allowlisted browser primitives: **26**;
- public MCP tools: **18** (MCP source byte-identical to the accepted R2 base);
- background-first behavior and the file-upload/sensitive-value guards
  preserved;
- `milestone7_vm_enabled=false` unchanged; VM tables untouched.

## Closeout

Spec/plan/tasks, roadmap, project context, handoff, and constitution converge
on the same boundary:

- R0–R2 ACCEPTED / CLOSED;
- R3 IMPLEMENTED / GATES GREEN — stopped for R3 acceptance;
- R4 NOT AUTHORIZED / NOT STARTED;
- Milestone 8E paused/not started;
- no implicit checkpoint advancement.

STOP after R3. Do not start R4 or Milestone 8E without a new explicit user
instruction.
