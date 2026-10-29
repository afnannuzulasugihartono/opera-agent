@last-edited: 2026-10-07 UTC+7.
@related: [`README.md`](README.md) - [`docs/handoff.md`](docs/handoff.md) - [`docs/security.md`](docs/security.md)

# Opera Agent agent instructions

MV3 browser extension + Supabase backend. This file binds every task, in every area. Every rule in it is bounded to the agent: it governs this agent's own choices, and it says nothing about the user, the product, or the wider world. Where this file is silent, the agent decides.

The agent has 100 percent freedom: simplify, delete, and rewrite anything — tests included — as long as the Goals below move and every word here stays true. A test removed is a claim retired, so replace it with proof of equal strength, never with silence.

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.

## Always

These ride with every job. Read them before acting, not once per session.

- Simplify first, code second, comment third: cut the file to its smallest true shape, then ship the code that works, then say why — in that order.
- Write lists vertically, two spaces per level: an array, object literal, destructuring pattern, parameter list, or import/export list with two or more items puts each item on its own line, indented two spaces per level, so the structure reads as a list top to bottom. `tests/helpers/vertical-lists.mjs` measures the lists and the indentation, `npm run check` enforces both, and `scripts/vertical-lists-baseline.mjs` holds the files still to sweep — that list may only shrink.
- Focus on real code: judge a change by the behaviour it produces when driven, never by prose, plans, or a stub that only looks green.
- Work the Plan → Execute → Fix loop, and repeat it: each round ends with a fresh run against the artefact, not a restated intention. The runs are `npm test` and `npm run check`, plus `py tests/browser_extension_test.py` for anything the extension does inside a page.
- Audit everything, delete the trash, simplify the program: sweep for dead files, dead exports, and stale scaffolds, remove what you find, and leave the tree simpler than you met it.
- Never ask any human for signing keys or any secret material: publisher secrets live only in GitHub Secrets — verify presence with `gh secret list` (names only, values never print), and treat publishing as your own dispatch task, not a question for the owner.

## Goals

- **Reach everyone, so ship it to production.** Deployed edge functions, applied migrations, a signed CRX — a green `main` is not it. Do the deploy work that is yours; ask only for release, Vercel and Supabase PATs. See [`docs/handoff.md`](docs/handoff.md).
- **Cover every site, Google first.** Google Sheets/Excel, Docs, Maps, and YouTube hold the lead; the rest teach the new functions. Do push past one happy path per site. The site does not ever have to be slow about it: grow server-side primitives, not per-site gadgets, so round trips stay short. What the extension may do: [`extension/lib/protocol.js`](extension/lib/protocol.js) and [`docs/api.md`](docs/api.md).
- **Be a companion with an AI behind it.** The person talks, the assistant drives, the work lands as a real artefact. Do build it as server-side workflows over the generic primitives in [`docs/api.md`](docs/api.md). The extension may grow as rich as task-based work needs — including local real-time loops — but every primitive in it stays generic: no per-site code and no free `eval` in the extension, ever.
- **Keep the tree honest.** A dead file, a dead export, a stale scaffold, a shortcut standing where the real code should be — all of it is trash that compounds. Do sweep for it every session and delete what you find.
- **Work in your own worktree, never in the shared checkout.** Two agents in one tree take turns overwriting each other and the overwrite is silent. Make yours with `node scripts/agent-worktree.mjs create <name> [base] [topic]`; `list` shows them all and `remove` archives the branch before it deletes it.
- **Claim the tab you drive.** The everyday browser is one shared profile, so a tool call on a tab another agent holds is refused with the claim named: work on separate tabs, and `list_tabs` says which are open. A claim lapses after a minute of silence and `close_tab` releases it.
- **Do one at a time, from the main checkout, with the others told first:** migrations, edge function deploys, and the signed CRX — a worktree cannot isolate them. See [`docs/concurrent-agents.md`](docs/concurrent-agents.md).

## Priority order

Choose in this order. Simple outranks all three.

1. **Function** — it works, proven by driving it.
2. **Feature** — justified by a real case. No case, no feature.
3. **Speed** — short round trips. Measure before claiming a gain.