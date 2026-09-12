# Opera Agent next-session handoff

Use this as the starting point after the Milestone 8 planning session. Verify repository head, production flags, CI/PR state, and accepted evidence before making claims.

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
4. docs/milestone-8-plan.md
5. docs/milestone-7-codex-audit.md
6. docs/milestone-7-plan.md
7. docs/milestone-7-checkpoint-7a.md through docs/milestone-7-checkpoint-7f.md
8. docs/semantic-runtime-plan.md
9. docs/roadmap.md
10. SECURITY.md

Verified compatibility baseline before Milestone 8 implementation:
- extension 1.6.0
- protocol 1
- extension ID ohbbpamcljckmjhcpkcmefdobkoeaick
- 26 browser capabilities
- 18 MCP tools with unchanged current names/input schemas
- production device opera
- established signing identity and pairing preserved
- background-first focus isolation preserved
- no silent foreground fallback
- immediate signed rollback 1.5.2
- signed 1.6.0 CRX SHA-256:
  cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0
- canonical-LF MCP source SHA-256:
  f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11
- locked 7A inventory digest:
  sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a

Milestones 1-7 are complete. The independent Codex audit of Milestone 7 is PASS.
Milestone 8 implementation has NOT started.

MILESTONE 8 PLAN STATUS:
- docs/milestone-8-plan.md is frozen for user review.
- Checkpoint 8A is BLOCKED until the user explicitly approves that plan.
- The planning session changed documentation only: no code, database, Edge
  Function, extension, MCP schema, OAuth runtime configuration, signing state, or
  feature flag was intentionally changed.

Frozen Milestone 8 architecture:
PREPARE -> VALIDATE -> APPROVE(if required) -> COMMIT -> OBSERVE -> VERIFY -> RECEIPT

Authority rules:
- Goal/Constraint Ledger is user intent/constraint authority.
- Transaction engine can narrow but never widen that authority.
- Browser/page/tool/model data may supply operands/evidence but never new authority.
- OAuth app consent authenticates/authorizes connection, not a transaction.
- Consequential approval is fresh, one-shot, short-lived, and bound to the exact
  prepared digest/user/tenant/goal/target/preview.
- Proof Engine remains completion authority; command/transaction receipts are
  process evidence only.

Effect classes:
- READ_ONLY
- LOCAL_REVERSIBLE
- STAGED_EXTERNAL
- COMPENSABLE_EXTERNAL
- IRREVERSIBLE_OR_UNKNOWN

Unknown defaults to the strongest review path. Generic click/fill/key/navigation/
pointer actions are not assumed reversible merely because the low-level primitive
is allowlisted.

Provenance:
- only USER_EXPLICIT, LEDGER_AUTHORITY, and accepted TRUSTED_POLICY can carry
  AUTHORITY;
- BROWSER_OBSERVED, TOOL_OBSERVED, and MODEL_DERIVED may be bounded operands or
  evidence only;
- changed action arguments, target, authority predicate, provenance chain, effect
  class, or expected postcondition invalidates prepare + approval.

Recovery rules:
- use deterministic tx1 action IDs and reuse the same opera command request_id;
- post-dispatch unknown completion becomes AMBIGUOUS and is reconciled read-only;
- never blindly redispatch an irreversible/unknown action;
- cancellation before dispatch guarantees no transaction mutation; after dispatch
  it only stops remaining work and does not claim undo;
- compensation is a separately governed effect and is never automatic while the
  original commit is ambiguous.

Frozen checkpoints:
8A contract/hostile corpus/baseline (blocked pending user approval)
8B pure decision-causal prepare engine
8C provenance + approval verifier
8D durable transaction journal/dark Supabase host; early Codex before production mutation
8E controlled transaction executor + compensation
8F trusted approval transport + MCP/OAuth compatibility; early Codex before deployment/promotion
8G bounded dark/live acceptance on synthetic/reversible fixtures
8H compatibility/performance closeout + independent milestone audit

MCP compatibility:
- 8A-8E preserve the current 18 public tools and input schemas.
- 8F may propose additive prepare_browser_transaction / commit_browser_transaction
  only if an actual trustworthy human-confirmation channel is proven.
- preferred confirmation is MCP 2026-07-28 input_required; an authenticated
  first-party exact-digest approval page may be separately accepted as fallback.
- never accept model-supplied approved:true as user confirmation.
- if trustworthy confirmation cannot be proven, consequential production commit
  remains unavailable.

Extension/signing:
- expected Milestone 8 path keeps extension 1.6.0 unchanged.
- semantic logical IDs remain observational.
- if an extension change becomes necessary, STOP and approve a separate
  version/release/signing subplan before editing extension code.

NEXT ACTION:
Ask the user to review docs/milestone-8-plan.md. Do NOT start Checkpoint 8A until
there is explicit user approval in a subsequent instruction. If approved, begin
only 8A contract/fixtures/tests; do not implement 8B or production changes in the
same checkpoint session.
```

## Planning baseline

The Milestone 8 planning session started from exact branch head
`538dbb5cb8b7b8ff1d8be9c6ac36ba37d22669d4`, whose parent was the independently
audited Milestone 7 final head `551e8283c0417b173e106ee0598cca848f2f4ff0`.

Milestone 7 audit evidence is durable in `docs/milestone-7-codex-audit.md` and its
verdict is PASS. That PASS opened planning only; it granted no consequential
authority and left the production VM dark.

## Review gate

**STOP HERE.** The next session may inspect/discuss/revise the Milestone 8 plan,
but Checkpoint 8A must not start until the user explicitly approves the frozen
plan. Any requested plan revision stays documentation-only and must resynchronize
this handoff and project context before implementation.
