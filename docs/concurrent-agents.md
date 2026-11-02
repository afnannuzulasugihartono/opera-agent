# Working on this repo from more than one agent

Kilo, Cline, OpenCode, and whatever agent comes next all work on this tree. This page is the setup that lets them work at the same time without overwriting each other, and it is written for any of them because it uses nothing but git, node, and the commands the repo already has.

## Why the shared checkout is off limits

Two agents editing one working tree take turns overwriting each other's files, and the overwrite is silent: the second save wins, the first agent's reasoning is gone, and neither error message says what happened. A git worktree is the isolation mechanism every coding agent already understands, because it is git itself — so every agent works in its own worktree and branches from there.

## The setup, for any agent

```bash
node scripts/agent-worktree.mjs create <name> [base-branch] [topic]
```

That one command:

- creates a worktree beside the repo, at `../opera-agent-<name>`,
- puts it on the branch `agent/<name>`, or `agent/<name>/<topic>` when you pass a topic, cut from the base you named (default `main`),
- copies every `.env*` file from the main checkout, because a worktree without them cannot run the gates,
- runs the install, so the worktree is immediately usable.

```bash
node scripts/agent-worktree.mjs list
```

Shows every worktree, the branch it holds, and whether that branch fits the shape, and marks the main checkout so nothing drives from it by accident.

```bash
node scripts/agent-worktree.mjs remove <name>
```

Archives every branch under `agent/<name>` as a tag — `archive/<branch>-<date>`, with the merge state in the tag message — and only then deletes the branches and the worktree. A branch that was never merged is reachable from nothing else, so its tag is the only thing standing between the delete and losing a session's reasoning. A name that holds nothing is refused, so a sentence about an archive is always about one.

## The branch shape

```bash
npm run branches
```

A work branch is `agent/<workspace>`, with an optional `/topic`: the first segment is the worktree — one machine and one checkout — and the second is one line of work inside it. Every segment is lowercase letters, digits and single hyphens, so a name survives git, a pull-request URL and every shell without quoting. The trunk is `main`, and an archived branch is a tag under `archive/`.

`npm run branches` reads every branch on the clone and prints the ones that do not fit beside the name they should have had — for example `agent/operafetch/operafetch -> agent/operafetch`, because a topic that repeats the worktree names one thing twice. Renaming is its owner's call, since the old name may be checked out elsewhere and named in an open pull request; the report is the whole intervention, and [`branch-name.mjs`](../scripts/branch-name.mjs) is the one place the shape is written.

## What you run inside a worktree

```bash
npm test
npm run check
```

Both are yours alone: a green tree in one worktree says nothing about another. Never weaken a gate to go green. When a boundary legitimately moves — a frozen hash, a pinned public surface — re-pin it with `npm run gates:refresh` and write the reason in the commit; the gate's own message tells you which of the two cases you are in.

## What a worktree cannot isolate

Some things exist once per machine, and a worktree does not copy them. Handle these one at a time, from the main checkout, and say what you are doing before you do it:

| Shared thing | Rule |
|---|---|
| The everyday browser | One profile, one bridge port. Claim the tab you drive: a call on a tab another agent holds is refused with the claim named, so take a separate tab rather than fight over one caret. `list_tabs` shows what is open, `close_tab` releases your claim, and a claim lapses on its own after a minute of silence. |
| The bridge port | One driver owns it; the rest reach it through the door. Do not kill another agent's driver to take it. |
| Database migrations | Applied one at a time — two sessions applying migrations reorder them, and the reorder is a production incident. |
| Edge function deploys | Deployed one at a time, for the same reason. |
| The signed CRX | Signed once, from a main checkout, after CI is green on the exact release head. |

## Shipping

```bash
git push -u origin agent/<name>        # or agent/<name>/<topic>
gh pr create --base main
```

Keep the branch name, let the reviewer read the claim, and let `remove` archive it once it has landed.

## What this does not need from you

No plugin, no per-tool setting, no MCP server. If your agent can run `node` and `git` — and every coding agent can — it can work on this repo beside every other agent that can.
