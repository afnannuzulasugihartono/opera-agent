# Checkpoint 8D — local hosted-acceptance controller

2026-09-14. Bounded LOCAL continuation from
`0b40b13d6715ae108d8ff1a2cd1b4f5b0ad77e00`. Overall 8D IN PROGRESS; 8E not started.
No login, operator enrollment, production query/mutation, host enablement,
deployment, signing/extension/MCP change or browser action this session.

## Implemented boundary

`tests/helpers/transaction-cloud-controller-8d.mjs` implements the in-process
acceptance sequence against trusted injected operator/SDK/fetch adapters. It is
not imported by production and ships no real operator transport or live CLI.
Positive SDK, session-binding and operator checks below are unit doubles, NOT
cryptographic or cloud acceptance evidence.

The future CLI must await `ready` before advertising OAuth. Preflight requires
fixed-namespace absence, exact reviewed locks, host false, policy OFF, ledger
enabled and agent/legacy flags false. Missing/unknown configuration rejects.
Adapter functions and primitive configuration are captured from trusted test
code, never supplied through HTTP/MCP/page/model arguments.

Each controller permits one run. It snapshots SDK-verified issuer/audience/role/
OAuth client/subject/session/iat/exp before getUser, rejects anonymous/mismatched
users and rechecks expiry/cancellation across async operations. The synthetic
fixture uses a UUID namespace, separate actor/goal/transaction/device/document,
tab0 and observation at prepare time. User/session IDs never enter public results.

After durable ownership acknowledgement, dirty marking precedes installation
so unknown/partial installation must be cleaned. Only an explicit server session-
binding acknowledgement permits ledger sealing/host enablement/DARK transition.
No approval/finalize/executor/browser operation is routed.

Only the fixed installed host URL is used, with no redirects, public publishable
key plus transient user bearer and 32KiB response bound. Request sequence:

`prepare -> exact prepare replay -> status -> cancel -> cancel replay -> status`

Each response must contain the exact seven metadata fields, expected transaction,
canonical tx1 commit key, allowed lease/transition integers and dispatch=false.
Prepare/status stay PREPARED epoch0/transition0, replay advances nothing; cancel
and its replay/status stay CANCELLED epoch1/transition1. A separate trusted
operator check must confirm cancelled state and zero payload before removal.
The absent diagnostic marker and 200/null case are not used.

After any potentially partial install, finally independently attempts all four
cleanup operations: disable host, set OFF, exact-owned fixture cleanup, verify
clean. Cleanup signals do not inherit an expired/cancelled bearer. Any failed
cleanup or dirty/unknown verification record refuses PASS. Public results expose
only the existing whitelisted booleans/HTTP status; errors are fixed redacted codes.
Clearing the local bearer reference is not a zeroization claim.

## Deadline correction and limits

Earlier OAuth helper gave the trusted workflow the same ten-second signal as
token exchange and user lookup. That would expire during a multi-request operator
workflow. A tests-first correction keeps the five-minute attempt/workflow deadline
and creates a separate ten-second signal for EACH OAuth HTTP request. Owner close
still aborts them all; helper result whitelist and fixed PKCE routing unchanged.
Controller work signal is bounded60s; HTTP requests and individual cleanup adapter
signals10s. These signals are cooperative contracts, not a guarantee that arbitrary
injected SDK/operator doubles settle. No Promise.race lets a late mutation complete
after cleanup. Real adapters must implement deadline wiring and abort/quiescence.

There is NO durable supervisor or real ownership manifest implementation here.
`recordOwnership.recorded=true` is an adapter obligation, not proof of persistence.
Likewise `locksVerified`, `sessionBound` and cleanup acknowledgements do not prove
actual database/session/global-control fencing. Hard process death is NOT covered
by JavaScript finally. Do not connect this controller to production until a reviewed
operator transport plus global-control lease/supervisor/recovery passes its tests.

## Evidence and next bounded work

Missing module failed before implementation; first controller run exposed an
inconsistent adapter call signature, corrected before focused PASS. New OAuth
deadline regression failed with the original shared ten-second request signal.
Final focused controller/fixture/OAuth/identity/listener36/36 zero skips PASS.
Actual pinned SDK malformed-token Deno1/1 without network and existing opt-in
SDK CLI typecheck PASS. Neither is a new legitimate OAuth/cloud positive test.
Final full275/275 zero skips (52.437s), static and whitespace PASS. Exact-head
standard CI/Chromium and temporary validation PR closure must be verified from
GitHub artifacts; no claim of CI on an uncommitted/future head.

Independent refrozen LOCAL-only PASS reran focused36/36, Deno1/1, CLI typecheck,
static and whitespace. This supersedes initial conditional hostile-test review,
not overall8D acceptance. Controller SHA-256:
`3466936ada2eb5f8bcef9b68b7a6c1cccd1365b36d25727c7fd54c7782f4fe67`.

Next unit: implement fixed-project internal operator transport, insert-only
provisioning with actual existing Auth session checks, existing ledger crypto
sealing, exact cleanup SQL, exclusive global control ownership and durable parent/
manifest recovery. Test cancellation, lost replies, child death and cleanup before
asking for fresh manual OAuth. No stored-token extraction or new public API.
Exact-runner independent PASS remains required before any login/live enablement.

Extension1.6.0/protocol1/capabilities26/publicMCP18 unchanged. No CRX/update/reconnect.
Prior native45/45 evidence belongs to the fixture session; not rerun this session.
Existing OFF/clean production state is inherited, not freshly verified here.

Platform checked: Supabase changelog (OAuth success status change uses response.ok;
unrelated self-hosted SAML/logs changes do not apply), current
[getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims) and
[getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
