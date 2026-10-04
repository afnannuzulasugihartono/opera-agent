# Opera Agent agent instructions

MV3 browser extension + Supabase backend. Read before changing anything.

## Precedence

Highest wins.

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

## Strict rules

These bind every session, in every area. Nothing below overrides them.

**Do**

- Open every file and every function with a comment naming it and what it does.
- Put WHY in the comments inside the body. The header already carries WHAT.
- Write current state. Say what is true now and why.
- Write the failing test first, then the smallest generic mechanism that passes it.
- Drive the thing yourself before saying it works.
- Push every verified increment to `origin/main` at once.
- Keep one writer per checkout, and end with a clean tree.
- Cite `path:line` or the command you ran.
- Write the concrete statement: `Explain the assumption`, not a gesture at one.
- Say it is unverified and stop.

**Don't**

- Write a history book, a change narrative, an incident timeline, or a migration story.
- Leave a function whose name says nothing about what it does.
- Put WHAT in the body comments.
- Write prose paragraphs in a `.md`. Bullets, one idea per line.
- Write a test to make a claim valid.
- Accept a lock that only asserts a sentence exists. Prove it fails on a realistic violation.
- Write the mechanism first and the test after.
- Claim it works without running it.
- Leave a verified win in a local commit.
- End dirty or diverged.
- State a fact about the repository from memory.
- Leave a neutral sentence that only gestures at what it means.
- Commit a secret or print one.

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

- Ship a runtime change. The runtime code is the product: `extension/`, `lib/`,
  `supabase/functions/`.
- Ship docs and tests to support it. Docs and tests support them — never the task.
- Ship nothing, and justify it, when a session ships no runtime change.
- Run `npm run scope -- "<task>"` when no file is named, then edit what it picks.
- Say so instead when scope shows the problem lives in a test or a doc.

## Verify by driving it

- Drive the real thing before saying it works. A green suite and a skip are not proof.
- Watch for our own blind spot: Maps and YouTube expose an unlabeled a11y tree.
- Reach a page with an empty a11y tree by URL, and act by coordinates.

## Bootstrap order

- Read this file, `docs/HANDOFF.md`, `docs/CONTEXT.md`.
- Open only files those three name. Never grep the repo for guidance.
- Run `npm run scope -- "<task>"` before any edit.
- Read slices. Never read a file over 500 lines whole.

| Area | Read first |
|---|---|
| `extension/` | `extension/AGENTS.md` |
| `lib/` | `lib/AGENTS.md` |
| `supabase/` | `supabase/AGENTS.md` |

Read `README.md` for the map of which document answers which question. Never guess,
never grep the repo for guidance.

Keep every `.md` reachable: a one-line `Related:` header plus the map in `README.md`.
Update both when you add or rename one.

## Commands

- `npm test` — fast suite (`tests/*.test.mjs`).
- `npm run check` — runtime discovery + version pins.
- `py tests/browser_extension_test.py` — browser harness.
- `OA_REAL_SITE=1 py tests/real_site_smoke.py` — live internet, opt-in.
- Run the Deno gates on CI only. Accept on CI evidence, never on local green.

## Live sites

**Do**

- Act like a person: search, scroll, save, close, then undo.
- Use the Google account first, GitHub second.
- Take credentials from env vars only.
- Treat a flaky third-party page as the site, not a regression.
- Keep the live suite opt-in behind `OA_REAL_SITE=1`.

**Don't**

- Click a fixed list of coordinates and call it covered.
- Reverse the account order.
- Commit a credential, or print one into a transcript.
- Fail the suite on a third party's outage.
- Put the live suite in `npm test`.

## Principles

Full text: `.agents/skills/karpathy-guidelines/SKILL.md`. Load it with
`skill({ name: "karpathy-guidelines" })` before writing or reviewing code.

- Do first, explain later. Write the command, not its justification.
- Think before coding. Explain the assumption and the tradeoff. Ask when it is unclear.
- Report an inaccessible prerequisite instead of working around it.
- Prefer a cheap reversible commit over an irreversible one.
- Write the minimum that solves the problem. No speculation, no unrequested
  flexibility, no abstraction for a single use.
- Change only what the request needs.
- Mention unrelated dead code. Never delete it.
- Define success as something verifiable, then loop until it runs.

## When something does not work

- Research it before fixing it.
- Reproduce it, then read the evidence.
- Find the cause in the source, the tests, git history, and the primary source for a
  browser, OS, or protocol quirk.
- State a falsifiable hypothesis, then name the evidence that would confirm it.
- Stop editing and report after three failures with no new evidence.
- Drive the site yourself when web search returns nothing.

## Boundaries

**Do**

- Ask first: deleting foreign code, merge, promote, deploy, new top-level entries,
  production DB shape.
- Decline unclear work.
- Keep one checkout per writer.
- Leave a test that fails.
- Keep a secret out of the tree and the transcript.

**Don't**

- Assume any of those is covered by "work autonomously".
- Guess.
- Share a checkout.
- Weaken a test to admit a violation.
- Commit a secret or print one.

## Scoped instructions

**Do**

- Keep an area `AGENTS.md` at 15 lines or fewer, pointers only.
- Open it with the root-binds line.
- Keep it consistent with the root.
- Register a new one in the Bootstrap table in the same commit.

**Don't**

- Let it grow into a second manual.
- Open it with anything else.
- Let it contradict the root.
- Add one that nothing points at.

## Repository discipline

**Do**

- Keep one writer per checkout.
- Stop on a dirty tree.
- Preserve work you did not create.
- Mention pre-existing code this work did not create, in the same session.
- Remove it only when the change requires it, and say which in the commit message.
- Park work you must not lose on a branch or a stash.
- Accept on CI evidence: GitHub Actions and Vercel SUCCESS on the exact head.
- Ask the owner to deploy and to promote a release.

**Don't**

- Write from two sessions at once.
- End dirty or diverged.
- Discard work you did not create.
- Delete pre-existing code silently.
- Remove it as tidying.
- Park work in a directory nothing reads.
- Accept on local green.
- Deploy or promote on your own.

## Naming

**Do**

- Name files in kebab-case.
- Keep the conventional root documents uppercase: `README.md`, `AGENTS.md`,
  `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `ROADMAP.md`, `SUPPORT.md`,
  `CODE_OF_CONDUCT.md`, `LICENSE`.
- Leave lifecycle tokens out: `tmp`, `temp`, `draft`, `wip`, `untitled`, `backup`,
  `copy`, `old`, `final<n>`.
- Name a thing for what it is.
- Extend the root allowlist in `tests/repo-naming-governance.test.mjs` with a reason in
  the same commit.
- Branch `main`, `release/<semver>`, or
  `feat|fix|chore|docs|test|perf|refactor/<kebab>`.
- Name tests `tests/<name>.test.mjs`.

**Don't**

- Use spaces, dots, or capitals in a filename.
- Rename a conventional root document to kebab-case.
- Put a lifecycle token in a name.
- Name a thing for where it sits in a workflow.
- Add a root entry without a reason.
- Use any other branch name.
- Put `tests/cloud`, `tests/postgres`, or `tests/deno` in `npm test`.

## Model

**Do**

- Keep the model at `opencode/space-bunny-free`, pinned in `opencode.json`.
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
- Update them anyway.
- Verify by reading it and asserting it would work.
- Leave a verified win in a local commit.
