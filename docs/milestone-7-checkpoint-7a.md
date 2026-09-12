# Milestone 7 Checkpoint 7A — Reactive VM contract freeze

Status: accepted contract-only checkpoint on 2026-09-12.

## Scope

Checkpoint 7A freezes the data contract, validation boundary, effect policy, persistence shape, replay corpus, and quantitative gates for the future Reactive Browser VM. It does **not** implement a VM stepper, execute VM programs, add a durable VM host, change the extension, modify production Supabase, or add an MCP tool.

The checkpoint started from `e559387c1672c84453f1a98ad819bf6423f95173` on `feat/semantic-runtime-1.6.0`.

## Frozen artifacts

- `tests/fixtures/reactive-vm-contract-v1.json`
- `tests/fixtures/reactive-vm-program-schema-v1.json`
- `tests/fixtures/reactive-vm-checkpoint-schema-v1.json`
- `tests/fixtures/reactive-vm-programs-v1.json`
- `tests/fixtures/reactive-vm-checkpoints-v1.json`
- `tests/fixtures/reactive-vm-replay-v1.json`
- `tests/fixtures/reactive-vm-digest-vectors-v1.json`
- `tests/fixtures/reactive-vm-thresholds-v1.json`
- `tests/reactive-vm-contract.test.mjs`

The frozen schema version is `OA_REACTIVE_VM_V1`. The checkpoint schema is `OA_REACTIVE_VM_CHECKPOINT_V1`. Canonical digests use `OA_CANONICAL_JSON_V1`.

## Instruction and expression boundary

The contract defines exactly these VM instructions:

`SEQUENCE`, `IF`, `LOOP`, `UNTIL`, `WAIT_EVENT`, `ASSERT`, `COLLECT`, `DEDUP`, `RETRY`, `RETURN`, internal `COMMAND`, and `SUSPEND`.

Expressions are deliberately closed and data-only: `CONST`, `PATH`, comparisons, boolean composition, `IN`, and `COUNT`. The contract rejects unknown expressions, regex execution, callbacks, JavaScript, SQL, invented CSS/XPath execution, raw CDP, prototype traversal, and arbitrary property access.

Cyclic in-memory ASTs are rejected before digest or execution. Depth, node count, control-flow nesting, aggregate command count, iterations, waits, retry attempts, bindings, collections, checkpoint size, and result size all have explicit fail-closed bounds.

## Quantitative bounds

- serialized program: 128 KiB
- static AST nodes: 256
- AST depth: 12
- control-flow depth: 4
- executed nodes per run: 1,000
- browser command leaves per run: 200
- iterations per loop: 50
- total iterations per run: 250
- one `WAIT_EVENT`: 15 seconds
- cumulative wait: 60 seconds
- retry attempts per node: 3
- collection items per binding: 1,000
- bindings: 64
- persisted checkpoint: 128 KiB
- returned result: 128 KiB
- execution slice: 20 seconds
- run deadline: 5 minutes

## Effect policy

The initial VM effect boundary is read-only first. The contract may observe through the existing read-only primitives and a read/find/wait-only subset of `browser.burst`. `browser.burst` remains an atomic existing primitive rather than becoming recursively executable VM structure.

Navigation, opening/closing/activating tabs, media actions, and consequential effects are excluded from the initial VM contract. Local reversible page effects such as click, pointer, fill, focus, scroll, and key are classified but deferred until a later checkpoint supplies explicit authority and pre/post verification. `WAIT_EVENT` is restricted to read-only observations and therefore cannot become a hidden effect channel.

No foreground fallback is allowed. Target device/tab/document provenance remains locked and stale or cross-target results fail closed.

## Persistence and proof separation

Durable checkpoint data is bounded metadata only: tenant/run/program/goal/target digests, instruction pointer, budget counters, binding digests, bounded safe scalar values, observation digest, lease metadata, status, and timestamps.

Raw page text, screenshots, DOM, form values, private URLs, passwords, OTPs, payment data, credentials, tokens, pairing codes, and signing-key material are forbidden checkpoint state.

Page content cannot define program structure or grant authority. Browser command success is process evidence only and can never manufacture `PROVED` completion. The existing Goal/Constraint Ledger and Proof Engine remain the authority for proof semantics.

## Replay and deterministic validation

The hostile/boundary corpus contains 36 synthetic cases, exceeding the 24-case gate. It covers untrusted program injection, cyclic/deep/oversized ASTs, aggregate budget exhaustion, stale leases and goals, cross-tenant/device/tab/document results, forged proof semantics, ambiguous deduplication, sensitive persistence attempts, disallowed navigation/media, foreground fallback, and replay/duplicate-effect hazards.

All cases record zero focus changes, zero cross-tenant acceptance, zero sensitive values persisted, and zero false completion.

Canonical digest vectors reproduce identically across 100 runs. The frozen public inventory remains protocol 1, 26 browser capabilities, and 18 MCP tools. The 7A inventory digest is:

`sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a`

During 7A validation an existing fixture-only drift was exposed: the branch MCP source already hashed to `f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`, while older lock fixtures still recorded `6235ed...`. The MCP source itself, its 18 tool names, and input schemas were not changed. Only stale fixture metadata was aligned to the already-present source.

## Baselines

7A intentionally records no VM runtime performance because no VM runtime exists yet. It pairs future work against accepted 1.6.0 evidence:

- rich read median: 19.83 ms
- rich read p95: 20.65 ms
- rich snapshot median: 50,953 bytes
- one-item update: 6,087 bytes
- delta/snapshot ratio: 12%
- burst stability: 20/20
- ledger validation median/p95: 0.2949 / 0.4494 ms
- proof evaluation at 500 evidence items median/p95: 1.9055 / 2.4166 ms
- proof p95 target: below 10 ms

## Compatibility and production boundary

Checkpoint 7A preserves:

- extension version `1.6.0`;
- protocol `1`;
- 26 public browser capabilities;
- 18 MCP tools and their schemas;
- extension signing identity and installed extension ID;
- existing pairing;
- background-first focus isolation;
- same-identity signed rollback path.

No extension source, MCP source, VM runtime, database migration, Supabase function deployment, feature flag, production row, pairing state, or signing material was changed by 7A.

The internal-surface decision is `NO_NEW_MCP_TOOL` for this checkpoint.

## Validation

Focused 7A contract tests: 9/9 pass.

The branch-head CI gate runs the repository's exact `npm test` followed by `npm run check`; acceptance requires both to pass before this checkpoint is considered complete. A temporary draft PR was used only as a GitHub Actions runner because the repository workflow normally triggers on pull requests or pushes to `main`. The temporary checkout override is not part of the final checkpoint state.

## Next checkpoint

Checkpoint 7B is next and must implement only the deterministic in-memory stepper against these frozen fixtures. It must not broaden the 7A grammar/effect boundary merely to make implementation easier. Durable hosting, production database changes, new MCP surface, and broader browser effects remain outside 7B unless the frozen Milestone 7 plan explicitly places them in a later checkpoint.

## Rollback

Because 7A is contract/tests/docs only, rollback is repository-only: revert the 7A commits and fixtures. There is no production Supabase, extension, pairing, or signed-artifact rollback associated with this checkpoint.
