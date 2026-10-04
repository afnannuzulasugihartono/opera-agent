# Opera Agent agent instructions

Simplify first. State what is true now, never its history.

MV3 browser extension + Supabase backend. Read before changing anything.

Related: [`README.md`](README.md) - [`docs/HANDOFF.md`](docs/HANDOFF.md) - [`docs/CONTEXT.md`](docs/CONTEXT.md)

## Mission

- Ship a runtime change. The runtime code is the product: [`extension/`](extension/README.md), [`lib/`](lib/AGENTS.md), [`supabase/functions/`](supabase/README.md).
- Ship docs and tests to support it. Docs and tests support them — never the task.
- `.md` files are the brain: memory, rules, current state. Every other file is the body: it acts.
- Ship nothing, and justify it, when a session ships no runtime change.
- Run `npm run scope -- "<task>"` when no file is named, then edit what it picks.
- Say so instead when scope shows the problem lives in a test or a doc.

## Precedence

Highest wins.

1. The owner, in this conversation.
2. [`AGENTS.md`](AGENTS.md) — this file. Area scopes: [`extension/AGENTS.md`](extension/AGENTS.md), [`lib/AGENTS.md`](lib/AGENTS.md), [`supabase/AGENTS.md`](supabase/AGENTS.md).
3. [`SECURITY.md`](SECURITY.md).
4. [`docs/CONTEXT.md`](docs/CONTEXT.md) — durable traps.
5. [`docs/HANDOFF.md`](docs/HANDOFF.md) — what shipped last session.
6. Git history — spent detail. There is no archive file.

## Priority order

1. **Function** — it works, proven by driving it.
2. **Feature** — justified by a real case. No case, no feature.
3. **Speed** — short round trips. Measure before claiming a gain.

Simple outranks all three.

## Strict rules

Bind every session, in every area. Nothing below overrides them.

**Code — read, write, comment, test**

- Read the target first: scope before editing, open only named files, read slices.
- Write the failing test first, then the smallest mechanism. Change only what the request needs.
- Comment header WHAT, body WHY. Name every file and function. Write current state in comments too, never a change narrative.
- Test by driving it. Prove the lock fails. Cite the evidence. Say unverified and stop.
- Never: mechanism first, claim without running, facts from memory, a test that validates a claim, a lock that asserts a sentence, a weakened test.

**Documents — read, write**

**Do**

