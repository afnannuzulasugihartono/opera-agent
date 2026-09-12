# Milestone 7 Checkpoint 7D — collection, deduplication, and proof bindings

Accepted: 2026-09-12

Starting accepted head: `eb4811ec85672e6e40367fc8a9f6a5cbb94eae87` (Checkpoint 7C closeout).

Checkpoint 7D implements only the frozen `COLLECT` and `DEDUP` semantics plus bounded observation-to-evidence binding. It does not begin durable hosting, production Supabase integration, public MCP changes, extension changes, or broader browser effects.

## Scope accepted

The frozen `OA_REACTIVE_VM_V1` grammar is unchanged. Checkpoint 7D makes the already-frozen nodes executable:

- `COLLECT(source, projection, destination, maxItems)`;
- `DEDUP(source, keySpec, destination)`.

All Checkpoint 7A quantitative limits remain in force, including 1,000 collection items per binding, 64 bindings, 128 KiB checkpoint/result bounds, 1,000 executed nodes per run, and 200 browser command leaves per run.

No new MCP tool, public schema, protocol capability, extension primitive, or action-by-logical-ID surface was added.

## Runtime isolation

`lib/reactive-vm-7d.js` is an isolated pure runtime layer. The accepted Checkpoint 7B core (`lib/reactive-vm.js`) and Checkpoint 7C layer (`lib/reactive-vm-7c.js`) remain unchanged.

For pre-7D instructions, the layer delegates deterministic stepping to 7C through a shadow program in which only `COLLECT`/`DEDUP` are replaced by inert validated assertions. The external state remains bound to the original program digest, and pending effect digests are translated back to the original program/control context. Only the two new collection instructions are intercepted by 7D.

The 7D core performs no browser, network, ambient-clock, random, database, or Supabase work.

## Bounded collection envelope

Collection bindings use the internal `OA_VM_COLLECTION_V1` envelope and retain:

- structured projected records;
- item/source counts;
- cap/truncation and remaining-count metadata;
- explicit ambiguity records;
- verified observation provenance when available;
- observation/scope kind;
- dependency fingerprint, dependency kinds, and document generation;
- completion status and unresolved conditions;
- invalidation metadata;
- dedup metadata when applicable.

A collection is `BOUNDED_COMPLETE` only when its declared observed scope has a stable boundary, there is no cap truncation, and there is no unresolved identity ambiguity. Otherwise it remains `PARTIAL`. Every collection states that it is not universal proof.

Loaded-DOM scope, visible-viewport scope, declared bounded-feed scope, screenshots, and generic observed state remain distinct. No bounded collection is reinterpreted as an exhaustive real-world claim.

## Deduplication safety

Deduplication prefers stronger identity before weaker identity evidence:

1. verified canonical identifiers such as `logicalId` / `canonicalId` and accepted stable ID/href keys;
2. explicit accepted semantic/identity fingerprints only when no stronger identity conflicts.

Geometry, display name, label, text, viewport position, index, and similar weak fields never grant merge authority by themselves.

When no strong key exists, the record is retained and `MISSING_STRONG_IDENTITY` is reported. When identifiers collide or stronger identities conflict, the records are retained and `IDENTITY_COLLISION` is reported. Ambiguity therefore cannot silently reduce the result set.

Compatible virtual detach/reinsert observations with the same stable logical identity collapse to one entity, and the representative with the higher semantic revision is preferred. Geometry/ref changes alone do not create a new identity.

## Dependency invalidation

Collection state records observation dependencies. A document-generation change invalidates dependent state. Viewport/zoom changes invalidate viewport-dependent collections while leaving loaded-DOM collections that depend only on the entity set intact.

This preserves causal invalidation rather than globally discarding unrelated collection state.

## Proof/evidence separation

`bindCollectionEvidence7D` can translate a verified collection observation into Milestone 6 evidence, but it does not evaluate proof and does not grant proof authority to the VM.

Evidence binding:

