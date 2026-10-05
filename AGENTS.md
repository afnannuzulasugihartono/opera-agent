@last-edited: 2026-10-06 00:35 UTC+7.
@related: [`README.md`](README.md) - [`docs/HANDOFF.md`](docs/HANDOFF.md) - [`docs/CONTEXT.md`](docs/CONTEXT.md)

# Opera Agent agent instructions

MV3 browser extension + Supabase backend. This file binds every task, in every area.


## Always

These ride with every job. Read them before acting, not once per session.

- Code first, comments second. Ship the smallest mechanism that works, then say why in the comments.
- Think before you act. Read the guidance, name the assumption and the tradeoff, choose against the Priority order, and only then write. Don't start editing while the design is still undecided.
- Simplify first, in every file and in every `.md` including this one. One that solves it beats two that don't.
- State what is true now, never its history.
- Cover every button on every site. After the main sites hold, add sites that teach new functions.
- Grow the capability the Goals name. Every change raises Function, Feature or Speed toward one of them, and a change that raises none of them is not the next thing.
- Obey the logic gates. A command in a `.md` must not contradict itself, must not contradict a command in another `.md`, and must not contradict the code it governs. Precedence settles it and the lower one is corrected in the same commit.
- These `.md` files are the brain and they come with the work: read the hub, then the area scope, then act.
- Drive it yourself before you say it works. A green suite and a skip are not proof.

## Goals

- **Reach everyone, so ship it to production.** The product is the deployed edge functions, the applied migrations and a signed CRX; a green `main` is not it. Do the deploy work that is yours. A CRX signing key is generated locally and held in the `CRX_SIGNING_KEY` repository secret, so never ask the owner for one; ask only for release, Vercel and Supabase PATs, and say which one you need. See [`ROADMAP.md`](ROADMAP.md) and [`docs/HANDOFF.md`](docs/HANDOFF.md).
- **Cover every site, Google first.** Maps, YouTube and Docs are the main hold; GitHub and Wikipedia teach the new functions. Do push past one happy path per site. What the extension may do: [`extension/README.md`](extension/README.md).
- **Be a companion with an AI behind it.** The person talks to an assistant, the assistant drives Opera Agent, and the work lands as a real artefact: ask for a Word document in a chat and the document exists. Do build it as server-side workflows over the generic primitives in [`docs/api.md`](docs/api.md). Don't put site-specific code in the extension.
- Do serve the goals in the Priority order below: working function first, feature second, speed third.

## Mission

- The runtime code is the product: [`extension/`](extension/README.md), [`lib/`](lib/AGENTS.md), [`supabase/functions/`](supabase/README.md). Docs and tests support it, never the task.
- Do progress the runtime every session. Don't end a session with only simplified docs and tests.
- `.md` files are memory, rules and current state; every other file acts. Ship nothing, and justify it, when a session changes no runtime code.
- Run `npm run scope -- "<task>"` when no file is named, then edit what it picks. Say so instead when scope shows the problem lives in a test or a doc.

## Priority order

Choose in this order. Simple outranks all three.

1. **Function** — it works, proven by driving it.
2. **Feature** — justified by a real case. No case, no feature.
3. **Speed** — short round trips. Measure before claiming a gain.

## Precedence

Highest wins.

1. The owner, in this conversation.
2. [`AGENTS.md`](AGENTS.md) — this file. Area scopes: [`extension/AGENTS.md`](extension/AGENTS.md), [`landing/AGENTS.md`](landing/AGENTS.md), [`lib/AGENTS.md`](lib/AGENTS.md), [`supabase/AGENTS.md`](supabase/AGENTS.md).
3. [`SECURITY.md`](SECURITY.md).
4. [`docs/CONTEXT.md`](docs/CONTEXT.md) — durable traps.
5. [`docs/HANDOFF.md`](docs/HANDOFF.md) — current state and open items.
6. Git history — spent detail. There is no archive file.

## Strict rules

Bind every session, in every area. Nothing below overrides them.

**Code — read, write, comment, test**

**Do**

- Do read the target first: scope before editing, open only named files, read slices.
- Do write the failing test first, then the smallest mechanism. Do change only what the request needs.
- Do keep the file count down: one function that solves it beats two that do. Do reuse the simplest existing function that covers the case.
- Do carry a four-tag header on every file that can hold one, one `@` tag per line: `@last-edited` in Jakarta time (UTC+7), `@title`, `@state`, `@dependencies`. A `.md` carries `@last-edited` then `@related` and nothing else.
- Do rewrite a tag only when its own statement would be wrong. A stamp repeated on an edit that changed nothing else buries the real change in the diff.
- Do comment header WHAT, body WHY. Do name every file and function. Do write current state in comments too, never a change narrative.
- Do surround every comment block with blank lines: one before its first line, one after its last.
- Do test by driving it. Do prove the lock fails. Do cite the evidence. Do say unverified and stop.

