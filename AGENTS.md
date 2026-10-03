# Opera Agent agent instructions

MV3 browser extension + Supabase backend. Read before changing anything.
Precedence: user > this file > `SECURITY.md` (secrets, auth, transport), then handoff > project-context > checkpoint records > archive (historical, always loses).

## Commands

```bash
npm test                                # fast suite: tests/*.test.mjs, non-recursive
npm run check                           # runtime discovery + version pins
py tests/browser_extension_test.py      # browser harness on Windows (py, not python)
```

- Deno gates run only on CI.
- Order: focused, full suite, required gates.
- Green local is not acceptance.

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

- Before a writing, reviewing, or refactoring task, load the skill first: `skill({ name: "karpathy-guidelines" })`, or read `.agents/skills/karpathy-guidelines/SKILL.md` directly.
- Every runtime commit carries a `Karpathy:` trailer (e.g. `Karpathy: surgical-3`).
- Non-code turns use judgment.

## Principles (karpathy, compressed — full text in the skill)

- State assumptions and tradeoffs before coding; ask when unclear.
- Report an inaccessible prerequisite instead of working around it.
- Prefer a cheap reversible commit over an irreversible one.

## Bootstrap order

- Read this file, then `docs/next-session-handoff.md`, then `docs/project-context.md` — in that order, before anything else.
- Afterwards open only files those three name (area files in the table below; code and tests as the task needs).
- Never grep the repo for guidance.

| Area | Read first |
|---|---|
| `extension/` | `extension/AGENTS.md` |
| `lib/` | `lib/AGENTS.md` |
| `supabase/` | `supabase/AGENTS.md` |

## Scoped instructions

- Area `AGENTS.md`, new or edited: ≤15 lines, pointers only, opens with the root-binds line, must not contradict the root; register new ones in the Bootstrap table and refresh stale paths the same commit.

## Coding standards

- Failing test first, then the smallest generic mechanism. A lock is not accepted
  until made to fail on a realistic violation; harnesses test both directions.
- Regression tests verify behavior or parsed artifacts. Source-text regex only for
  intentionally frozen literals, with the test stating why.
- `npm run check` auto-discovers runtime files. No hand-picked safety lists.
- Comments answer WHY, never WHAT — one line per trap, incident, or frozen-contract reason.
- Match existing style. Touch only what the task requires. Never improve adjacent code, comments, or formatting it did not require.

## Boundaries

- **Always:** clean tree, `HEAD` matching the handoff, before writing; commit descriptively and push.
- **Ask first:** deleting foreign code; merge, promote, sign, rename, deploy; new top-level entries; production DB shape. Push back with a simpler approach when one exists; decline unclear work instead of guessing.
- **Never:** Never lock a removal in a test (a test that *requires* an artifact to stay deleted converts a preference into an irreversible decision); commit secrets or tokens; rewrite archive history; weaken a test to admit a violation; share one checkout between writers.

## Repository discipline

- **One writer, clean close, main is truth.** Dirty/unknown tree: STOP, preserve to `archive/<topic>`, record, align; never end dirty or diverged. `--ff-only` at green checkpoints; merge or archive-tag closed work, tag before deleting; divergent lines get a decision.
- 6. **Preserve before overwrite.** Never discard work you did not create without archiving first.
  - **Mention, do not delete, pre-existing code this work did not create** — report to the owner in the same session instead of tidying-up.
  - Removing it *is* allowed when the removal is **required** by the change being made. Say which of the two it is, in the commit message.
  - Never lock a removal in a test (a test that *requires* an artifact to stay deleted converts a preference into an irreversible decision).
  - Precedent: `opera_run_fast` was dropped and locked in a test on 2026-10-02, then restored on 2026-10-03 — the rule was still violated in its narrower form.
- 7. **Acceptance basis is CI evidence.** Checkpoint acceptance = GitHub Actions + Vercel SUCCESS on the exact evidence head plus a durable record (standing authorization 2026-09-19).
  - CircleCI is frozen (free-plan credits exhausted 2026-10-03; `.circleci/config.yml` retained, not run).
  - Deployment, release promotion, transport cutover, Milestone 8E start stay explicit user decisions, never granted by CI green alone.

## Naming conventions

- Kebab-case, no lifecycle tokens (`tmp`, `draft`, `wip`, `backup`, `old`, `final<N>`).
- Root allowlisted. No new doc families without updating this section in the same commit.
- Branches: `main`, `release/<semver>`, `feat|fix|…/<kebab>` (retired namespaces stay retired).
- Tags: `archive/<path>`, `v<semver>`.

## Audit policy

- `audit(head, range, question) -> PASS | CONDITIONAL PASS | FAIL`. One writer per milestone branch.
- Audit is by machine: a separate agent session, or Codex. A machine audit is the required default.
- The auditor must be a session that did not write the code under review, must start from fresh task context, and must be read-only: no edit, commit, push, deployment, or production authority.
- Give it the exact head, the diff range, and the question. Do not hand it a summary of your own reasoning and call that a scope.
- Request before production mutation, dark-probe promotion, repeat failure, or contract deviation.
- At a milestone boundary the auditor reviews the full diff and reruns proportionate tests first.
- The audit must distinguish code present, automated tests passing, live acceptance passing, and production promotion.
- Prompt: `docs/prompts/chatgpt-web-checkpoint.md`.

## Evidence-first bug repair loop

- Capture the exact failure; reproduce from authoritative evidence, never guess or blind-rerun.
- Research the root cause; state a falsifiable hypothesis.
- Add the failing test; fix smallest-generic without weakening anything to go green.
- Re-run focused then full gates.
- Three strikeless recurrences → blocked, request early audit.

## Session close

- Update handoff; verify; push together.
- project-context only for unrecoverable facts; relocate spent detail.
- No context-only edits for read-only work.
