# Checkpoint 8D — local operator ownership and recovery candidate

2026-09-14. Bounded LOCAL continuation from `85ec1befef26c295f301aa253f938b47ed62ffa3`.
Overall Checkpoint 8D remains IN PROGRESS; 8E has not started. This unit performs no
fresh OAuth login, production query/mutation, host enablement, policy change,
deployment, key access, extension/MCP/signing/pairing change, or browser action.

## Implemented boundary

`tests/helpers/transaction-cloud-operator-8d.mjs` adds the test-only fixed-project
operator boundary required by the hosted-acceptance controller. The public operator
surface remains exactly the controller's eleven methods; there is no generic SQL,
shell, command, callback, hook, arbitrary URL, or model/page supplied operation.
Project ref `nenmkmtvjremqphfqnfw`, the existing OAuth client ID, and loopback
callback `http://127.0.0.1:6276/oauth/callback` are pinned before any owned mutation.

A nonsecret file ownership store persists exact tenant/actor/goal/transaction
cleanup identifiers and phase only. It never stores bearer tokens, OAuth verifier,
user/session/client identity, ledger token, crypto key, or browser data. The store
uses one global-control lease plus a durable dirty manifest. A pending manifest
blocks a fresh run with `8D_RECOVERY_REQUIRED` until explicit recovery succeeds.
Lease expiry alone cannot steal control from a still-live local owner PID; a dead
owner plus expired lease may be reclaimed. PID reuse can therefore block recovery
fail-safe rather than create split-brain.

The operator enforces an internal phase machine:
`OWNED -> INSTALLED -> SEALED -> HOST_ENABLED -> DARK -> CLEANING`.
Host/policy/cleanup calls require durable ownership. Fixture installation must
match the exact recorded cleanup scope. The injected backend contract must report an exact existing server-session binding
before insert-only provisioning. The ledger scope must match the owned
tenant/goal before the injected existing crypto authority may seal it. This local
candidate does not itself resolve or store production credentials and does not
claim that the injected backend is a live cloud acceptance result.

Abort handling is quiescent: an awaited backend call is allowed to settle, then
abort is rechecked before the next operation; there is no timeout race that lets a
later insert begin after cleanup. A lost insert reply intentionally leaves durable
dirty ownership so a subsequent recovery removes the exact possible partial
install rather than guessing whether the insert happened.

Recovery first reclaims exclusive control, re-pins the target descriptor, writes
`CLEANING`, then attempts host disable and policy OFF. It will not delete fixture
rows if either control-plane safety step fails. Exact cleanup follows only after
both succeed. PASS requires host false, policy OFF, zero owned rows, zero payload,
`agentCommitEnabled=false`, and `legacyGated=false`. Failed/unknown recovery keeps
the dirty manifest and lease evidence; it is never silently declared clean.

## Tests and evidence

New focused test file: `tests/transaction-cloud-operator-8d.test.mjs`.
Writer-local isolated run: **14/14 PASS, zero skips**. It covers:

- exact project/client/callback pinning and exact eleven-method operator surface;
- durable nonsecret manifest and exclusive global-control ownership;
- live-owner fencing even after lease expiry;
- post-lease manifest recheck that refuses to overwrite a crashed peer;
- backend session-binding check before insert-only provisioning;
- abort/quiescence with no late insert;
- dirty-manifest admission block before a new run;
- stale/dead owner recovery to OFF with exact cleanup;
- real child-process death with durable manifest recovery;
- lost insert reply after partial commit;
- exact cleanup scope and phase-order enforcement;
- failed recovery retaining dirty evidence and refusing row deletion while host
  disable fails.

Helper SHA-256:
`f34dc7b1a4d5408087980b95968bd74432621dc64be93fdbb46c1a3270ce08b9`.
Focused-test SHA-256:
`38ff23f3c22a61369ef5c121e8080354f9028eebac8a3c29688da7bc7fe0d872`.

This record does not claim the repository full suite, static gate, Chromium CI, or
independent audit until those exact-head artifacts complete. It is not overall 8D
acceptance and not production crash-recovery evidence.

## Remaining gate before live acceptance

The next boundary is to review this exact runner/operator candidate independently,
then bind the approved fixed operator backend to the existing secure credential
realm and exact production operations. Only after exact-runner independent PASS
may a fresh manual PKCE login be requested and the bounded authenticated DARK
prepare/replay/status/cancel path be exercised. Production host enablement or
mutation before that audit remains prohibited.

Remaining 8D acceptance after that includes legitimate signed OAuth positive/
negative + real server session binding/revocation, hosted authenticated lifecycle,
hosted worker loss/reclaim/nonce durability, remaining cloud concurrency/quota/
retention/crypto gates, final OFF/clean verification, advisors, and independent
final 8D review. No 8E work is authorized by this local unit.

Compatibility remains extension 1.6.0, protocol 1, 26 browser capabilities, and
18 public MCP tools with unchanged schemas. No CRX/update/reconnect is required.
