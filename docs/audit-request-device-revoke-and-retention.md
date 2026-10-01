# Audit request: server-side device revoke, and enforced data retention

Status: **SPECIFICATION ONLY — NOT IMPLEMENTED. Blocked pending an independent audit.**

Date: 2026-10-02
Branch at time of writing: `chore/followups-accessibility-and-doc-truths`
Author: controller session, on owner instruction to close the documented gaps

## Why this document exists

Two gaps were found during the Phase 5 closeout and reported to the owner. Both
were then explicitly approved for work. Both are nevertheless **not implemented**,
because both require a production database shape change, and `AGENTS.md` requires
an independent audit **before** production mutation when a change touches
authorization or production database shape. This document exists so the audit has
something concrete and falsifiable to review, rather than being asked to bless a
vague intention.

## Verified facts these designs rest on

Each was verified by reading the repository during this session. None is assumed.

1. **No source writes `status = 'disabled'`.** The only values ever assigned to
   `public.opera_devices.status` are `'online'`, at `…_core.sql:131` (pair upsert),
   `:148` (`opera_heartbeat`) and `:157`/` :176`. `disabled` exists only in the
   CHECK constraint (`…_core.sql:17`) and in read-side filters. This is now locked
   by `tests/device-status-truth.test.mjs`.
2. **`unpair()` is purely local.** `extension/background.js:1475-1480` bumps a loop
   generation and removes `paired`, `deviceToken`, `deviceId` from
   `chrome.storage.local`. It performs no network call.
3. **The extension reaches the database only through the bridge edge function.**
   `supabase/functions/opera-agent-bridge/index.ts` calls `opera_pair_device`,
   `opera_heartbeat`, `opera_claim_next`, `opera_complete_command`,
   `opera_watch_event_ingest`, `opera_start_workflow` via `supabase.rpc`. There is
   no direct RPC path from the extension.
4. **Pairing is authorised by the pairing code; the token is the credential
   stored afterwards.** The bridge validates the code's length (`bridge/index.ts:62`),
   hashes the presented token, and calls `opera_pair_device`, which rejects unless
   the code hash matches an unconsumed, unexpired row (`…_core.sql:127-128`) and
   then upserts on `(device_name)`. So the code is the authorisation, and the token
   is what the device is subsequently authenticated by. This distinction matters
   for Item 1: a revoke authenticated by token possession cannot be used by
   someone who has lost the token, which is exactly the case that may need it.
5. **There is no scheduler.** `pg_cron` is not among the installed extensions
   (only `pgcrypto` and `pg_net`); no `cron.schedule` call exists; `supabase/config.toml`
   has no cron block. `opera_goal_cleanup`, `opera_vm_cleanup` and `opera_vm_expire`
   have **no caller anywhere in the repository**.
6. **Retention is therefore currently aspirational.** Of roughly eleven data
   classes, only two have any purge routine at all, and neither is invoked
   automatically.

## Item 1 — Server-side device revoke (the Unpair gap)

### The problem, stated concretely

A user who clicks **Unpair** in the popup reasonably believes the device is
disconnected. It is not. The `opera_devices` row survives with a valid
`token_hash`, `status = 'online'`, and a `last_seen_at` that simply goes stale. Any
copy of that token — a backup, a shared machine, a stolen profile — continues to
authenticate until somebody manually edits the row. Because nothing in the
application can disable a device, the only remedy today is direct SQL by the owner.

### Proposed change, for review

1. **New SQL function** `public.opera_revoke_device(p_device_name text,
   p_token_hash text) returns jsonb`. Requirements for the reviewer to check:
   - MUST verify `token_hash` before mutating, so a caller cannot revoke another
     device's row by guessing a device name.
   - MUST set `status = 'disabled'` rather than `DELETE`, so the audit trail and
     the row's history survive. A delete would destroy the evidence that a revoke
     happened.
   - MUST be revoked from `public`, `anon`, `authenticated` and granted only to
     `service_role`. The existing pattern for a comparable function is the revoke
     list at `…_core.sql:218-226` with the grants at `:227-230`. Note that revoking
     is not universal in this database: several helpers are revoke-only, so the
     reviewer should decide the exact grant set rather than assume a precedent.
   - MUST write an `opera_audit` row, consistent with `opera_pair_device`
     (`…_core.sql:134`).
   - MUST be idempotent.
   - **Conflict to adjudicate:** `opera_pair_device` does not check `status`, so a
     re-pair currently resurrects a disabled row via `ON CONFLICT DO UPDATE SET
     status = 'online'` (`…_core.sql:131`). If revoke is implemented, should
     re-pairing remain able to undo a revoke? The current answer in the runbook is
     that it does, and that this is a side effect rather than a permission. This
     spec proposes **keeping** that behaviour, because changing it would break
     the documented recovery path for an operator who disabled a device by
     mistake. The reviewer should confirm or overrule.
