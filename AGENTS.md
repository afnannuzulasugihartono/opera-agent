# Opera Agent agent instructions

MV3 browser extension + Supabase backend. Read before changing anything.
Precedence: user > this file > `SECURITY.md` (secrets, auth, transport), then handoff > project-context > checkpoint records > archive (historical, always loses).

## Mission

**The runtime code is the product**: `extension/`, `lib/`, `supabase/functions/`. Docs and tests support them — never the task. A session that ships no runtime change must say so and justify it.

## Commands

- `npm test` — fast suite (`tests/*.test.mjs`, non-recursive); `npm run check` — runtime discovery + version pins; `py tests/browser_extension_test.py` — browser harness (Windows: `py`, not `python`).
- Deno gates run only on CI; order: focused, full suite, required gates. Green local is not acceptance.

## Repository structure

Layout: `extension/` MV3 runtime, `lib/` shared modules, `supabase/functions/` edge, `supabase/migrations/` SQL (never rewritten), `tests/` fast suite, `scripts/` entrypoints, `docs/` context.

## Skills

Load by ID before the task it covers: `skill({ name: "<skill-name>" })`, or read the linked `SKILL.md` directly. `@` mentions files, `/` runs slash commands (none here); naming a skill in chat also loads it.

Skill: `karpathy-guidelines` (`.agents/skills/karpathy-guidelines/SKILL.md`) — writing, reviewing, refactoring. Load it first with `skill({ name: "karpathy-guidelines" })`.

- Every runtime commit carries a `Karpathy:` trailer (e.g. `Karpathy: surgical-3`); non-code turns use judgment.

## Principles (karpathy, compressed — full text in the skill)

- State assumptions and tradeoffs before coding; ask when unclear.
- Report an inaccessible prerequisite instead of working around it.
- Prefer a cheap reversible commit over an irreversible one.

## Bootstrap order

- Read this file, then `docs/next-session-handoff.md`, then `docs/project-context.md` — in that order, before anything else; afterwards open only files those three name. Never grep the repo for guidance.
- Before any edit, run `npm run scope -- "<task>"`: it ranks the read set and prints the token cost against reading everything. Reading the repo whole is the failure mode, not the shortcut.

| Area | Read first |
|---|---|
| `extension/` | `extension/AGENTS.md` |
| `lib/` | `lib/AGENTS.md` |
| `supabase/` | `supabase/AGENTS.md` |

## Scoped instructions

- Area `AGENTS.md`, new or edited: ≤15 lines, pointers only, opens with the root-binds line, must not contradict the root; register new ones in the Bootstrap table and refresh stale paths the same commit.

## Task scope

- One task, one area: declare scope (area + files) before editing; the diff stays inside it.
- Read slices, never wholes: grep first, offset/limit always; files over 500 lines are never read fully.
- Spec work touches spec and docs only; code changes get their own task.

## Claims and evidence

- Any claim about repository state cites `path:line` or a command you ran; never assert from memory, and never call it green without reading it.
- A comment, commit message, or older doc is a lead: verify against the code before repeating it.
- Unverified is a valid answer — say it is unverified and stop, instead of filling the gap.
- "not found" is reported as not found: an empty search is a finding, never proof it does not exist.

## Coding standards

- Failing test first, then the smallest generic mechanism; locks fail on realistic violations, both directions.
- Regression tests verify behavior or parsed artifacts; source-text regex only for frozen literals, stated why.
- `npm run check` auto-discovers runtime files; no hand-picked safety lists. Comments answer WHY, never WHAT — one line per trap, incident, or frozen-contract reason.

## Boundaries

- **Always:** clean tree, `HEAD` matching the handoff, before writing; commit descriptively and push.
- **Ask first:** deleting foreign code; merge, promote, sign, rename, deploy; new top-level entries; production DB shape. Push back with a simpler approach when one exists; decline unclear work instead of guessing.
- **Never:** Never lock a removal in a test (a test that *requires* an artifact to stay deleted converts a preference into an irreversible decision); commit secrets or tokens; rewrite archive history; weaken a test to admit a violation; share one checkout between writers.

## Repository discipline

- **One writer, clean close, main is truth.** Dirty/unknown tree: STOP, preserve to `archive/<topic>`, record, align; never end dirty or diverged. `--ff-only` at green checkpoints; merge or archive-tag closed work, tag before deleting; divergent lines get a decision.
- 6. **Preserve before overwrite.** Never discard work you did not create without archiving first. **Mention, do not delete, pre-existing code this work did not create** — report to the owner in the same session instead of tidying-up. Removing it *is* allowed when the removal is **required** by the change being made. Say which of the two it is, in the commit message. Precedent: `opera_run_fast` was dropped and locked in a test on 2026-10-02, then restored on 2026-10-03 — the rule was still violated in its narrower form.
- 7. **Acceptance basis is CI evidence.** Checkpoint acceptance = GitHub Actions + Vercel SUCCESS on the exact evidence head plus a durable record (standing authorization 2026-09-19). CircleCI is frozen (free-plan credits exhausted 2026-10-03; `.circleci/config.yml` retained, not run). Deployment, release promotion, transport cutover, Milestone 8E start stay explicit user decisions, never granted by CI green alone.

## Naming conventions

- Kebab-case, no lifecycle tokens (`tmp`, `draft`, `wip`, `backup`, `old`, `final<N>`). Root allowlisted; no new doc families without updating this section. Branches: `main`, `release/<semver>`, `feat|fix|…/<kebab>`; retired namespaces stay retired. Tags: `archive/<path>`, `v<semver>`.

## Audit policy

- `audit(head, range, question) -> PASS | CONDITIONAL PASS | FAIL`. One writer per milestone branch. Audit is by machine: a separate agent session, or Codex. A machine audit is the required default.
- The auditor must be a session that did not write the code under review, must start from fresh task context, and must be read-only: no edit, commit, push, deployment, or production authority. Give it the exact head, the diff range, and the question. Do not hand it a summary of your own reasoning and call that a scope. Request before production mutation, dark-probe promotion, repeat failure, or contract deviation.
- At a milestone boundary the auditor reviews the full diff and reruns proportionate tests first. The audit must distinguish code present, automated tests passing, live acceptance passing, and production promotion. Prompt: `docs/prompts/chatgpt-web-checkpoint.md`.

## Evidence-first bug repair loop

- Capture the exact failure; reproduce from authoritative evidence, never guess or blind-rerun; research the root cause; state a falsifiable hypothesis.
- Add the failing test; fix smallest-generic without weakening anything to go green; re-run focused then full gates; three strikeless recurrences → blocked, request early audit.

## Session close

- Update handoff; verify; push together. project-context only for unrecoverable facts; relocate spent detail. No context-only edits for read-only work.
