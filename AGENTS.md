# Opera Agent agent instructions

MV3 browser extension + Supabase backend. Read before changing anything.
Precedence: user > this file > `SECURITY.md` (secrets, auth, transport), then handoff > project-context > checkpoint records > archive (historical, always loses).

## Commands

```bash
npm test                                # fast suite: tests/*.test.mjs, non-recursive
npm run check                           # runtime discovery + version pins
py tests/browser_extension_test.py      # browser harness on Windows (py, not python)
```

Deno gates run only on CI. Order: focused, full suite, required gates. Green local is not acceptance.

## Repository structure

| Directory | Purpose |
|---|---|
| `extension/` | MV3 runtime (worker, content scripts, UI) |
| `lib/` | Shared pure modules |
| `supabase/functions/` | Deno edge functions |
| `supabase/migrations/` | SQL in timestamp order, never rewritten |
| `tests/` | Fast suite; live-only `cloud/`, `postgres/`, `deno/` |
| `scripts/` | Entrypoints (`legacy/` for old ones) |
| `docs/` | Handoff (~150), project-context (~120), append-only archive |

## Skills

Load by ID before the task it covers: `skill({ name: "<skill-name>" })`, or read the linked `SKILL.md` directly. `@` mentions files, `/` runs slash commands (none here); naming a skill in chat also loads it.

| Skill | Path | Use when |
|---|---|---|
| `karpathy-guidelines` | `.agents/skills/karpathy-guidelines/SKILL.md` | Writing, reviewing, refactoring |

Skill loading is binding for the task it covers: every runtime commit carries a `Karpathy:` trailer (e.g. `Karpathy: surgical-3`). Non-code turns use judgment.

## Bootstrap order

This file, then `docs/next-session-handoff.md`, then `docs/project-context.md`. Then follow pointers — do not grep the whole repo first.

| Area | Read first |
|---|---|
| `extension/` | `extension/AGENTS.md` |
| `lib/` | `lib/AGENTS.md` |
| `supabase/` | `supabase/AGENTS.md` |

## Coding standards

- Failing test first, then the smallest generic mechanism. A lock is not accepted
  until made to fail on a realistic violation; harnesses test both directions.
- Regression tests verify behavior or parsed artifacts. Source-text regex only for
  intentionally frozen literals, with the test stating why.
- `npm run check` auto-discovers runtime files. No hand-picked safety lists.
- Match existing style. Touch only what the task requires. Never improve adjacent code, comments, or formatting it did not require.

## Boundaries

- **Always:** clean tree, `HEAD` matching the handoff, before writing; commit descriptively and push.
- **Ask first:** deleting foreign code; merge, promote, sign, rename, deploy; new top-level entries; production DB shape. Push back with a simpler approach when one exists; decline unclear work instead of guessing.
- **Never:** Never lock a removal in a test (a test that *requires* an artifact to stay deleted converts a preference into an irreversible decision); commit secrets or tokens; rewrite archive history; weaken a test to admit a violation; share one checkout between writers.

## Repository discipline

- **One writer per checkout.** Dirty/unknown: STOP, preserve to `archive/<topic>`, record, align.
- **No session ends dirty.** Nothing uncommitted or unpushed.
- **`main` is the truth.** `--ff-only` at every green checkpoint; never merge in-progress work.
- **Branches die on close.** Merge or archive-tag; tag before deleting.
- **Divergent lines get a decision.** Merge, cherry-pick, or archive-tag-and-delete with reason.
- 6. **Preserve before overwrite.** Never discard work you did not create without archiving first. **Mention, do not delete, pre-existing code this work did not create** — report to the owner in the same session instead of tidying-up. Removing it *is* allowed when the removal is **required** by the change being made. Say which of the two it is, in the commit message. Precedent: `opera_run_fast` was dropped and locked in a test on 2026-10-02, then restored on 2026-10-03 — the rule was still violated in its narrower form.
- 7. **Acceptance basis is CI evidence.** Checkpoint acceptance = GitHub Actions + Vercel SUCCESS on the exact evidence head plus a durable record (standing authorization 2026-09-19). CircleCI is frozen (free-plan credits exhausted 2026-10-03; `.circleci/config.yml` retained, not run). Deployment, release promotion, transport cutover, Milestone 8E start stay explicit user decisions, never granted by CI green alone.

## Naming conventions

Kebab-case, no lifecycle tokens (`tmp`, `draft`, `wip`, `backup`, `old`, `final<N>`). Root allowlisted. Branches: `main`, `release/<semver>`, `feat|fix|…/<kebab>` (retired namespaces stay retired). Tags: `archive/<path>`, `v<semver>`. No new doc families without updating this section in the same commit.

## Audit policy

`audit(head, range, question) -> PASS | CONDITIONAL PASS | FAIL`. One writer per milestone branch. Audit is by machine: a separate agent session, or Codex. A machine audit is the required default. The auditor must be a session that did not write the code under review, must start from fresh task context, and must be read-only: no edit, commit, push, deployment, or production authority. Give it the exact head, the diff range, and the question. Do not hand it a summary of your own reasoning and call that a scope.

Request before production mutation, dark-probe promotion, repeat failure, or contract deviation (e.g. auth, signing, MCP schemas, CRX, irreversible, DB shape).

At a milestone boundary the auditor reviews the full diff and reruns proportionate tests first. The audit must distinguish code present, automated tests passing, live acceptance passing, and production promotion. Its verdict is `PASS`, `CONDITIONAL PASS`, or `FAIL`; only `PASS` permits the next milestone unless the user explicitly accepts documented residual risk. Where the user waives the audit instead, record the waiver, the residual risk, and who accepted it — a missing audit and an accepted risk must never be readable as the same thing.

A machine auditor catches anchoring, sunk cost, stale recall, self-confirming tests, and document/code drift. It does not bring a category of threat nobody thought to check for, and it shares its author's blind spots. State the residual risk instead of letting a `PASS` stand in for human judgement that never happened. An auditor that only reruns what the author already ran has not audited anything; if that is all it managed, it must say so in the verdict. Prompt: `docs/prompts/chatgpt-web-checkpoint.md`.

## Evidence-first bug repair loop

Capture the exact failure; reproduce from authoritative evidence, never guess or blind-rerun; research the root cause; state a falsifiable hypothesis; add the failing test; fix smallest-generic without weakening anything to go green; re-run focused then full gates; three strikeless recurrences → blocked, request early audit.

## Session close

Update handoff; project-context only for unrecoverable facts; relocate spent detail; verify; push together. No context-only edits for read-only work.
