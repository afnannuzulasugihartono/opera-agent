# Opera Agent Constitution

<!--
Spec Kit workflow constitution.
Repository authority is not transferred to this file: AGENTS.md and SECURITY.md
remain superior when any wording conflicts.
-->

## Core Principles

### I. Repository Authority and Evidence

Work MUST follow this authority order:

1. `AGENTS.md` and `SECURITY.md`;
2. the applicable roadmap, checkpoint plan, and accepted evidence records;
3. current repository/Git state plus exact CI, browser, deployment, and production evidence;
4. the active Spec Kit feature artifacts (`spec.md`, `plan.md`, `tasks.md`);
5. derived context such as Repowise output or chat summaries.

Model-written summaries and prior conversation state are leads, never proof.
If evidence conflicts, the higher authority wins.

### II. Exact Bounded Scope

Every implementation MUST have one explicit active feature/checkpoint, scope, and
non-goals before editing. Later checkpoints, adjacent improvements, refactors,
and attractive follow-up ideas MUST NOT be implemented unless they are part of
the approved active scope.

Unrequested implementation discovered by analysis or convergence is scope creep:
remove it or record it as deferred work. Do not silently expand the active spec.

After the assigned checkpoint closes, STOP. Starting the next checkpoint requires
an explicit user instruction.

### III. Evidence-Backed State

Code presence is not acceptance. A checkpoint MUST NOT be called complete while
required CI is queued/running/failing, temporary instrumentation remains,
production cleanup is pending, required acceptance evidence is missing, or
`docs/project-context.md` / `docs/next-session-handoff.md` are stale.

Unknown or unavailable evidence MUST be reported as unknown, not inferred.

### IV. Tests and Verification Before Promotion

Behavior-changing code requires deterministic failing tests before the runtime
implementation unless the governing checkpoint explicitly records a justified
exception. Run the focused, full, static, browser/cloud/security gates required
by the applicable plan. Required CI pending means STOP; repeated identical
failure without new evidence must become diagnostics/blocked rather than blind
retries.

### V. Security and Product Invariants

Normal browser automation is background-first and MUST NOT silently activate
tabs, focus Opera, move the operating-system cursor, or redirect keyboard input.
No arbitrary eval/RCE, unrestricted raw CDP, shell/SQL escape hatch, secret
commit, or sensitive credential handling may be introduced.

Authentication/authorization, tenant isolation, encryption, signing identity,
public MCP schemas, extension distribution, production database shape,
irreversible actions, or transaction authority require their explicit reviewed
boundary and any audit required by `AGENTS.md`.

### VI. One Writer and Independent Audit

Use one active writer on a milestone branch at a time. Preserve unrelated user
changes. At milestone boundaries, the independent audit required by
`AGENTS.md` remains mandatory; Spec Kit analysis/convergence does not replace
that auditor.

### VII. Spec Kit Is a Guardrail, Not a New Product Authority

Spec Kit governs the workflow of the active bounded change. It MUST NOT override
`AGENTS.md`, `SECURITY.md`, accepted checkpoint records, exact Git/CI reality,
or grant permission for a later milestone.

For non-trivial implementation:
- create/refresh the spec and plan;
- generate tasks;
- run `$speckit-analyze` before implementation;
- obtain the explicit implementation instruction required by repository governance;
- implement only approved tasks;
- run required tests/CI;
- run `$speckit-converge` before closeout.

Repowise may assist code orientation/impact analysis, but consequential claims
still require exact source and evidence verification.

## Current Locked Boundary

Current state on 2026-09-18:
- Performance Track P6 is **ACCEPTED / CLOSED**: PR #46 is merged at
  `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac` with CircleCI #169 + Vercel
  SUCCESS, and production `opera-agent-vm` version 27 is ACTIVE with
  `verify_jwt=true` and exact source verification against that merge commit;
- the P6 independent audit gate is PASS/CLOSED using Jules with an explicitly
  user-accepted reviewer deviation because Codex quota was exhausted;
- exact candidate evidence is CircleCI #118 SUCCESS + Vercel SUCCESS;
- the explicit merge and production-promotion decisions have been executed and
  verified; this does NOT authorize broader runtime authority or 8E implicitly;
- the bounded Spec Kit feature `specs/001-pre-8e-performance-usability-repair/` is active before 8E; R0 and R1 are **ACCEPTED / CLOSED**; R2 and later checkpoints remain unauthorized;
- the repair preserves Protocol 1, 26 browser primitives, 18 public MCP tool names
  and input schemas, background-first behavior, existing semantic state/delta
  authority, and `milestone7_vm_enabled=false`;
- Milestone 8E remains paused/not started until R8 acceptance plus a separate explicit instruction;
- the preserved accidental 8E stash MUST NOT be popped, applied, deleted, or
  used automatically.

## Governance

This constitution is a projection of existing Opera Agent governance for Spec
Kit workflows. Amendments MUST be reconciled with `AGENTS.md` and
`SECURITY.md`; this file cannot weaken those authorities.

**Version**: 1.0.4  
**Ratified**: 2026-09-18  
**Last Amended**: 2026-09-18