- requires verified collection provenance;
- rejects missing provenance;
- rejects cross-tenant provenance;
- emits a `BOUNDARY_OBSERVATION` only for an eligible bounded-complete collection, otherwise a `DIRECT_OBSERVATION`;
- uses browser-sensor trust;
- always sets `exhaustive: false`.

Consequently, a bounded stable-feed observation can support `BOUNDED_COMPLETE`, while a closed-world universal claim still requires independent exhaustive evidence before it can become `PROVED`. Action receipts remain process evidence and stable screenshots remain observations; neither manufactures completion.

## Focused 7D coverage

`tests/reactive-vm-7d.test.mjs` contains 12 focused gates covering:

1. frozen opcode isolation and unchanged 7C behavior;
2. lazy-list append plus stable-identity dedup;
3. detach/reinsert and geometry/name non-authority;
4. collision and missing-key ambiguity preservation;
5. semantic-fingerprint fallback with stronger-ID conflict preservation;
6. cap truncation remaining explicitly `PARTIAL`;
7. viewport/zoom causal invalidation;
8. bounded evidence binding without universal proof authority;
9. zero false `PROVED` from action receipts/stable screenshots;
10. verified effect provenance flowing into collection bindings;
11. deterministic bounded 1,000-item collection/dedup and environment neutrality;
12. cancellation before collection execution.

The first CI pass produced 11/12 focused passes. The sole failure was a test fixture that deliberately/accidentally combined a `tenant-test` collection with a `tenant_fixture_alpha` ledger. The runtime correctly rejected it as `CROSS_TENANT`. Only the fixture tenant was aligned; the fail-closed tenancy rule was not weakened.

## Accepted CI evidence

Successful validation head before documentation closeout:
`138cfbbb59350b9160c72016f59139b2ee79dc38`.

GitHub Actions run: `34669862521`.
Job: `103489062331`.

Accepted results:

- focused 7D: **12/12 pass, 0 fail**;
- deterministic 1,000-item collection/dedup gate: **pass**;
- full `npm test`: **154/154 pass, 0 fail**;
- `npm run check`: **pass** with `check ok: 26 allowlisted browser primitives, version 1.6.0`;
- embedded 7B/7C performance gates remain below their accepted thresholds;
- controlled Chromium extension regression: **pass**;
- background focus audit: **55 commands, focus preserved**;
- bounded burst stability: **20/20**;
- background screenshot focus preservation: **pass**;
- network reconnect and browser-restart reconnect: **pass**.

The final documentation head is revalidated separately before checkpoint closeout. Temporary exact-head CI instrumentation is restored to the standard workflow afterward, and the temporary draft validation PR is closed without merge.

## Compatibility and production boundary

Checkpoint 7D changes no:

- extension source or version;
- protocol;
- public browser capability inventory;
- MCP source, tool name, or input schema;
- signing identity or pairing state;
- production browser behavior;
- production Supabase migration, function, feature flag, row, or configuration;
- signed release artifact.

The compatibility baseline remains extension 1.6.0 / protocol 1 / 26 browser capabilities / 18 MCP tools.

## Rollback

Rollback is server-code only: stop selecting the 7D runtime layer / disable collection opcodes and resume the accepted 7C runtime. The semantic identity foundation, Milestone 6 proof engine, extension 1.6.0, MCP contract, signing identity, and pairing remain usable and unchanged.

## Next checkpoint

Checkpoint 7E is next and must be handled as a separate checkpoint. Its frozen scope is durable Supabase hosting and dark integration: bounded Edge slices, tenant-bound leases, idempotency, cancellation/expiry, checkpoint/restart, queue backpressure, least-privilege additive storage, encrypted/opaque bounded payloads, limits, a default-off feature flag, and rollback/cleanup procedures.

Do not begin Checkpoint 7F production acceptance or Milestones 8+ while implementing 7E. The 18 public MCP tools remain the preferred unchanged public surface unless a separately reviewed contract decision proves otherwise.
