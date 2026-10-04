# Opera Agent agent instructions

MV3 browser extension + Supabase backend. Read before changing anything.

## Precedence

Highest wins, written out in full so there is nothing to guess.

1. The owner, in this conversation.
2. `AGENTS.md` — this file. Area scopes: `extension/AGENTS.md`, `lib/AGENTS.md`, `supabase/AGENTS.md`.
3. `SECURITY.md`.
4. `docs/CONTEXT.md` — durable traps.
5. `docs/HANDOFF.md` — what shipped last session.
6. Git history — spent detail. There is no archive file.

## Priority order

1. **Fungsi** — it works, proven by driving it.
2. **Fitur** — justified by a real case. No case, no feature.
3. **Kecepatan** — short round trips. Measure before claiming a gain.

Simple outranks all three.

## Triggers

| Trigger | Action |
|---|---|
| "lanjutkan" | read `AGENTS.md`, `docs/HANDOFF.md`, `docs/CONTEXT.md`, then act |
| "autonomously", "sampai mission tercapai" | keep going until the mission is reached. Do not ask, do not hand back a partial result with a question at the end |
| "upgrade terus", owner leaves | keep improving until the time named. Commit each verified step, keep the tree clean, leave a note in `docs/HANDOFF.md` |
| a verified step passes | push it to `origin/main` at once. Never leave a verified win in a local commit |
| "apa langkah selanjutnya" | do not start work. Say what is broken or undecided, and the choice the owner must make |
| "merelakan", "hapus aja" | decided. Stop relitigating and do it |
| something is broken | fix it first, and research before fixing |
| a lock, comment or doc is too long | cut it, or split it into baby steps |
| using a language or library | read its official docs first, so `print` means what it really means |
| about to claim it works | drive it yourself. A green suite and a skip are not proof |
| adding a test to lock a removal | never. A preference is not irreversible |
| three failures, no new evidence | blocked: stop editing and report |
| a real site shows a problem | ours until proven otherwise. Record it in `docs/CONTEXT.md` |
| adding or renaming a `.md` | give it a `Related:` header and check every link resolves |
| you need a document | use the map below, never a guess or a repo-wide grep |

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

## Verify by driving it

- A green suite is not proof, and a skip is not the absence of a problem.
- Drive the real thing yourself before saying it works.
- A skip may be our blind spot: Maps and YouTube expose an unlabeled a11y tree.
- A page with an empty a11y tree is reachable: navigate by URL, act by coordinates.

## Bootstrap order

- Read this file, then `docs/HANDOFF.md`, then `docs/CONTEXT.md`.
- Afterwards open only files those three name. Never grep the repo for guidance.
- Before any edit, run `npm run scope -- "<task>"`.
- Read slices, never wholes — files over 500 lines are never read fully.

| Area | Read first |
|---|---|
| `extension/` | `extension/AGENTS.md` |
| `lib/` | `lib/AGENTS.md` |
| `supabase/` | `supabase/AGENTS.md` |

| Need | Read |
|---|---|
| pairing, incidents, manual steps | `docs/runbook.md` |
| command and response contract | `docs/api.md` |
| latency baselines and locked ceilings | `docs/benchmarks.md` |
| traps that caused a false claim | `docs/CONTEXT.md` |
| what shipped last session | `docs/HANDOFF.md` |
| what is still open | `ROADMAP.md` |
| what changed in a release | `CHANGELOG.md` |
| security boundary and token transport | `SECURITY.md` |
| the overview and the same map for humans | [`README.md`](README.md) |
| how to propose a change | `CONTRIBUTING.md` |
| where to ask for help | `SUPPORT.md` |
| what the extension may do, and why it holds those permissions | `extension/README.md` |
| what the scripts folder is for | `scripts/README.md` |
| what the edge functions and migrations are | `supabase/README.md` |
| what the suites cover | `tests/README.md` |
| the delta-first runtime plan | `docs/delta-first-performance-plan.md` |
| the accessibility-tree checkpoint | `docs/checkpoint-up1-ax-observation.md` |

Every `.md` carries a one-line `Related:` header, and this table plus those headers mean
no document is an island. Adding or renaming one means updating both.

## Commands

- `npm test` — fast suite (`tests/*.test.mjs`).
- `npm run check` — runtime discovery + version pins.
- `py tests/browser_extension_test.py` — browser harness.
- `OA_REAL_SITE=1 py tests/real_site_smoke.py` — live internet, opt-in.
- Deno gates run only on CI. Green local is not acceptance.