2. **New bridge route** in `opera-agent-bridge/index.ts`, following the existing
   `pair` route's shape and validation. It must reuse the shared
   `_shared/cors.js` resolver and `_shared/edge-log.js` helper, must not echo the
   token, and must be added to the bridge's own method table and CORS headers.
3. **Extension change**: `unpair()` calls the bridge first, and only clears local
   storage after the server confirms. On network failure it must **tell the user
   the revoke did not happen** rather than silently appearing to succeed — the
   current silent-success behaviour is the actual harm.
4. **Migration safety**: a new migration must be additive only. It must not
   rewrite existing rows and must not alter the CHECK constraint.

### What the reviewer must rule on

- Whether `DELETE` versus `status = 'disabled'` is the correct semantic, given the
  audit requirement.
- Whether revoke should be token-authenticated (as proposed) or device-name-only.
  Token-authenticated is strictly safer but means a user who has lost the token
  cannot self-revoke — which is arguably exactly the case that needs it.
- Whether keeping re-pair able to undo a revoke is acceptable.
- Whether the extension's "revoke failed, local state kept" path is acceptable UX
  or needs a retry queue.

### Tests the implementation must add

- `opera_revoke_device` rejects a wrong token hash and leaves the row untouched.
- It is idempotent.
- It writes an audit row.
- It grants nothing to `anon`/`authenticated`.
- The bridge route rejects a missing/malformed token and a cross-device name.
- The extension clears local storage **only** on a confirmed revoke.
- **Update `tests/device-status-truth.test.mjs`**: it will now FAIL by design,
  because a write path will exist. That failure is the intended signal to reconcile
  `docs/runbook.md`, which must then say that revoke is possible and how an
  operator un-disables a device.

## Item 2 — Retention that is actually enforced

### The problem, stated concretely

`docs/runbook.md` documents a retention table of eleven data rows. Seven of them
say the purge is `manual`, because no routine exists for the class. Two name the
cleanup RPCs (`opera_goal_cleanup`, `opera_vm_cleanup`) and are honest that
nothing calls them. The remaining two are not repository concerns at all — edge
logs, which no repository artifact manages, and the in-memory log ring buffer,
which is discarded rather than stored. So **no data class is purged automatically
today**. For a project handling page content, command results and telemetry, that
is the most consequential of the documented gaps.

### Proposed change, for review

Three options, in ascending order of automation and of risk. The reviewer should
pick, or reject all three in favour of a documented manual procedure.

- **Option A — documented manual procedure only.** Write the exact `delete`
  statements per class into the runbook, marked untested, and have the owner run
  them on a schedule they define. Zero schema change. Does not make retention
  automatic.
- **Option B — a single idempotent purge function plus an external schedule.** One
  new `service_role` function that purges every expired class in one transaction
  and returns per-class counts, plus documented instructions to call it from a
  scheduler the owner operates (Supabase cron, a CI schedule, a cron job). One new
  function, no extension installation, owner-controlled schedule.
- **Option C — install `pg_cron` and schedule it in-database.** Fully automatic and
  needs no external runner, but installs an extension into production and puts a
  schedule inside the database, where it is invisible to the repository and to
  review. **This spec recommends against Option C** for that reason, and asks the
  reviewer to confirm or overrule.

No runbook correction is required before this audit, and a reviewer should not make
one. `docs/runbook.md` already states the situation accurately — that there is no
scheduler in the repository and that nothing calls the cleanup RPCs — so editing it
to "stop claiming an automated purge" would delete a correct warning rather than fix
a defect. The runbook only needs revisiting once a caller actually exists.

### Retention periods

The runbook deliberately proposes no numbers, on the grounds that the repository
does not imply them. That remains true. If the owner wants enforced retention,
they must supply the periods; this spec will not invent them.

### What the reviewer must rule on

- Option A, B, or C — and specifically whether `pg_cron` may be installed.
- Whether a single transaction across all classes is acceptable, or whether classes
  must be purged independently so one failure cannot block the rest.
- Whether `opera_audit` should ever be purged at all. Audit trails are usually
  retained longer than operational data, and the current table lumps it with
  command history.

## What is explicitly NOT requested

- Production deployment, promotion, or scheduling of anything in this document.
- Any change to the pairing flow, the token format, the bridge's CORS policy, or
  the MCP surface.
- Any period numbers for retention.
- Milestone 8E work.

## Recommendation to the owner

Do not treat either item as routine. Item 1 changes who can revoke a credential;
item 2 decides what happens to stored page content. Both deserve a real audit
before code is written, and both remain valuable precisely because they are
recorded precisely enough to be reviewed.
