# Opera Agent agent instructions

MV3 browser extension + Supabase backend. Read before changing anything.
Precedence: user > this file > `SECURITY.md`, then handoff > project-context > archive (historical, always loses).

## Mission

**The runtime code is the product**: `extension/`, `lib/`, `supabase/functions/`. Docs and tests support them — never the task. A task ships a runtime change or it ships nothing; a document or a test in place of the work asked is a failed task. A session that ships no runtime change must say so and justify it.

For a performance or fix task with no named file, pick the target yourself with `npm run scope -- "<task>"`, then edit that runtime file. Do not add docs or tests unless asked. If scope shows the problem genuinely lives in a test or a doc, say that instead of editing runtime anyway.

Round trips are the cost that matters: prefer one burst over several single calls, and do not make a client wait on a poll that could have returned data.

## Bootstrap order

Read this file, then `docs/next-session-handoff.md`, then `docs/project-context.md` — in that order, before anything else; afterwards open only files those three name. Never grep the repo for guidance. Before any edit run `npm run scope -- "<task>"`; read slices, never wholes — files over 500 lines are never read fully.

| Area | Read first |
|---|---|
| `extension/` | `extension/AGENTS.md` |
| `lib/` | `lib/AGENTS.md` |
| `supabase/` | `supabase/AGENTS.md` |

## Commands

`npm test` — fast suite (`tests/*.test.mjs`). `npm run check` — runtime discovery + version pins. `py tests/browser_extension_test.py` — browser harness (Windows: `py`, not `python`). Deno gates run only on CI; green local is not acceptance.

## Standards

A test's job is to test, not to make a claim valid: a lock that only asserts a sentence exists grows the suite without proving anything, so do not add one. Failing test first, then the smallest generic mechanism. Comments answer WHY, never WHAT. Any claim about repository state cites `path:line` or a command you ran; unverified is a valid answer.

## Boundaries

Ask first: deleting foreign code; merge, promote, deploy; new top-level entries; production DB shape. Never: Never lock a removal in a test (a test that *requires* an artifact to stay deleted converts a preference into an irreversible decision); commit secrets; weaken a test to admit a violation; share one checkout between writers.

## Scoped instructions

Area `AGENTS.md`, new or edited: ≤15 lines, pointers only, opens with the root-binds line, must not contradict the root.

## Repository discipline

One writer, clean close: dirty tree means STOP and preserve to `archive/<topic>`, never end dirty or diverged.
6. **Preserve before overwrite.** Never discard work you did not create without archiving it first. **Mention, do not delete, pre-existing code this work did not create** — report to the owner in the same session. Removing it *is* allowed when the removal is **required** by the change being made. Say which of the two it is, in the commit message. Precedent: `opera_run_fast` was dropped and locked in a test on 2026-10-02, then restored on 2026-10-03 — the rule was still violated in its narrower form.
7. **Acceptance basis is CI evidence.** Checkpoint acceptance = GitHub Actions + Vercel SUCCESS on the exact evidence head; deployment and release promotion stay explicit user decisions, never granted by CI green alone.

## Naming

Kebab-case, no lifecycle tokens (`tmp`, `draft`, `wip`, `backup`, `old`, `final<N>`). Root allowlisted. Branches: `main`, `release/<semver>`, `feat|fix|chore|docs|test|perf|refactor/<kebab>`.

## Model

opencode.json pins the model to `opencode/space-bunny-free`. The closeout must state which model ran; silent model drift is invisible until the work is reviewed.

## Session close

Touch `docs/` only when the session changed code or released state — a read-only or test-only session leaves both context files alone. Verifying means running the thing, not reading it and asserting it would work.
