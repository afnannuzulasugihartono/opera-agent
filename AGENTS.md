@last-edited: 2026-10-05 19:45 UTC+7.
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

- **Reach everyone, so ship it to production.** The product is the deployed edge functions, the applied migrations and a signed CRX; a green `main` is not it. Do the deploy work that is yours. Ask the owner for release, signing key and Supabase PATs, and say which one you need. See [`ROADMAP.md`](ROADMAP.md) and [`docs/HANDOFF.md`](docs/HANDOFF.md).
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

- Don't write prose paragraphs in a `.md`.
- Don't write history in place of state: no change narrative, no incident timeline, no migration story.
- Don't write a `.md` without its `@related` tag and map row, or an `@related` tag without the hub.
- Don't dismiss a red doc-graph as "only docs".
- Don't explain in [`AGENTS.md`](AGENTS.md). Don't instruct in [`README.md`](README.md).

## Triggers

| Trigger | Action |
|---|---|
| each turn, before acting | think first: re-read Always, Goals, Priority order, Strict rules and the map, name the assumption and the tradeoff, then act |
| every task | the `.md` set rides with it: this file, the area scope, then [`docs/HANDOFF.md`](docs/HANDOFF.md) |
| "lanjutkan" | read this file, then [`docs/HANDOFF.md`](docs/HANDOFF.md), then [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| "autonomously", "sampai mission tercapai" | keep going until the mission is reached. Do not ask, do not hand back a partial result with a question at the end |
| "upgrade terus", owner leaves | keep improving until the time named. Commit each verified step, keep the tree clean, leave a note in [`docs/HANDOFF.md`](docs/HANDOFF.md) |
| a verified step passes | push it to `origin/main` at once |
| "apa langkah selanjutnya" | do not start work. Read [`ROADMAP.md`](ROADMAP.md), then say what is broken or undecided, and the choice the owner must make |
| a question about latency or a number | read [`docs/benchmarks.md`](docs/benchmarks.md) first. Never quote a figure from memory |
| pairing, an incident, or the live site | read [`docs/runbook.md`](docs/runbook.md) first, then act |
| about to commit | re-read Strict rules and Session close, then commit |
| "merelakan", "hapus aja" | decided. Stop relitigating and do it |
| something is broken | fix it first, and research before fixing |
| a lock, comment or doc is too long | cut it, or split it into baby steps |
| using a language or library | read its official docs first |
| about to claim it works | drive it yourself |
| a shell command mangled itself | it is PowerShell. Move the script into a file and run it, as Working here states |
| the live page disagrees with the repository | read `x-vercel-cache` and `age` before touching code; a stale edge copy is the more common cause |
| adding a test to lock a removal | never. A preference is not irreversible |
| three failures, no new evidence | blocked: stop editing and report |
| a real site shows a problem | ours until proven otherwise. Record it in [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| you need a document | use the map below, never a guess or a repo-wide grep |
| writing [`AGENTS.md`](AGENTS.md) | instructions only: do and don't, with the reason in the same line. Explain nothing |
| writing [`README.md`](README.md) | explanation only. Instruct nothing |
| about to edit code | apply Code rules: read, write, comment, test |
| about to edit a `.md` | apply Document rules: read, write |
| about to add a file or a function | prove no existing function solves it first |

## Working here

The toolchain fails here in ways that look like your own mistake. Read this once, before the first command.

- **The shell is PowerShell**, so `&&`, heredocs and `<<EOF` do not exist. Chain with `;` and put anything multi-line in a file.
- **Never hand JavaScript to `node -e`.** PowerShell eats `"`, backticks and `$`, and a silently mangled regex answers a different question than the one you asked. Write `C:\Users\ASUS\AppData\Local\Temp\opencode\<name>.mjs` and run `node <path>`.
- **Code Mode has no filesystem and no timers.** `setTimeout` throws there and `fs` is unavailable, so do file work through the shell tool and long waits with a polling loop.
- Do run one file while iterating, `node --test tests/<name>.test.mjs`, and the whole suite only to accept. `npm test` globs 91 files and takes minutes.
- Do remember `npm test` does not recurse, so a test placed in a subdirectory silently never runs.
- Do use `npm run check` as the syntax gate: `node --check` exits 0 on a broken `.ts`.
- Do use `py`, never `python`, which hits the Microsoft Store shim.

## The live site

`opera-agent.vercel.app` is the product's front door and a deployment of its own, not a mirror of the working tree.

- Do expect a green push to deploy nothing: [`landing/vercel.json`](landing/vercel.json) sets `git.deploymentEnabled: false` because the Hobby allowance is 100 deployments a day and every push spent one.
- Do deploy through `POST https://api.vercel.com/v13/deployments`, because the CLI refuses this project from either directory: Root Directory is `landing`, so the CLI resolves `landing/landing` and stops. In that call `file` carries the path, `data` carries the bytes, and `forceNew=1` bypasses deduplication against the copy already cached.
- Do prefix every uploaded path with `landing/` and walk the tree recursively. A top-level read drops every directory, and the result published the site without `landing/oauth/consent.html` so the consent screen answered 404 while all seven other pages looked perfect.
- Do read `x-vercel-cache` and `age` before believing a live page: `Cache-Control` governs the browser, the edge obeys only `Vercel-CDN-Cache-Control`, and a copy an hour old survived a deploy.
- Do compare the served bytes with the repository, because a page once shipped `./index.html` links, which resolve against `/oauth/` and 404 every one of them.
- Do ask the owner before a deploy, a promote, a migration or a production DB change.

## Verify by driving it

- Drive the real thing before saying it works.
- Watch for our own blind spot: Maps and YouTube expose an unlabeled a11y tree. Reach such a page by URL, and act by coordinates.

## When something does not work

- Reproduce it before reading the evidence, and research it before fixing it.
- State a falsifiable hypothesis, then name the evidence that would confirm it.
- Stop editing and report after three failures with no new evidence.
- Report an inaccessible prerequisite instead of working around it.

## Live sites

**Do**

- Do act like a person: search, scroll, save, close, then undo.
- Do use the Google account first, GitHub second.
- Do take credentials from env vars only.
- Do keep the live suite opt-in behind `OA_REAL_SITE=1`.

**Don't**

- Don't click a fixed list of coordinates and call it covered.
- Don't commit a credential, or print one.
- Don't fail the suite on a third party's outage.

## Boundaries

**Do**

- Do ask first: deleting foreign code, merge, promote, deploy, new top-level entries, production DB shape.
- Do decline unclear work, and do leave a test that fails.
- Do take the model endpoint, key and model name from the user's own configuration, kept on their device, and fail closed when they are absent.

**Don't**

- Don't assume any of those is covered by "work autonomously".
- Don't guess, and don't weaken a test to admit a violation.
- Don't ship a shared or embedded model key. One key inside N distributed packages is a public key, and it turns every user's model call into someone else's bill.

## Scoped instructions

**Do**

- Do keep an area [`AGENTS.md`](AGENTS.md) at 15 lines or fewer, pointers only.
- Do open it with the root-binds line, keep it consistent with the root, and register a new one in the Bootstrap table in the same commit.

**Don't**

- Don't let it grow into a second manual.
- Don't let it contradict the root.
- Don't add one that nothing points at.

## Repository discipline

**Do**

- Do keep one writer per checkout, and stop on a dirty tree.
- Do preserve work you did not create, and mention it in the same session.
- Do say in the commit message whether you removed pre-existing code and why.
- Do park work you must not lose on a branch or a stash.
- Do accept on CI evidence: SUCCESS on the exact head.
- Do ask the owner to deploy and to promote a release.

**Don't**

- Don't write from two sessions at once.
- Don't end dirty or diverged.
- Don't delete pre-existing code silently, or remove it as tidying.
- Don't accept on local green, and don't deploy or promote on your own.

## Naming

**Do**

- Do name files in kebab-case, for what they are, with no lifecycle token in the name.
- Do keep the conventional root documents uppercase: [`README.md`](README.md), [`AGENTS.md`](AGENTS.md), [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CHANGELOG.md`](CHANGELOG.md), [`ROADMAP.md`](ROADMAP.md), [`SUPPORT.md`](SUPPORT.md), `CODE_OF_CONDUCT.md`, [`LICENSE`](LICENSE).
- Do extend the root allowlist in [`tests/repo-naming-governance.test.mjs`](tests/repo-naming-governance.test.mjs) with a reason in the same commit.
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

## Bootstrap order

- Read this file, [`docs/HANDOFF.md`](docs/HANDOFF.md), [`docs/CONTEXT.md`](docs/CONTEXT.md). Open only files those three name.

| Area | Read first |
|---|---|
| `extension/` | [`extension/AGENTS.md`](extension/AGENTS.md) |
| `landing/` | [`landing/AGENTS.md`](landing/AGENTS.md) |
| `lib/` | [`lib/AGENTS.md`](lib/AGENTS.md) |
| `supabase/` | [`supabase/AGENTS.md`](supabase/AGENTS.md) |

## Which document answers what

The map. Each row is a condition and a target, so it belongs here and not in [`README.md`](README.md).

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

Keep every `.md` reachable: a `Related:` header plus a row above. Update both when you add or rename one.

## Commands

- `npm test` — the fast suite over `tests/*.test.mjs`, 91 files, the acceptance gate.
- `node --test tests/<name>.test.mjs` — one file, the iteration loop.
- `npm run check` — runtime discovery and version pins, and the only gate that catches a broken `.ts`.
- `npm run scope -- "<task>"` — which files a task touches, for when none was named.
- `py tests/browser_extension_test.py` — the browser harness, headed against Brave on this machine.
- `$env:OA_REAL_SITE='1'; py tests/real_site_smoke.py` — live internet, opt-in, and it drives a local mock bridge.
- Deploy the site by the REST API, as `## The live site` states. Ask the owner first, and read the live page afterwards.
- Run the Deno gates on CI only. Accept on CI evidence, never on local green.

## Session close

**Do**

- Do verify by running the thing.
- Do touch `docs/` only when the session changed code or released state.
- Do state which model ran, and push every verified increment.

**Don't**

- Don't verify by reading it and asserting it would work.
- Don't rewrite `docs/` on a read-only session.
- Don't leave a verified win in a local commit.