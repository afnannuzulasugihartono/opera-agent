# Checkpoint 8D — test-only manual OAuth probe prerequisite

2026-09-14. **Local prerequisite, not overall8D acceptance.** No8E.
Started clean at local archive-only5d5fe79055262215454e2a0b47d34ab903a9812e;
remote8305992ec42ac275bf98a788721ab8aa8e7cb0d6. TemporaryPR35 now confirmed
closed without merge, after successful standardCI34764182875 at8305992.

## Scope and evidence boundary

New code lives only in tests/helpers and tests/cloud. Production runtime,
extension/MCP, migration/deployment/configuration, signing and pairing unchanged.
No actual login, production listener, Auth/session mutation, browser action or
Supabase database probe performed. Existing OFF/clean facts are prior-session
evidence, not a fresh production assertion from this turn.

The opt-in helper fixes the existing issuer, public acceptance client and registered
callback127.0.0.1:6276/oauth/callback. It uses cryptographic state/verifier and
S256, one attempt, exact/duplicate/unknown callback-field checks, five-minute
expiry, ten-second exchange timeout,32KiB response/16KiB token bounds, no redirects,
refresh, storage, token export or credential logs. Tokens stay process-memory-only;
clearing references is not a guarantee of cryptographic memory zeroization.
Only a successful Auth user-endpoint response becomes a boolean. No JWT claim
is decoded as authority, and no user/client/session host admission or transaction
approval is inferred. The token is discarded; a separately reviewed host probe
will need an in-process adapter, never a pasted or persisted bearer token.

Manual listener binds loopback, checks method/Host/Origin/path, expires, refuses
occupied ports without an alternate, and flushes its static response before close.
Factory physical-port/window injection is test-only; CLI exposes no override.
CLI SIGINT/SIGTERM cleanup is inspected, not independently signal-tested.

TDD missing-module/missing-export failures observed before implementation.
Initial reviewer reproduced duplicate callbacks aborting the active owner; fixed
to reject duplicates without abort. Explicit close/expiry still fail closed.
An HTTP fixture initially failed because Node fetch ignored its test Host override;
native node:http fixture corrected that, not the production Host guard.
Final focused helper/listener tests12/12 PASS with zero skips. They use synthetic
fetch doubles and actual ephemeral loopback HTTP, never live OAuth network.
Fresh final full-suite251/251 (zero skips), static/diff checks PASS. Independent
refrozen test-only helper/listener review PASS, rerun12/12 zero skips; supersedes
its earlier conditional verdict. Signal wrapper remains inspection-only.
Final exact-head CI results must be verified. Record final CI/SHA in the closed
temporary validation PR, without claiming an assumed future PASS here.

## Opt-in manual procedure (not executed this turn)

After independent local review, supply ONLY this project's public publishable key
through OPERA_8D_PUBLISHABLE_KEY, then:

```powershell
node tests/cloud/transaction-oauth-login-8d.mjs
```

Open the temporary authorization URL manually in Opera. Enter credentials only
on the trusted first-party OAuth consent page, never chat/terminal/test fixtures.
Connection consent is not8F consequential approval. Listener stops after success,
denial/exchange failure, interruption or five minutes; no background service.
Do not change scopes/client/redirect/runtime config to make the probe pass.
Success only proves live Auth user-endpoint authentication, not full8D acceptance.

## Remaining8D

### Actual manual login follow-up —2026-09-14

Reviewed helper at55751a2987cdae0ca550a457d3e06e7f08790f8b used with this
project's existing enabled public publishable key and unchanged registered client/
callback. User completed normal OAuth connection login/consent. Process returned
`{"userEndpointVerified":true,"browserDispatchAllowed":false}`, exited0,
and a subsequent Windows listener lookup found no listener on6276. User screenshot
also shows the static connection-test success response. No bearer/code/verifier,
password, user ID or private key persisted/exported. Ordinary OAuth may retain
its connection session server-side; no claim that all Auth sessions were purged.

This proves actual authorization-code/PKCE exchange and Auth user-endpoint
success, not client/session binding or revocation through the deployed8D host,
transaction approval, bound hosted preparation or hosted recovery. Probe discards
the token on completion; do not recover it from browser/storage for the next step.
Next unit requires a reviewed in-process host adapter followed by another legitimate
manual OAuth flow, so the host can validate fresh credentials without exporting them.
No runtime/config/database policy/browser dispatch change. Prior policyOFF check
was before login; this helper never changes policy. No post-login DB cleanup claim.
Standard exact-headCI34784559085 on55751a2 PASS (unit/static+Chromium),
temporaryPR36 closed without merge. This follow-up is documentation-only.

Real signed OAuth/trusted client/session binding and revocation at deployed host;
bound hosted prepare/status/cancel using authenticated server-installed synthetic
bindings; hosted worker loss/reclaim and nonce durability; concurrent cloud races,
remaining quantitative/retention/crypto gates; final independent overall audit,
advisors/OFF/cleanup and complete8D acceptance. Do not start8E from this record.

Current platform checked: Supabase changelog and
[official OAuth flow documentation](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows).
No relevant change invalidates the authorization-code/S256/exact-redirect request;
HTTP success is checked with response.ok, not a hardcoded201.
