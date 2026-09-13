# Checkpoint8D — in-process signed-identity/status adapter prerequisite

2026-09-14. Local test-only continuation on cleancfb0e59; overall8D IN PROGRESS.
No8E, actual login, host flag/policy change, principal enrollment, DB mutation,
new deployment, MCP/extension/signing change or browser dispatch this turn.

## Implemented boundary

Opt-in Deno CLI uses existing pinned Supabase SDK2.57.4 and the fixed project,
public client and callback. Trusted local hook receives the fresh OAuth bearer
only in-process after user-endpoint verification; no token export/storage/logging.
It validates SDK getClaims, immutable primitive claim snapshot, exact issuer/
authenticated audience and role/client, UUID subject/session, times and getUser
subject/nonanonymous status. No decoded/self-reported claim becomes authority.

Only fixed POSTstatus/m8d_oauth_identity_probe is sent to installed8D host. No
private RPC, enrollment, prepare/cancel, logout or approval. Bodies bounded32KiB,
credential8192 chars, no redirects, shared abort/deadline plus10-second request
bound. Results whitelist booleans and HTTP status, no identity IDs or credentials.
hostDisabled means503TRANSACTION_DISABLED from HTTP/environment, NOT SQL policyOFF.
401AUTHENTICATION_REQUIRED means identity not admitted, not a positive auth gate.

Actual existing read_run raises TRANSACTION_NOT_FOUND for the absent marker,
which host maps to STORAGE_ERROR503. Therefore200/resultnull classification is
only a theoretical synthetic case, not a reachable positive acceptance scenario.
Do not change production host semantics just to make this test pass. A real
positive gate requires reviewed principal+bound prepared synthetic transaction
installation, with the request tied to that fixture. This adapter is currently a
diagnostic prerequisite; it cannot close trusted session/hosted prepare acceptance.

## Test/review evidence

Missing adapter module and missing hook behavior failed before implementation.
Initial Deno typecheck exposed an incomplete inferred JS option signature;
explicit JSDoc resolved it. Initial full run during fixture/whitelist changes was
255/256 (one failing hook assertion); corrected sorted whitelist has focusedPASS.
Reviewer identified mutable SDK claim reference across await; primitive snapshot
and expiry-mutation regression now protect it, matching production adapter.

Final focused OAuth/helper/listener/identity suite20/20 PASS, zero skips. SDK
positive cases there are synthetic doubles, not actual signature/live-host proof.
Actual pinned SDK malformed-token Deno test1/1 PASS without network permission;
opt-in SDK CLI Deno typecheckPASS. Final full259/259 zero skips, static/diff and
exact-refrozen independent local review PASS (reviewer20/20 and Deno1/1).
This supersedes the earlier snapshot conditional verdict, not overall8D acceptance.
Final exact-head standardCI/Chromium must be verified from final evidence.
No claim that these tests independently establish active Auth session or revocation.

## Next bounded unit

Before requesting another manual login, finish a reviewed integration design for
server-installed synthetic principal, existing Goal Ledger crypto authority,
immutable prepared source/target binding and safe fixture-specific status query.
Keep all credentials within one bounded process; never recover the discarded
bearer from storage or ask the user to paste it. Only after independent audit may
bounded host enablement/probes run; no ordinary agent/browser commit authority.
Positive host binding/revocation/prepare/recovery and overall8D remain open.

Diagnostic CLI (not executed this turn; no claim of positive host admission):

```powershell
deno run --config supabase/functions/opera-agent-transactions-8d/deno.json --allow-env=OPERA_8D_PUBLISHABLE_KEY --allow-net=127.0.0.1:6276,nenmkmtvjremqphfqnfw.supabase.co tests/cloud/transaction-oauth-host-status-8d.ts
```

Provide only existing public publishable key via environment; no new client/scope/
redirect/config/key. Earlier real PKCE user-endpoint success remains in the OAuth
probe record, distinct from current synthetic SDK/host tests. Final validation PR
holds exact finalSHA/CI/closure evidence; do not infer them from this document.

Platform checked: Supabase changelog,
[getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims),
[getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
