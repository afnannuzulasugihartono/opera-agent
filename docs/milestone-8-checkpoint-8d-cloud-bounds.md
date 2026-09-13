# Checkpoint 8D — bounded cloud quantitative continuation

2026-09-13. **Listed quantitative database probes PASS; 8D IN PROGRESS.**
No 8E, enforcement promotion or browser dispatch. Session began clean at
local/remote `2085fc40316407dfb83d408804ea7fe727c1eb46`.
Read the installation record for unchanged deployed host/migration/key facts.

## New actual evidence

`tests/postgres/transaction-cloud-bounds-8d.sql` executed on authorized project
`opera-agent` / `nenmkmtvjremqphfqnfw`. This opt-in SQL artifact changes no
runtime behavior or schema. It requires clean OFF, uses synthetic private
principals, a 10-second statement timeout/3-second lock timeout, no DDL or Auth
row mutation, and rolls back its temporary DARK and data atomically.

Eight grouped assertions completed:

1. Eight pending prepares accepted; ninth rejected without an extra run.
2. Cancellation releases pending capacity; replacement restores exactly eight
   active pending runs.
3. Prepare counter boundaries1–20 accepted;21 rejected without an extra run.
4. Commit counter boundaries1–10 accepted with exact replay spending no extra
   rate/slot;11 rejected and nonce/status advancement rolled back. Ten slots only.
5. Two distinct targets COMMITTING accepted; third rejected with nonce unconsumed.
6. Same device/tab with a changed target digest rejected; nonce stays unconsumed.
7. Syntactically valid synthetic token accepted at196608 bytes; same valid
   format at196609 bytes rejected with no run/rate residue for the rejected tenant.
8. Cleanup batch101 rejected.

Final response: completedGroups8, policyOFF, runs0, principals0, rates0. This is
privileged synthetic database testing, NOT genuine user approval, signed OAuth,
bound hosted preparation or hosted worker death. Concurrency here is a sequential
active-state limit test, not concurrent cloud contenders. Rate fixtures explicitly
pin synthetic counters/window to the current DB minute; no real minute rollover
claim. Existing native concurrent-session/recovery tests remain separate evidence.

## OAuth path discovery, not acceptance

Read-only metadata found two existing public clients named Opera Agent MCP
acceptance test, token_endpoint_auth_method=none, with registered callback
`http://127.0.0.1:6276/oauth/callback`. Example nonsecret client ID:
`8bf1ff0e-7088-4881-ba76-e36c672453c6`.
No OAuth client/scope/redirect was changed and no secret/session/token was read.
This removes the assumption that a new client registration must be necessary;
it does not prove current user ownership, a working listener, signed JWT validity
or runtime host admission. A reviewed bounded PKCE test harness and legitimate
manual login/connection consent are still needed. Never reuse connection consent
as consequential transaction approval (actual approval transport remains8F).

## Required closeout and remaining boundary

Independent initial post-probe review passed safety/cleanup but identified that
the first oversized fixture also violated token format. The corrected probe now
isolates the size boundary with valid-format positive/negative fixtures. One
intermediate corrected rerun failed closed because the positive toy principal
was missing; its transaction rolled back. Adding that synthetic principal made
the complete corrected probe pass. This was a test-fixture change, not a runtime fix.

Fresh local full suite239/239 (zero skips), focused native PostgreSQL/host/
identity/token suite44/44 (zero skips), `npm run check` and `git diff --check`
PASS. Independent final corrected-artifact review PASS; fresh read-only audit
confirms policyOFF, agent commit disabled, legacy gating false and all11 candidate
data tables empty. This supersedes the initial payload-evidence conditional verdict,
not overall8D acceptance. Final standard exact-head CI/Chromium/temporary-PR
closure must be verified; their final commit SHA and
results belong in the closed temporary PR evidence, not an assumed future PASS. Context
and handoff are included in the continuation commit, with no workflow changes.

Still open: actual signed OAuth/client/session revocation, bound hosted
prepare/status/cancel, actual hosted worker loss/reclaim/nonce durability,
concurrent cloud races and remaining full quantitative/retention/crypto coverage,
then independent overall8D acceptance. Do not declare these passed from the
eight grouped SQL assertions. No extension/MCP/host/migration/configuration/
signing/pairing change or browser action occurred in this continuation.
