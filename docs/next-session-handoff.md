# Opera Agent next-session handoff

Use this as the starting prompt for the next implementation session. Verify the repository before making claims.

## Handoff prompt

```text
Continue the private Opera Agent project from repository:
https://github.com/afnannuzulasugihartono/opera-agent

Working branch:
feat/semantic-runtime-1.6.0

Read first, in order:
1. AGENTS.md
2. docs/project-context.md
3. docs/next-session-handoff.md
4. docs/milestone-7-plan.md
5. docs/milestone-7-checkpoint-7a.md
6. docs/milestone-7-checkpoint-7b.md
7. docs/milestone-7-checkpoint-7c.md
8. docs/milestone-7-checkpoint-7d.md
9. docs/semantic-runtime-plan.md
10. docs/milestone-6-plan.md
11. SECURITY.md

Verified compatibility baseline:
- extension 1.6.0
- protocol 1
- extension ID ohbbpamcljckmjhcpkcmefdobkoeaick
- 26 browser capabilities
- 18 MCP tools with unchanged names/input schemas
- established signing identity and pairing preserved
- background-first focus isolation preserved
- no silent foreground fallback
- immediate signed rollback remains 1.5.2

Milestones 1–6 are complete. Milestone 7 Checkpoints 7A, 7B, 7C, and 7D are complete.

Checkpoint 7A froze OA_REACTIVE_VM_V1, OA_REACTIVE_VM_CHECKPOINT_V1,
OA_CANONICAL_JSON_V1, the 12-node instruction grammar, closed expressions,
read-only-first effects, metadata-only persistence, hostile replay/digest vectors,
and protocol 1 / 26 capability / 18 MCP inventory.

Frozen quantitative limits remain:
- program/checkpoint/result 128 KiB each
- 256 static AST nodes
- AST depth 12
- control-flow depth 4
- 1,000 executed nodes/run
- 200 browser command leaves/run
- 50 iterations/loop, 250 total/run
- 15 s one wait, 60 s cumulative wait
- retry attempts/node 3
- 1,000 collection items/binding
- 64 bindings
- 20 s execution slice
- 5 minute run deadline

Checkpoint 7B added lib/reactive-vm.js as the accepted pure deterministic core.
Checkpoint 7C leaves that file untouched and adds lib/reactive-vm-7c.js for
LOOP, UNTIL, WAIT_EVENT, and safe observation-only RETRY.

Checkpoint 7D leaves both accepted modules untouched and adds
lib/reactive-vm-7d.js for the frozen COLLECT and DEDUP instructions plus bounded
observation-to-evidence binding.

Accepted 7D behavior:
- collections use bounded OA_VM_COLLECTION_V1 structured envelopes;
- cap/truncation or unresolved ambiguity always remains PARTIAL;
- only stable, non-truncated, unambiguous declared observed scopes can become
  BOUNDED_COMPLETE, never universal proof;
- loaded DOM, visible viewport, declared bounded feed, screenshot, and general
  observed state remain distinct scopes;
- dedup prefers logicalId/canonicalId and accepted stable ID/href identity before
  accepted semantic fingerprints;
- geometry, name, label, text, viewport position, and index never grant merge
  authority alone;
- missing strong identity retains records with MISSING_STRONG_IDENTITY;
- conflicting identity retains records with IDENTITY_COLLISION;
- virtual detach/reinsert with the same stable logical identity does not duplicate
  the entity; higher semanticRevision is preferred as the representative;
- document-generation changes invalidate dependent collections;
- viewport/zoom changes invalidate viewport-dependent collection state without
  invalidating unrelated loaded-DOM entity-set collections;
- verified effect provenance can flow into collection metadata;
- proof binding requires provenance and tenant agreement;
- bound collection evidence is never exhaustive and the VM does not evaluate proof;
- action receipts and stable screenshots still cannot manufacture PROVED.

Accepted pre-closeout 7D evidence on head
138cfbbb59350b9160c72016f59139b2ee79dc38 (run 34669862521):
- focused 7D tests: 12/12 pass, 0 fail
- bounded deterministic 1,000-item collection/dedup: pass
- full npm test: 154/154 pass, 0 fail
- npm run check: pass; 26 allowlisted browser primitives, version 1.6.0
- controlled Chromium regression: pass
- background focus audit: 55 commands, focus preserved
- bounded burst stability: 20/20
- background screenshot focus and reconnect checks: pass

The first focused CI pass was 11/12 only because a test fixture combined a
collection and ledger from different tenants. The runtime correctly failed closed
with CROSS_TENANT. Only the fixture was aligned; tenancy enforcement was not
relaxed.

Checkpoint 7D did not change production Supabase migration/function/flag/row,
extension source/version, protocol, capability inventory, MCP source/tool/schema,
signing identity, pairing state, production browser behavior, or signed artifacts.

The branch MCP source hash remains:
f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11

The locked 7A inventory digest remains:
sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a

NEXT TASK: Checkpoint 7E only — durable Supabase host and dark integration.

Frozen 7E scope from docs/milestone-7-plan.md:
- host VM execution in bounded Edge slices;
- tenant-bound leases and compare-and-swap run advancement;
- idempotency, cancellation, expiry, checkpoint/restart, queue backpressure;
- additive private-schema migration with least-privilege grants;
- enqueue, claim, checkpoint, resume, cancel, expire, cleanup behavior;
- opaque/encrypted bounded payload boundary where raw values cannot be avoided;
- exact retry/idempotency tests across forced worker termination;
- rate, queue, retention, payload, and tenant concurrency limits;
- default-off server feature flag, cleanup procedure, and server rollback.

7E exit gates:
- exactly one lease advances each logical transition;
- zero duplicate logical effects after crash/redelivery probes;
- unauthenticated/cross-tenant operations succeed zero times;
- stale goal/program/lease/target/document generations are rejected;
- persisted state contains zero prohibited raw content;
- security advisors add no unresolved relevant ERROR/WARN;
- flag-off leaves extension 1.6.0 and all 18 MCP tools usable.

Prefer an internal workflow surface. Keep all 18 public MCP tools unless measured
value justifies a separately reviewed contract. Deploy behind a default-off server
flag. Do not begin Checkpoint 7F production acceptance, Milestones 8+, public MCP
changes, extension changes, direct logical-ID actions, or broader effects while
implementing 7E.

Before changing production Supabase in 7E, follow the checkpoint plan exactly:
freeze storage/host contracts and limits, add deterministic failing tests first,
implement additive least-privilege mechanisms, test crash/redelivery/tenancy/stale
state, run security advisors, dark-run with the flag off/default-off boundary, and
retain an explicit cleanup/rollback route.

Before ending a state-changing session, run focused tests, npm test, npm run check,
relevant host/security/Chromium compatibility gates, update docs/project-context.md
and this handoff, commit/push the same branch, and follow AGENTS.md exactly.
```

## Session-close note

Checkpoint 7A began from `e559387c1672c84453f1a98ad819bf6423f95173`. Checkpoint 7B is recorded in `docs/milestone-7-checkpoint-7b.md`; Checkpoint 7C in `docs/milestone-7-checkpoint-7c.md`; Checkpoint 7D in `docs/milestone-7-checkpoint-7d.md`. The next implementation session must start at Checkpoint 7E rather than repeating earlier checkpoints or jumping to 7F/Milestone 8+.
