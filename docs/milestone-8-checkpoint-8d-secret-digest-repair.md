# Checkpoint 8D Management secret digest integration repair

2026-09-14. Test-only repair; overall 8D IN PROGRESS, 8E not started.

## Observed failure, not a hypothetical gate

Installation/pin commit f8c42c225d3a3bf57e570a6d8cb21a81415263af received
independent PASS and standard CI34806580639 SUCCESS. The existing reviewed
acceptance CLI was then attempted with the bounded master switch enabled.
It exited CLOUD_PREFLIGHT_FAILED before emitting an OAuth URL or installing any
fixture. The enclosing PowerShell finally restored the master switch to false.
Fresh DB evidence: epoch0, owner/namespace/lease null, hostEnabled=false, policy
OFF, principals0 and runs0. Authenticated CLI output, inspected only in memory,
confirmed both selected secret values are 64-character lowercase hex digests;
the restored master value equals SHA-256 of the literal false. No secret or key
value was printed or saved. A first hash comparison used unavailable .NET methods
in Windows PowerShell; corrected SHA256.Create/ComputeHash established the match.

The runner previously compared a digest against plaintext true and attempted
to decode the transaction-key digest as a key. Unit doubles returned unrealistic
plaintext. This is a fail-closed availability defect, not evidence of a bypass.
Independent review confirmed the contract using official Supabase CLI
[handler](https://raw.githubusercontent.com/supabase/cli/develop/apps/cli/src/commands/secrets/list/list.handler.ts)
and [formatter](https://raw.githubusercontent.com/supabase/cli/develop/apps/cli/src/commands/secrets/secrets.format.ts).

## Bounded repair

The fixed-project test backend accepts only unique, valid secret digests and
requires the master digest to equal SHA-256(true). It never retrieves or decodes
the private transaction key. The existing public anon JWT is selected uniquely
from the fixed Management API; parsed api_key fields are cleared immediately.
A GET to the exact pinned transaction Edge must return exactly HTTP405 with
METHOD_NOT_ALLOWED and browserDispatchAllowed=false. Requests are bounded10s,
no redirects, response bytes bounded2048. No POST, fixture, approval, browser
dispatch or OAuth identity is involved in that health check.

The reviewed Edge decodes its configured 32-byte key before registering its
enabled handler, making this successful-startup evidence, NOT crypto tamper or
roundtrip evidence. Wrong/missing/duplicate public key, malformed digest, wrong
status/body, extra fields or startup failure refuse acceptance. No Edge, schema,
bundle pin, public MCP, extension, signing or pairing bytes changed.

Tests first: realistic secret-digest doubles exposed two failing tests against
the original implementation. After repair, the backend/controller/live-runner
focused suite is26/26 PASS, zero skips; Deno CLI check PASS. A test URL substring
incorrectly counted api.supabase.com as a project request; corrected to exact
hostname equality. Independent implementation review and exact-head CI are
required before the next enabled acceptance attempt. Full default suite after
repair315/315 PASS, zero skips; static1.6.0/26 and whitespace PASS. Independent
read-only implementation review returned PASS on this frozen worktree delta:
affected backend/controller/static/live29/29, check/diff, oversized response,
redirect failure, pre-abort and midstream-abort hostile checks all passed. The
reviewer hit its usage limit before reporting a final commit binding; this is
worktree-delta review evidence, not a claim of a completed exact-SHA review.
Exact-head CI and final independent overall8D acceptance remain required.

## Remaining acceptance scope

The frozen plan requires safely reclaimable worker death, durable one-shot nonce,
and cancel/expiry survival; it does not specify killing a Supabase Edge isolate.
The smallest proposed fresh durability harness is actual bounded Node child
worker death against hosted PostgreSQL, natural database lease expiry, independent
reclaim and stale-epoch rejection. Describe that evidence exactly; never call it
Edge-isolate termination. This is a read-only planning clarification, not a gate
waiver or an implemented/passed harness. Final independent acceptance must
reconcile historical handoff wording explicitly.

Still open: fresh signed OAuth/server-session acceptance, reviewed revocation
disposition, fresh concurrent hosted matrix/minute rollover, durability/nonce,
bounded payload/retention evidence mapping, final OFF/zero/advisors and independent
overall8D acceptance. The current prepare/replay/status/cancel runner alone is
insufficient. No8E until8D is accepted.
