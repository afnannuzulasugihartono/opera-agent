# Milestone 7 Checkpoint 7B — Pure deterministic VM core

Status: accepted on 2026-09-12.

## Scope

Checkpoint 7B implements only the pure deterministic in-memory Reactive Browser VM core defined by the frozen 7A contract. It does not host the VM in Supabase, add durable checkpoints, change production infrastructure, alter extension behavior, add or change MCP tools, broaden browser effects, or begin Checkpoint 7C loop/wait/retry execution.

The accepted implementation is `lib/reactive-vm.js`. The core performs no browser, network, wall-clock, random, database, or production infrastructure work. Host/browser effects are emitted as typed requests and must be returned with matching request identity and provenance before the VM can bind their values.

## Executable 7B instruction subset

The 7A grammar remains unchanged. Checkpoint 7B executes only:

- `SEQUENCE`
- `IF`
- `ASSERT`
- `RETURN`
- internal `COMMAND`
- `SUSPEND`

The future 7C/7D opcodes `LOOP`, `UNTIL`, `WAIT_EVENT`, `RETRY`, `COLLECT`, and `DEDUP` remain structurally validated by the frozen contract but are rejected as executable 7B programs. Their runtime semantics are not implemented in this checkpoint.

Expressions remain the closed data-only grammar frozen by 7A. Path traversal uses own properties only, blocks prototype-sensitive segments, and cannot treat page text as program authority.

## Determinism and host boundary

VM creation binds the program digest, tenant, goal revision, target, explicit logical start time, deadline, run ID, and bounded initial bindings. The core never reads ambient time. Every advance receives `logicalNowMs` explicitly from the host.

A `COMMAND` does not execute a browser primitive inside the VM. Instead it yields an `EFFECT_REQUEST` containing:

- the frozen program digest;
- run identity;
- instruction path and command ordinal;
- existing allowlisted read-only method and arguments;
- target device/tab/document binding;
- canonical request digest;
- destination binding.

Returned effect results are rejected before binding unless the request digest and method match and provenance agrees with the authoritative tenant, device, tab, and, when applicable, document generation. Forged, stale, cross-tenant, cross-device, cross-tab, and stale-document results therefore fail closed.

The effect boundary remains read-only first. `browser.burst` is still an existing atomic leaf and is accepted only for the frozen read/find/wait subset. Foreground execution remains forbidden. Navigation, tab activation, media actions, local reversible action effects, and consequential effects remain outside 7B.

## Runtime safety

The VM revalidates the frozen program before creation/advance and validates state before every transition. It rejects malformed cursors/frames, stale goal revision, target mismatch, unsupported state shape, cycles, non-canonical JSON data, secret-like fields/values, invalid bindings, and over-budget state.

Cancellation and deadline checks occur at every instruction boundary, including while an effect request is pending. Terminal state is explicit and immutable. Returned values and terminal payloads stay within the frozen result bound and receive a canonical digest.

Runtime counters enforce the frozen executed-node, command-leaf, binding, and output limits in addition to 7A static worst-case budget validation. 7B does not weaken the 7A limits for future loop/wait/retry/collection operations.

Browser command success remains process evidence only. This VM core does not create proof authority and cannot manufacture `PROVED` completion.

## Validation

Focused test file: `tests/reactive-vm-core.test.mjs`.

Accepted branch-head CI evidence:

- focused Checkpoint 7B tests: **10/10 pass**;
- 10,000 generated bounded programs: **pass**, with no declared-budget escape;
- malformed state and forged/stale effect-result rejection: **pass**;
- cancellation/deadline boundary tests: **pass**;
- 1,000 non-I/O transitions: **1.1067 ms p95** in the focused Node 22 CI run, below the 10 ms target;
- full `npm test`: **131/131 pass, 0 fail**;
- `npm run check`: **pass** with `26 allowlisted browser primitives, version 1.6.0`;
- controlled Chromium extension regression: **pass** (`ok: true`);
- Chromium background focus audit: **55 commands, focus preserved**;
- bounded burst stability: **20/20**;
- background screenshot focus preservation, network reconnect, and browser-restart reconnect: **pass**.

The same full-suite run measured the embedded 7B 1,000-transition check at 1.0616 ms p95. The focused value above is the checkpoint gate value because it was run as the dedicated 7B step before the full suite.

A temporary draft pull request was used only to trigger GitHub Actions against the exact branch head. It was closed without merge after validation. The temporary CI checkout/focused-test instrumentation is not part of the final repository state.

## Compatibility and production boundary

Checkpoint 7B preserves:

- extension version `1.6.0`;
- protocol `1`;
- extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`;
- 26 public browser capabilities;
- 18 MCP tools with unchanged names/input schemas;
- MCP source behavior and public contract;
- established extension signing identity;
- existing pairing;
- background-first focus isolation;
- same-identity signed rollback `1.5.2`.

No production Supabase migration, Edge deployment, feature flag, row mutation, durable VM host, extension source, MCP source/schema, CRX, signing material, pairing state, or production browser behavior was changed by 7B.

## Known boundary

`lib/reactive-vm.js` is intentionally a pure library and is not yet reachable from the production server or browser path. That is the rollback and containment boundary for 7B. Durable checkpoint hosting belongs to Checkpoint 7E; broader browser effects are not introduced here.

## Next checkpoint

Checkpoint 7C is next. Add only the frozen bounded runtime semantics for `LOOP`, `UNTIL`, `WAIT_EVENT`, and `RETRY` using a host-supplied monotonic logical clock and typed observations. Retries must remain limited to idempotent observations and structured transient failures. Do not start Checkpoint 7D collection/deduplication, Checkpoint 7E Supabase hosting, production database work, or new public MCP/extension surfaces while executing 7C.

## Rollback

7B is unreachable pure-library work. Repository rollback is to remove/revert `lib/reactive-vm.js`, `tests/reactive-vm-core.test.mjs`, and the 7B-specific historical test adjustment while retaining the accepted 7A fixtures/contracts. No production infrastructure, extension, pairing, or signed-artifact rollback is required.
