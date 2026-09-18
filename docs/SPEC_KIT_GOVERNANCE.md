# Spec Kit governance for Opera Agent

Opera Agent adopts GitHub Spec Kit **1.0.8** as a repository-persistent,
agent-facing workflow guardrail. Spec Kit is MIT-licensed and is used here only
to reduce scope drift and unsupported project-state assumptions.

## Authority

Spec Kit does not replace existing governance. Use this precedence:

1. `AGENTS.md` and `SECURITY.md`;
2. applicable roadmap/checkpoint/acceptance records;
3. current source, Git, CI, browser/deployment/production evidence;
4. active Spec Kit feature artifacts;
5. Repowise-derived context and chat summaries.

If a Spec Kit artifact conflicts with a higher level, fix the artifact.

## Installed mode

- Spec Kit version pinned: `specify-cli==1.0.8`.
- Agent integration: Codex skills under `.agents/skills/speckit-*/SKILL.md`.
- Script variant: PowerShell for the repository's Windows-first operator path.
- Runtime event hooks: disabled during adoption; no `.codex/config.toml` hook
  mutation is part of this checkpoint.
- No optional/community extension or preset is installed.
- No product/runtime/Supabase change is authorized by this adoption.

The scaffold is vendored from the official v1.0.8 source tag so it is usable
without depending on a Custom MCP connection. `tools/spec-kit/bootstrap.py`
only installs/verifies the pinned CLI in `.spec-kit-venv/`; it deliberately
does not rerun `specify init --force` and overwrite repository-managed
governance files.

## Workflow for the next bounded implementation

For a non-trivial new checkpoint:

1. `$speckit-specify <bounded requirement>`
2. `$speckit-clarify` when the requirement is materially ambiguous.
3. `$speckit-plan`
4. `$speckit-checklist` when a requirements-quality checklist is useful.
5. `$speckit-tasks`
6. `$speckit-analyze` — read-only consistency/governance gate.
7. Verify the exact active checkpoint and get the explicit implementation
   instruction required by repository governance.
8. `$speckit-implement` — only approved tasks.
9. Run the checkpoint's required focused/full/static/browser/security/CI gates.
10. `$speckit-converge` — identify missing/partial/unrequested work.
11. Remove/defer unrequested work, update context/handoff, and close only after
    exact required evidence is green.

Do not retroactively rewrite the whole established project into one giant Spec
Kit feature. Existing accepted milestones remain historical source-of-truth.
Use Spec Kit for the next bounded change onward.

## Relationship with Repowise

Repowise answers dependency, caller, history, and risk questions. Spec Kit
answers a different question: what is approved bounded work and whether the
implementation still matches it.

Recommended chain:

`governance -> Spec Kit active scope -> Repowise/source inspection -> implementation -> tests/CI -> convergence`

Neither layer may invent acceptance state.

## Current product boundary

Spec Kit adoption itself did not satisfy the P6 independent audit. That separate
gate is now **PASS / CLOSED WITH USER-ACCEPTED REVIEWER DEVIATION**, recorded in
`docs/p6-independent-audit-closeout.md`. P6 remains a FINAL CANDIDATE
because PR #46 is open/unmerged and production is not promoted. 8E remains
paused until the P6 promotion state is resolved separately.