## Standards

- A test's job is to test, not to make a claim valid.
- A lock that only asserts a sentence exists proves nothing — do not add one.
- Failing test first, then the smallest generic mechanism.
- Comments answer WHY, never WHAT. One line per lock entry.
- Every file and every function carries a comment naming what it is and what it does,
  in one or two lines, at the top. That is WHAT and it is required. WHY belongs in the
  comments inside the body. A function nobody can name from its signature is a function
  nobody can find later.
- Write current state, never history. Say what is true now and why; git keeps the
  past. No change narrative, incident timeline, or migration story.
- `.md` files are bullets, not prose. One idea per line, a table for a list of facts.
  A shorter file that says only what matters beats a longer one that records all.
- Any claim about repository state cites `path:line` or a command you ran.
- Unverified is a valid answer — say it is unverified and stop.

## Live sites

- Real-site cases must act like a person: search, scroll, save, close, then undo.
- Google account is the primary login, GitHub the secondary.
- Credentials come from env vars only, never committed and never printed.
- A flaky third-party page is never a product regression — hence opt-in.

## Principles

Full text: `.agents/skills/karpathy-guidelines/SKILL.md`. Load it with
`skill({ name: "karpathy-guidelines" })` before writing or reviewing code.

- Think before coding. State assumptions and tradeoffs; ask when unclear.
- Report an inaccessible prerequisite instead of working around it.
- Prefer a cheap reversible commit over an irreversible one.
- Minimum code that solves the problem. Nothing speculative, no unrequested
  flexibility, no abstraction for a single use.
- Surgical changes. Every changed line traces to the request.
- If you notice unrelated dead code, mention it — do not delete it.
- Define success as something verifiable, then loop until it actually runs.

## When something does not work

- A bug or a feature that does not work is a research task first, not a fix task.
- Reproduce it and read the real evidence before changing anything.
- Find the cause before writing the fix — source, tests, git history, and for a
  browser, OS or protocol quirk, the primary source that documents it.
- State a falsifiable hypothesis, then name the evidence that would confirm it.
- If web search returns nothing, drive the site yourself; first-hand evidence wins.

## Boundaries

- Ask first: deleting foreign code, merge, promote, deploy, new top-level
  entries, production DB shape.
- Never: commit secrets, weaken a test to admit a violation, share one checkout.
- Decline unclear work instead of guessing.

## Scoped instructions

- Area `AGENTS.md`, new or edited: ≤15 lines, pointers only.
- Opens with the root-binds line.
- must not contradict the root.
- Register new ones in the Bootstrap table the same commit.

## Repository discipline

- One writer per checkout. A dirty tree means STOP; never end dirty or diverged.
- Preserve before overwrite: never discard work you did not create.
- Mention, do not delete, pre-existing code this work did not create. Report it to the
  owner in the same session.
- Remove it only when the change requires it, and say which of the two happened in the
  commit message.
- Put work you must not lose on a branch or a stash, never in a directory nothing reads.
- Acceptance basis is CI evidence: GitHub Actions and Vercel SUCCESS on the exact head.
- Deployment and release promotion are owner decisions, never granted by CI green alone.

## Naming

- Files are kebab-case. The conventional root documents are the exception and stay
  uppercase: `README.md`, `AGENTS.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
  `ROADMAP.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `LICENSE`.
- No lifecycle token in any name: `tmp`, `temp`, `draft`, `wip`, `untitled`, `backup`,
  `copy`, `old`, `final<n>`.
- A name says what a thing is, not where it sits in a workflow.
- Root entries are allowlisted in `tests/repo-naming-governance.test.mjs`. Extend that
  list with a reason in the same commit, or move the file into its proper directory.
- Branches: `main`, `release/<semver>`, or
  `feat|fix|chore|docs|test|perf|refactor/<kebab>`.
- Tests are `tests/<name>.test.mjs`. `tests/cloud`, `tests/postgres`, and `tests/deno`
  are live-only and never run in `npm test`.

## Model

- opencode.json pins the model to `opencode/space-bunny-free`.
- The closeout must state which model ran.
- Silent model drift is invisible until the work is reviewed.

## Session close

- Touch `docs/` only when the session changed code or released state.
- A read-only or test-only session leaves both context files alone.
- Verifying means running the thing, not reading it and asserting it would work.
