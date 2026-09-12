# Milestone 8 Checkpoint 8C — provenance and approval verifier

Status: accepted pure-runtime checkpoint on 2026-09-12.

## Scope

Checkpoint 8C implements only the pure authority-verification layer frozen by the Milestone 8 plan. It performs no browser commit, network request, database operation, ambient-clock read, public MCP runtime/schema change, OAuth configuration change, extension/signing work, or production mutation. Durable nonce consumption and transaction journaling remain assigned to 8D.

The checkpoint started from accepted 8B head `b879cb11a37f8aabda2bd4a6ed47c24208ffe16b`. The pure implementation/test commit is `e2b228be3bb2356d01c0120060352b0e9154a8af`.

## Implementation

`lib/transaction-authority.js` now provides:

- strict provenance source-kind, role, freshness, transform, tenant, goal-revision, and exact browser-target validation;
- a mandatory trusted authority record and rejection of authority laundering through browser, tool, model, or server-derived values;
- immutable approval challenges bound to authenticated user, trusted OAuth client identity, tenant, transaction, goal revision, prepare digest, preview digest, target digest, effect class, nonce, validity interval, and protocol era;
- explicit rejection of static bearer, service-role, anonymous, OAuth-consent, page-text, model-prose, and self-reported client authority;
- pure modern MCP `input_required` request modeling with opaque echoed `requestState`, one bounded choice request, and one permitted response round;
- exact request-state, capability, response, TTL, and already-consumed-nonce verification;
- a deterministic nonce-consumption claim for the durable compare-and-set layer planned in 8D;
- rejection of unknown fields, prototype-bearing objects, cycles, secret-like fields/values, malformed digests, and over-limit input.

All time is supplied explicitly. JSON-RPC request IDs and MCP session routing values are ignored for security binding and are never returned in accepted authority state.

## Acceptance evidence

- TDD red state: the focused test failed with `ERR_MODULE_NOT_FOUND` before `lib/transaction-authority.js` existed;
- focused 8C suite: 11/11 pass;
- full deterministic Node suite: 204/204 pass;
- 10,000 generated provenance/challenge chains: all remained bounded, exact-shaped, and unable to widen the single trusted authority source;
- cross-user, cross-OAuth-client, cross-tenant, cross-goal, cross-transaction, cross-target, cross-document, action, prepared-payload, and preview mutations: zero approval acceptance;
- page/tool/model/server-derived `AUTHORITY`, stale or unknown provenance, invalid transforms, and mismatched target provenance: deterministic rejection;
- requestState tamper, response tamper, decline, second round, expiry, and nonce reuse: deterministic rejection with zero transaction-state advancement;
- changed JSON-RPC request ID and session routing values: valid retry remains valid because neither is authority;
- missing modern form elicitation: deterministic `MISSING_REQUIRED_CAPABILITY` with RPC code `-32021` and zero state advancement;
- `npm run check`: pass, reporting version 1.6.0 and 26 allowlisted browser primitives;
- source syntax, environment-neutrality scan, and `git diff --check`: pass.

## One-shot boundary

The 8C verifier is pure: it rejects a nonce appearing in a trusted consumed-nonce set and emits a deterministic consumption claim after acceptance. It does not claim durable or concurrent one-shot enforcement by itself. Atomic persistence/CAS, leases, replay across workers, and recovery belong to 8D and remain unavailable now.

## Security and compatibility boundary

Checkpoint 8C changes no extension source/version/ID, protocol, public capability, MCP source/tool/schema, Edge Function, database/migration, OAuth runtime configuration, production flag/row, signing identity, pairing, or browser state. It creates no transaction commit authority and dispatches no action.

## Rollback

Revert the 8C implementation/tests. Accepted 8A contracts and the pure 8B prepare engine remain unchanged and unreachable from production; no production rollback is needed.

## Next checkpoint

Checkpoint 8D is the next permitted unit after user review. Because it introduces durable authorization state and production database shape, its plan requires an early independent Codex audit before any production mutation. It must not begin in this checkpoint.
