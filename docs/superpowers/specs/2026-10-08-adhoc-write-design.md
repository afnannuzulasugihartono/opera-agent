@last-edited: 2026-10-08 UTC+7.
@related: [`AGENTS.md`](../../../AGENTS.md) - [`../uec-north-star.md`](../../uec-north-star.md) - [`../../handoff.md`](../../handoff.md)

# Spec: ad-hoc write execution via ephemeral workflows

One-off write tasks on arbitrary sites, no new executor. Approved in chat 2026-10-08.

## Intent

A one-off multi-step write task (fill, ordinary clicks, verify) runs end to end
without pre-registering a named workflow. Success: a hand-written ad-hoc graph
`find -> fill -> click -> verify` completes on an arbitrary page through the
proven runner path, and no trace of it remains afterwards (explicit delete on
success, lease expiry plus sweeper otherwise). No new browser primitive, no new
step vocabulary, no per-site extension code, no free `eval`.

## Non-goals

No VM write phase, no second branching executor in the extension, no offline
device-only execution, no new queue transport, no secrets in definitions.

## Architecture

An ad-hoc write graph is compiled device-locally into an ordinary workflow
definition using only the runner's existing vocabulary (command, if, set,
repeat, verify). It registers under a temporary name `adhoc.<uuid>`, runs
through `opera_start_workflow` plus device claim exactly like a registered
workflow, then deletes — explicitly by the caller on success, automatically by
lease expiry plus a sweeper otherwise.

## Components and lifecycle

Three pieces. (1) Ad-hoc compiler (pure, in `lib/`): validates allowed write
methods — fill, key, ordinary clicks; submit, pay, and delete are refused
unless an explicit confirmation flag is present — and emits a runner-shaped
definition. (2) Ephemeral registration: RPC `opera_register_ephemeral_workflow`
(name `adhoc.<uuid>`, `lease_until`, input definition) plus deletion of the
temporary row; one workflow per requestId, so retries are idempotent, with a
per-tenant quota and a maximum lease (one hour). (3) Sweeper: a scheduled
database routine deleting only expired `adhoc.*` rows plus their runs, never
permanent workflows.

## Data flow and error handling

Model or operator composes a graph -> compiler validates (allowed methods,
target proven by a prior read or find, budgets) -> ephemeral registration ->
`opera_start_workflow` -> device executes through the existing
observe-act-verify-recover pipeline -> structured result plus honest status ->
workflow deleted (success) or left for lease expiry (failure or timeout).
Failed verification runs recovery first (fresh re-query, bounded retry);
exhausted budget stops with an honest partial status naming which nodes passed.
The sweeper is idempotent and prefix-scoped.

## Testing

All in `npm test`, no live fleet: compiler pins (allowed methods pass;
submit, pay, and delete refused without the confirmation flag; non-allowlisted
methods refused); naming pins (`adhoc.<uuid>`, duplicate requestId yields the
same row, never a second); lease pins (lease written, bounded by the maximum;
sweeper deletes only expired rows and only the `adhoc.` prefix); honesty pins
(a failed run still reports per-node pass and fail). One integration test: the
hand-written `find -> fill -> click -> verify` graph completes and its
temporary row is gone.

## Security

Ephemeral RPCs follow the repo pattern (EXECUTE-only grants, owner RLS,
tenant taken from the caller). Explicit confirmation for consequential actions
(submit, pay, delete) is recorded in the workflow definition so it stays
auditable. Temporary definitions never carry secrets. The repo's existing
blocks (passwords, OTP, uploads, publish, purchase, send, delete without
explicit instruction) apply unchanged; the confirmation flag is how explicit
instruction travels with the graph.