**Don't**

- Don't leave a stale header behind, or header what cannot carry one: applied migrations, JSON, lockfiles, LICENSE.
- Don't put the blank line after the code a comment documents. The gap belongs around the comment block, not after the statement.
- Don't write the mechanism first, and don't claim without running.
- Don't state facts from memory, and don't write a test that validates a claim.
- Don't accept a lock that asserts a sentence. Don't weaken a test.
- Don't add a file or a function that duplicates one.

**Documents — read, write**

These bind every `.md` in the repository, this set included, and every other file besides. A file that contradicts them is the wrong one.

**Do**

- Do hold every `.md` to the same obligations: `@last-edited`, an `@related` tag, a map row, bullets, and a stated capability. Don't let a file claim an exemption.
- Do keep the logic gates green: no `Do X` anywhere beside a `Don't X`, and no rule stated twice in two forms. `tests/hygiene.test.mjs` fails on both.
- Do read through the map below, and don't guess or grep.
- Do write bullets: one idea per line, current state, full-path links.
- Do keep a document goal-driven: every entry states the capability it serves, and a document nobody reads should be deleted rather than kept tidy.
- Do update `@last-edited` on every `.md` edit, in Jakarta time (UTC+7).
- Do write for the gate: keep doc-graph green — links resolve, no orphans, hub-mutual.
- Do write instructions (do, don't) in [`AGENTS.md`](AGENTS.md), and explanations (what files do, where docs live) in [`README.md`](README.md).

**Don't**

- Don't let an area [`AGENTS.md`](AGENTS.md) grow into a second manual or contradict the root.
- Don't add an area file with nothing pointing at it.
- Don't write prose paragraphs in a `.md`.
- Don't write history in place of state: no change narrative, no incident timeline, no migration story.
- Don't write a `.md` without its `@related` tag and map row, or an `@related` tag without the hub.
- Don't dismiss a red doc-graph as "only docs".
- Don't explain in [`AGENTS.md`](AGENTS.md). Don't instruct in [`README.md`](README.md).

## Deploy

- Do deploy through `POST https://api.vercel.com/v13/deployments`: the CLI refuses this project
  from either directory because Root Directory is `landing`, so it resolves `landing/landing`.
  In that call `file` carries the path, `data` the bytes, and `forceNew=1` bypasses deduplication
  against the copy already cached.
- Do prefix every uploaded path with `landing/` and walk the tree recursively. A top-level read
  drops every directory, and one deploy published the site without `landing/oauth/consent.html`.
- Do read `x-vercel-cache` and `age` before believing a live page: the edge obeys only
  `Vercel-CDN-Cache-Control`, and a copy an hour old survived a deploy.
- Don't expect a green push to deploy anything: [`landing/vercel.json`](landing/vercel.json)
  disables it, because the Hobby allowance is 100 deployments a day.

## Naming

**Do**

- Do name files in kebab-case, for what they are, with no lifecycle token in the name.
- Do keep the conventional root documents uppercase: [`README.md`](README.md), [`AGENTS.md`](AGENTS.md), [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CHANGELOG.md`](CHANGELOG.md), [`ROADMAP.md`](ROADMAP.md), [`SUPPORT.md`](SUPPORT.md), `CODE_OF_CONDUCT.md`, [`LICENSE`](LICENSE).
- Do branch `main`, `release/<semver>`, or `feat|fix|chore|docs|test|perf|refactor/<kebab>`, and name tests `tests/<name>.test.mjs`.

**Don't**

- Don't use spaces, dots or capitals in a filename, or rename a conventional root document to kebab-case.
- Don't put `tmp`, `temp`, `draft`, `wip`, `untitled`, `backup`, `copy`, `old`, `final<n>` in a name.
- Don't name a thing for where it sits in a workflow, or add a root entry without a reason.
- Don't use any other branch name.
- Don't put `tests/cloud`, `tests/postgres` or `tests/deno` in `npm test`.

## Model

**Do**

- Do use whichever model is pinned in [`opencode.json`](opencode.json), and do state which one ran in the closeout.

**Don't**

- Don't change the pin silently, and don't leave the reader guessing.

## Which document answers what

The map. Each row is a condition and a target, so it belongs here and not in [`README.md`](README.md).

| Need | Read |
|---|---|
| area scope, first read | [`extension/AGENTS.md`](extension/AGENTS.md), [`landing/AGENTS.md`](landing/AGENTS.md), [`lib/AGENTS.md`](lib/AGENTS.md), [`supabase/AGENTS.md`](supabase/AGENTS.md) |
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

Keep every `.md` reachable: a `Related:` header plus a row above. Update both when you add or rename one.