- Read through the map below. Never guess, never grep.
- Write bullets: one idea per line, current state, full-path links.
- Write a `Related:` line on every `.md`, naming the hub and its relatives, plus the map row in the same commit.
- Write for the gate: keep doc-graph green — links resolve, no orphans, hub-mutual.
- Write instructions (do, don't) in [`AGENTS.md`](AGENTS.md). Write explanations (what files do, where docs live) in [`README.md`](README.md).

**Don't**

- Write prose paragraphs in a `.md`.
- Write history in place of state: no change narrative, no incident timeline, no migration story.
- Write a `.md` without its `Related:` line and map row, or a `Related:` line without the hub.
- Dismiss a red doc-graph as "only docs".
- Explain in [`AGENTS.md`](AGENTS.md). Instruct in [`README.md`](README.md).

## Triggers

| Trigger | Action |
|---|---|
| "lanjutkan" | read this file, then [`docs/HANDOFF.md`](docs/HANDOFF.md), then [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| "autonomously", "sampai mission tercapai" | keep going until the mission is reached. Do not ask, do not hand back a partial result with a question at the end |
| "upgrade terus", owner leaves | keep improving until the time named. Commit each verified step, keep the tree clean, leave a note in [`docs/HANDOFF.md`](docs/HANDOFF.md) |
| a verified step passes | push it to `origin/main` at once |
| "apa langkah selanjutnya" | do not start work. Read [`ROADMAP.md`](ROADMAP.md), then say what is broken or undecided, and the choice the owner must make |
| a question about latency or a number | read [`docs/benchmarks.md`](docs/benchmarks.md) first. Never quote a figure from memory |
| pairing, deploy, or an incident | read [`docs/runbook.md`](docs/runbook.md) first, then act |
| about to commit | re-read Strict rules and Session close above, then commit |
| each turn, before acting | re-read Mission, Priority order, Strict rules, and the map above, then act |
| "merelakan", "hapus aja" | decided. Stop relitigating and do it |
| something is broken | fix it first, and research before fixing |
| a lock, comment or doc is too long | cut it, or split it into baby steps |
| using a language or library | read its official docs first |
| about to claim it works | drive it yourself. A green suite and a skip are not proof |
| adding a test to lock a removal | never. A preference is not irreversible |
| three failures, no new evidence | blocked: stop editing and report |
| a real site shows a problem | ours until proven otherwise. Record it in [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| you need a document | use the map below, never a guess or a repo-wide grep |
| writing or editing [`AGENTS.md`](AGENTS.md) | instructions only: do and don't. Explain nothing |
| writing or editing [`README.md`](README.md) | explanation only: what files do, where docs live. Instruct nothing |
| about to edit code | apply Code rules: read, write, comment, test |
| about to edit a `.md` | apply Document rules: read, write |

## Verify by driving it

- Drive the real thing before saying it works.
- Watch for our own blind spot: Maps and YouTube expose an unlabeled a11y tree.
- Reach a page with an empty a11y tree by URL, and act by coordinates.

## Bootstrap order

- Read this file, [`docs/HANDOFF.md`](docs/HANDOFF.md), [`docs/CONTEXT.md`](docs/CONTEXT.md).
- Open only files those three name.

| Area | Read first |
|---|---|
| `extension/` | [`extension/AGENTS.md`](extension/AGENTS.md) |
| `lib/` | [`lib/AGENTS.md`](lib/AGENTS.md) |
| `supabase/` | [`supabase/AGENTS.md`](supabase/AGENTS.md) |

## Which document answers what

The map. Each row is a condition and a target, so it belongs here and not in
[`README.md`](README.md), which describes the project instead.

| Need | Read |
|---|---|
| pairing, incidents, manual steps | [`docs/runbook.md`](docs/runbook.md) |
| command and response contract | [`docs/api.md`](docs/api.md) |
| latency baselines and locked ceilings | [`docs/benchmarks.md`](docs/benchmarks.md) |
| the delta-first runtime plan | [`docs/delta-first-performance-plan.md`](docs/delta-first-performance-plan.md) |
| the accessibility-tree observation | [`docs/ax-observation.md`](docs/ax-observation.md) |
| what is still open | [`ROADMAP.md`](ROADMAP.md) |
| what changed in a release | [`CHANGELOG.md`](CHANGELOG.md) |
| how to propose a change | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| where to ask for help | [`SUPPORT.md`](SUPPORT.md) |
| what the extension may do | [`extension/README.md`](extension/README.md) |
| what the edge functions and migrations are | [`supabase/README.md`](supabase/README.md) |
| what the scripts folder is for | [`scripts/README.md`](scripts/README.md) |
| what the suites cover | [`tests/README.md`](tests/README.md) |
| security boundary and token transport | [`SECURITY.md`](SECURITY.md) |
| traps that caused a false claim | [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| what shipped last session | [`docs/HANDOFF.md`](docs/HANDOFF.md) |
| behavioral guidelines before writing code | [`.agents/skills/karpathy-guidelines/SKILL.md`](.agents/skills/karpathy-guidelines/SKILL.md) |

Keep every `.md` reachable: a `Related:` header plus a row above. Update both when
you add or rename one.

## Commands

- `npm test` — fast suite (`tests/*.test.mjs`).
- `npm run check` — runtime discovery + version pins.
- `py [`tests/browser_extension_test.py`](tests/browser_extension_test.py)` — browser harness.
- `OA_REAL_SITE=1 py [`tests/real_site_smoke.py`](tests/real_site_smoke.py)` — live internet, opt-in.
- Run the Deno gates on CI only. Accept on CI evidence, never on local green.

## Live sites

**Do**

- Act like a person: search, scroll, save, close, then undo.
- Use the Google account first, GitHub second.
- Take credentials from env vars only.
- Keep the live suite opt-in behind `OA_REAL_SITE=1`.

**Don't**

- Click a fixed list of coordinates and call it covered.
- Commit a credential, or print one.
- Fail the suite on a third party's outage.

## Principles

Full text: [`.agents/skills/karpathy-guidelines/SKILL.md`](.agents/skills/karpathy-guidelines/SKILL.md).
Load it with `skill({ name: "karpathy-guidelines" })` before writing code.

- Do first, explain later. Write the command, not its justification.
- Think before coding. Explain the assumption and the tradeoff. Ask when unclear.
- Report an inaccessible prerequisite instead of working around it.
- Prefer a cheap reversible commit over an irreversible one.
- Write the minimum that solves the problem.
- Mention unrelated dead code. Never delete it.
- Define success as something verifiable, then loop until it runs.

## When something does not work

- Research it before fixing it.
- Reproduce it, then read the evidence.
- Find the cause in the source, the tests, git history, and the primary source.
- State a falsifiable hypothesis, then name the evidence that would confirm it.
- Stop editing and report after three failures with no new evidence.
- Drive the site yourself when web search returns nothing.

## Boundaries

**Do**

- Ask first: deleting foreign code, merge, promote, deploy, new top-level entries, production DB shape.
- Decline unclear work.
- Leave a test that fails.

**Don't**

- Assume any of those is covered by "work autonomously".
- Guess.
- Weaken a test to admit a violation.

## Scoped instructions

**Do**

- Keep an area [`AGENTS.md`](AGENTS.md) at 15 lines or fewer, pointers only.
- Open it with the root-binds line.
- Keep it consistent with the root.
- Register a new one in the Bootstrap table in the same commit.

**Don't**

- Let it grow into a second manual.
- Let it contradict the root.
- Add one that nothing points at.

## Repository discipline

**Do**

- Keep one writer per checkout.
- Stop on a dirty tree.
- Preserve work you did not create.
- Mention pre-existing code this work did not create, in the same session.
- Say in the commit message whether you removed it and why.
- Park work you must not lose on a branch or a stash.
- Accept on CI evidence: GitHub Actions and Vercel SUCCESS on the exact head.
- Ask the owner to deploy and to promote a release.

**Don't**

- Write from two sessions at once.
- End dirty or diverged.
- Delete pre-existing code silently, or remove it as tidying.
- Accept on local green.
- Deploy or promote on your own.

## Naming

**Do**

- Name files in kebab-case.
- Keep the conventional root documents uppercase: [`README.md`](README.md), [`AGENTS.md`](AGENTS.md), [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CHANGELOG.md`](CHANGELOG.md), [`ROADMAP.md`](ROADMAP.md), [`SUPPORT.md`](SUPPORT.md), `CODE_OF_CONDUCT.md`, [`LICENSE`](LICENSE).
- Leave lifecycle tokens out of every name.
- Name a thing for what it is.
- Extend the root allowlist in [`tests/repo-naming-governance.test.mjs`](tests/repo-naming-governance.test.mjs) with a reason in the same commit.
- Branch `main`, `release/<semver>`, or `feat|fix|chore|docs|test|perf|refactor/<kebab>`.
- Name tests `tests/<name>.test.mjs`.

**Don't**

- Use spaces, dots, or capitals in a filename.
- Rename a conventional root document to kebab-case.
- Put `tmp`, `temp`, `draft`, `wip`, `untitled`, `backup`, `copy`, `old`, `final<n>` in a name.
- Name a thing for where it sits in a workflow.
- Add a root entry without a reason.
- Use any other branch name.
- Put `tests/cloud`, `tests/postgres`, or `tests/deno` in `npm test`.

## Model

**Do**

- Keep the model at `opencode/space-bunny-free`, pinned in [`opencode.json`](opencode.json).
- State which model ran in the closeout.

**Don't**

- Drift the model silently.
- Leave the reader to guess.

## Session close

**Do**

- Touch `docs/` only when the session changed code or released state.
- Leave both context files alone on a read-only or test-only session.
- Verify by running the thing.
- State which model ran, and push every verified increment.

**Don't**

- Rewrite `docs/` on a read-only session.
- Verify by reading it and asserting it would work.
- Leave a verified win in a local commit.