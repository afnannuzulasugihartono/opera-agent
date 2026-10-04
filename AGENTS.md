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

- Ship a runtime change: `extension/`, `lib/`, `supabase/functions/`.
- Ship docs and tests only to support it.
- Ship nothing and justify it.
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
| the overview, for a person | [`README.md`](README.md) |
| how to propose a change | `CONTRIBUTING.md` |
| where to ask for help | `SUPPORT.md` |
| what the extension may do | `extension/README.md` |
| what the scripts folder is for | `scripts/README.md` |
| what the edge functions and migrations are | `supabase/README.md` |
| what the suites cover | `tests/README.md` |
| the delta-first runtime plan | `docs/delta-first-performance-plan.md` |
| the accessibility-tree checkpoint | `docs/checkpoint-up1-ax-observation.md` |

Keep every `.md` reachable: a one-line `Related:` header plus this table. Update both
when you add or rename one.

## Commands

- `npm test` — fast suite (`tests/*.test.mjs`).
- `npm run check` — runtime discovery + version pins.
- `py tests/browser_extension_test.py` — browser harness.
- `OA_REAL_SITE=1 py tests/real_site_smoke.py` — live internet, opt-in.
- Run the Deno gates on CI only. Accept on CI evidence, never on local green.

## Standards

| Do | Don't |
|---|---|
| Write current state | Write a history book, a change narrative, an incident timeline, or a migration story |
| Start every file and function with a comment naming it and what it does | Leave a function whose name says nothing about what it does |
| Put WHY in the comments inside the body | Put WHAT in the body comments; the header already carries it |
| Write a test to test | Write a test to make a claim valid |
| Prove a lock fails on a realistic violation before accepting it | Accept a lock that only asserts a sentence exists |
| Write the failing test first, then the smallest mechanism that passes it | Write the mechanism first and the test after |
| Write `.md` as bullets, one idea per line | Write prose paragraphs in a `.md` |
| Cite `path:line` or a command you ran | State a fact about the repository from memory |
| Say it is unverified and stop | Claim it works without running it |

## Live sites

| Do | Don't |
|---|---|
| Act like a person: search, scroll, save, close, then undo | Click a fixed list of coordinates and call it covered |
| Use the Google account first, GitHub second | Reverse the order |
| Take credentials from env vars only | Commit a credential, or print one into a transcript |
| Treat a flaky third-party page as the site, not a regression | Fail the suite on a third party's outage |
| Keep the live suite opt-in behind `OA_REAL_SITE=1` | Put it in `npm test` |

## Principles

Full text: `.agents/skills/karpathy-guidelines/SKILL.md`. Load it with
`skill({ name: "karpathy-guidelines" })` before writing or reviewing code.

- Do first, explain later. Write the command, not its justification.
- Think before coding. State assumptions and tradeoffs; ask when unclear.
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

| Do | Don't |
|---|---|
| Ask first: deleting foreign code, merge, promote, deploy, new top-level entries, production DB shape | Assume any of those is covered by "work autonomously" |
| Decline unclear work | Guess |
| Keep one checkout per writer | Share a checkout |
| Leave a test that fails | Weaken a test to admit a violation |
| Keep a secret out of the tree and the transcript | Commit a secret or print one |

## Scoped instructions

| Do | Don't |
|---|---|
| Keep an area `AGENTS.md` at 15 lines or fewer, pointers only | Let it grow into a second manual |
| Open it with the root-binds line | Open it with anything else |
| Keep it consistent with the root | Let it contradict the root |
| Register a new one in the Bootstrap table in the same commit | Add one that nothing points at |

## Repository discipline

| Do | Don't |
|---|---|
| Keep one writer per checkout | Write from two sessions at once |
| Stop on a dirty tree | End dirty or diverged |
| Preserve work you did not create | Discard it |
| Mention pre-existing code this work did not create, in the same session | Delete it silently |
| Remove it only when the change requires it, and say which in the commit message | Remove it as tidying |
| Park work you must not lose on a branch or a stash | Park it in a directory nothing reads |
| Accept on CI evidence: GitHub Actions and Vercel SUCCESS on the exact head | Accept on local green |
| Ask the owner to deploy and to promote a release | Deploy or promote on your own |

## Naming

| Do | Don't |
|---|---|
| Name files in kebab-case | Use spaces, dots, or capitals in a filename |
| Keep the conventional root documents uppercase: `README.md`, `AGENTS.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `ROADMAP.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `LICENSE` | Rename one of them to kebab-case |
| Leave lifecycle tokens out: `tmp`, `temp`, `draft`, `wip`, `untitled`, `backup`, `copy`, `old`, `final<n>` | Put one in a name |
| Name a thing for what it is | Name it for where it sits in a workflow |
| Extend the root allowlist in `tests/repo-naming-governance.test.mjs` with a reason in the same commit | Add a root entry without a reason |
| Branch `main`, `release/<semver>`, or `feat\|fix\|chore\|docs\|test\|perf\|refactor/<kebab>` | Use any other branch name |
| Name tests `tests/<name>.test.mjs` | Put `tests/cloud`, `tests/postgres`, or `tests/deno` in `npm test` |

## Model

| Do | Don't |
|---|---|
| Keep the model at `opencode/space-bunny-free`, pinned in `opencode.json` | Drift the model silently |
| State which model ran in the closeout | Leave the reader to guess |

## Session close

| Do | Don't |
|---|---|
| Touch `docs/` only when the session changed code or released state | Rewrite `docs/` on a read-only session |
| Leave both context files alone on a read-only or test-only session | Update them anyway |
| Verify by running the thing | Verify by reading it and asserting it would work |
| State which model ran, and push every verified increment | Leave a verified win in a local commit |
