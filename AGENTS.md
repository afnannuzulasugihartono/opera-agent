# Opera Agent agent instructions

MV3 browser extension + Supabase backend. Read before changing anything.

Precedence: user > this file > `SECURITY.md` > handoff > project-context > archive.

## Mission

- **The runtime code is the product**: `extension/`, `lib/`, `supabase/functions/`.
- Docs and tests support them — never the task.
- A task ships a runtime change or it ships nothing.
- A document or a test in place of the work asked is a failed task.
- A session that ships no runtime change must say so and justify it.
- No named file? Pick the target with `npm run scope -- "<task>"`, then edit it.
- Do not add docs or tests unless asked.
- If scope shows the problem lives in a test or doc, say that instead.
- Round trips are the cost that matters: one burst beats several calls.

## What the owner means

- "lanjutkan" — resume opera-agent: read `AGENTS.md`, then
  `docs/next-session-handoff.md`, then `docs/project-context.md`, then act.
- "apa langkah selanjutnya" — do not start work. Say in plain language what is
  broken or undecided right now, and what choice the owner has to make.
- "merelakan" / "hapus aja" — the owner has decided; stop relitigating and do it.

## Verify by driving it

- A green suite is not proof, and a skip is not the absence of a problem.
- Drive the real thing yourself before saying it works.
- A skip may be our blind spot: Maps and YouTube expose an unlabeled a11y tree.

## Bootstrap order

- Read this file, then `docs/next-session-handoff.md`, then `docs/project-context.md`.
- Afterwards open only files those three name. Never grep the repo for guidance.
- Before any edit, run `npm run scope -- "<task>"`.
- Read slices, never wholes — files over 500 lines are never read fully.

| Area | Read first |
|---|---|
| `extension/` | `extension/AGENTS.md` |
| `lib/` | `lib/AGENTS.md` |
| `supabase/` | `supabase/AGENTS.md` |

## Commands

- `npm test` — fast suite (`tests/*.test.mjs`).
- `npm run check` — runtime discovery + version pins.
- `py tests/browser_extension_test.py` — browser harness (Windows: `py`).
- Deno gates run only on CI. Green local is not acceptance.

## Standards

- A test's job is to test, not to make a claim valid.
- A lock that only asserts a sentence exists proves nothing — do not add one.
- Failing test first, then the smallest generic mechanism.
- Comments answer WHY, never WHAT.
- Write current state, never history. A comment or doc says what is true now and
  why it is that way; the past lives in git. Do not narrate a change, an incident
  timeline, or a migration story where a reader only needs today's rule.
- `.md` files are bullet points, not prose. One idea per line, a table when there
  is a list of facts. Simplicity outranks completeness: a shorter file that says
  only what matters beats a longer one that records everything.
- Any claim about repository state cites `path:line` or a command you ran.
- Unverified is a valid answer — say it is unverified and stop.

## Principles

Full text: `.agents/skills/karpathy-guidelines/SKILL.md`. Load it with
`skill({ name: "karpathy-guidelines" })` before writing or reviewing code.

- Think before coding. State assumptions and tradeoffs; ask when unclear.
- Report an inaccessible prerequisite instead of working around it.
- Prefer a cheap reversible commit over an irreversible one.
- Minimum code that solves the problem. Nothing speculative, no unrequested
  flexibility, no abstraction for a single use.
- Surgical changes. Every changed line traces to the request. Never improve
  adjacent code, comments, or formatting the task did not require.
- If you notice unrelated dead code, mention it — do not delete it.
- Define success as something verifiable, then loop until it actually runs.

## When something does not work

- A bug or a feature that does not work is a research task first, not a fix task.
- Reproduce it and read the real evidence before changing anything.
- Find the cause before writing the fix — source, tests, git history, and for a
  browser, OS or protocol quirk, the primary source that documents it.
- State a falsifiable hypothesis, then name the evidence that would confirm it.
- Three failures with no new evidence means blocked: stop editing and report.

## Boundaries

- Ask first: deleting foreign code, merge, promote, deploy, new top-level
  entries, production DB shape.
- Never lock a removal in a test: a test that *requires* an artifact to stay
  deleted converts a preference into an irreversible decision.
- Never: commit secrets, weaken a test to admit a violation, share one checkout.
- Decline unclear work instead of guessing.

## Scoped instructions

- Area `AGENTS.md`, new or edited: ≤15 lines, pointers only.
- Opens with the root-binds line.
- must not contradict the root.
- Register new ones in the Bootstrap table the same commit.

## Repository discipline

- One writer per checkout. A dirty tree means STOP and preserve to
  `archive/<topic>`; never end dirty or diverged.
- 6. **Preserve before overwrite.** Never discard work you did not create
  without archiving it first.
  - **Mention, do not delete, pre-existing code this work did not create** —
    report to the owner in the same session.
  - Removing it *is* allowed when the removal is **required** by the change.
  - Say which of the two it is, in the commit message.
  - Never lock a removal in a test.
  - Precedent: `opera_run_fast` was dropped and locked in a test on 2026-10-02,
    then restored on 2026-10-03 — the rule was still violated in its narrower form.
- 7. **Acceptance basis is CI evidence.**
  - Checkpoint acceptance = GitHub Actions + Vercel SUCCESS on the exact head.
  - Deployment and release promotion are explicit user decisions,
    never granted by CI green alone.

## Naming

- Kebab-case, no lifecycle tokens (`tmp`, `draft`, `wip`, `backup`, `old`, `final<N>`).
- Root allowlisted.
- Branches: `main`, `release/<semver>`, `feat|fix|chore|docs|test|perf|refactor/<kebab>`.

## Model

- opencode.json pins the model to `opencode/space-bunny-free`.
- The closeout must state which model ran.
- Silent model drift is invisible until the work is reviewed.

## Session close

- Touch `docs/` only when the session changed code or released state.
- A read-only or test-only session leaves both context files alone.
- Verifying means running the thing, not reading it and asserting it would work.
