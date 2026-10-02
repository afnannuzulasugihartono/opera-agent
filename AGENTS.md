# Opera Agent agent instructions

Instructions for AI coding agents working in this repo. Read before changing
anything. Precedence: explicit user instructions > this file > `SECURITY.md`
(secrets, auth, transport) > skill `karpathy-guidelines` (coding behavior:
think first, simplicity, surgical changes, goal-driven execution — this file
already enforces the strict version, notably deterministic failing tests before
runtime behavior). Skills load by ID via the skill tool; the only skill in this
repo is `karpathy-guidelines` (`.agents/skills/karpathy-guidelines/SKILL.md`).

## Project

MV3 browser extension + Supabase backend (Postgres, edge functions). Layout:
`extension/` runtime, `lib/` shared modules, `supabase/functions/` edge,
`supabase/migrations/` SQL in timestamp order, `tests/` suites,
`scripts/` entrypoints, `docs/` context (`next-session-handoff.md` ~150 lines,
`project-context.md` ~120, `context-archive.md` append-only history).

Commands (verified, run these — never substitutes):
- `npm test` — fast suite, globs `tests/*.test.mjs` non-recursively
- `npm run check` — auto-discovers runtime files, no hand-picked lists
- `py tests/browser_extension_test.py` — browser harness on Windows (`py`, not `python`)
- Deno gates (`lint`/`check`) run only on CI; no pinned local binary remains

## Boundaries

- ✅ **Always:** verify `git status` clean and `HEAD` matches
  `docs/next-session-handoff.md` before the first write; run focused tests, then
  the full suite, then required gates; commit descriptively and push.
- ⚠️ **Ask first:** deleting pre-existing code you did not create (report it in
  the same session instead); merge, promote, sign, rename, deploy; new top-level
  files/dirs (root is allowlisted); production database shape changes.
- 🚫 **Never:** commit secrets or tokens; rewrite `docs/context-archive.md`
  history; weaken a test to admit a violation; lock a removal in a test (a test
  that *requires* an artifact to stay deleted converts a preference into an
  irreversible decision); let two agents write one checkout.

## Repository discipline (binding — each rule maps to a past failure)

- **One writer per checkout.** Dirty tree or unknown head: STOP, preserve to an
  `archive/<topic>` branch, record it in the handoff, align first.
- **No session ends dirty or diverged.** No uncommitted or unpushed work.
  Incomplete work is recorded as exact state.
- **`main` is the consolidated truth.** Fast-forward (`--ff-only`) at every green
  checkpoint; never merge in-progress work; docs must match what the update
  service actually serves.
- **Branches are born to die.** Merge or archive-tag on close; tag
  (`archive/<branch-name>`) before deleting any ref. Remote holds only `main`,
  one active branch, `release/*`, `archive/*`.
- **Divergent lines need a decision, not neglect.** Merge, cherry-pick, or
  archive-tag-and-delete with a one-line handoff reason.
- 6. **Preserve before overwrite.** Never discard work you did not create without
  archiving first.
  - **Mention, do not delete, pre-existing code this work did not create.** Dead
    code or a function that cannot work is something to report to the owner in
    the same session, not remove as tidying-up.
  - Removing it *is* allowed when the removal is **required** by the change being
    made. Say which of the two it is, in the commit message.
  - **Never lock a removal in a test.** A test that *requires* an artifact to stay
    deleted converts a preference into an irreversible decision.
  - Precedent: `opera_run_fast` was dropped and locked in a test on 2026-10-02,
    then restored on 2026-10-03. The old rule covered *overwriting* but not
    *discovering* something unusable — that gap is what mention-don't-delete
    closes. The rule was still violated even in its narrower form.
- 7. **Acceptance basis is CI evidence.** Checkpoint acceptance = CircleCI +
  Vercel SUCCESS on the exact evidence head plus a durable record, per the
  standing authorization of 2026-09-19. Production deployment, signed release
  promotion, transport cutover, and Milestone 8E start remain separate explicit
  user decisions and are never granted by CI green alone.

## Naming conventions (binding, enforced by `tests/repo-naming-governance.test.mjs`)

Lowercase kebab-case filenames, no lifecycle tokens (`tmp`, `draft`, `wip`,
`backup`, `old`, `final<N>`). Entrypoints under `scripts/`; test pages under
`tests/fixtures/`. Branches: `main`, `release/<semver>`,
`feat|fix|chore|docs|test|perf|refactor/<kebab-description>` (retired
namespaces stay retired). Tags: `archive/<path>`, `v<semver>`. Keep the existing
doc families; no new ones without updating this section in the same commit.
Before ending a code-changing session: update the handoff (state, changes,
pending decisions, exact next action), add only unrecoverable facts to
project-context, relocate spent detail to the archive, verify against evidence,
and push it all together.

## Testing

- Failing test first, then the smallest generic mechanism. A lock is not accepted
  until made to fail on a realistic violation; harnesses test both directions
  (reject broken, accept legitimate).
- Regression tests verify behavior or parsed artifacts. Source-text regex only
  for intentionally frozen literals, with the test stating why.
- Never trust combined CI status while a check is pending; never call green local
  green acceptance. Acceptance is CircleCI + Vercel SUCCESS on the exact head.

## Checkpoint implementation and milestone audit policy

One writer per milestone branch. ChatGPT Web may implement; audit is by machine:
a separate agent session, or Codex. A machine audit is the required default. The
auditor must be a session that did not write the code under review, must start
from fresh task context, and must be read-only: no edit, commit, push,
deployment, or production authority. Give it the exact head, the diff range, and the question. Do not hand it a summary of your own reasoning and call that a scope.

Request an audit before production mutation (auth, authorization, tenant
isolation, encryption, signing, public MCP schemas, CRX distribution,
irreversible actions, production DB shape), after a bounded dark probe, on
repeated unexplained failure, or on frozen-contract deviation.

At a milestone boundary the auditor reviews the full diff and reruns proportionate tests first. The audit must distinguish code present, automated tests passing, live acceptance passing, and production promotion. Its verdict is `PASS`, `CONDITIONAL PASS`, or `FAIL`; only `PASS` permits the next milestone unless the user explicitly accepts documented residual risk. Where the user waives the audit instead, record the waiver, the residual risk, and who accepted it — a missing audit and an accepted risk must never be readable as the same thing.

Be accurate about what this is. A machine auditor catches anchoring, sunk cost,
stale recall, tests that assert what the author believed, and document/code
drift. It does not bring a category of threat nobody thought to check for, and
it shares its author's blind spots. State the residual risk instead of letting a `PASS` stand in for human judgement that never happened. An auditor that only reruns what the author already ran has not audited anything; if that is all it managed, it must say so in the verdict. Prompt: `docs/prompts/chatgpt-web-checkpoint.md`.

## Evidence-first bug repair loop

Capture the exact failure; reproduce from authoritative evidence (never patch from
a guess or blind-rerun a gate); research the root cause (primary sources when
uncertain); state a falsifiable hypothesis; add the failing regression test;
implement the smallest generic fix without weakening thresholds or changing
contracts to go green; re-run focused then full gates; after three strikeless
recurrences, mark blocked and request early audit.

## Spec Kit skills removed (2026-10-03, owner-ordered)

Ten `speckit-*` skills removed (zero invocations; context cost unpaid by use),
then `tools/repowise/`, `tools/spec-kit/`, `.specify/`. `specs/001` stays frozen.
Details: commits `4d8428d`, `1b547d7`.
