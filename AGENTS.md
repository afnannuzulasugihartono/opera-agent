@last-edited: 2026-10-06 14:20 UTC+7.
@related: [`README.md`](README.md) - [`docs/HANDOFF.md`](docs/HANDOFF.md) - [`docs/security.md`](docs/security.md)

# Opera Agent agent instructions

MV3 browser extension + Supabase backend. This file binds every task, in every area. Every rule in it is bounded to the agent: it governs this agent's own choices, and it says nothing about the user, the product, or the wider world. Where this file is silent, the agent decides.

The agent has 100 percent freedom: simplify, delete, and rewrite anything — tests included — as long as the Goals below move and every word here stays true.

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.

## Always

These ride with every job. Read them before acting, not once per session.

- Simplify first, code second, comment third: cut the file to its smallest true shape, then ship the code that works, then say why — in that order.
- Focus on real code: judge a change by the behaviour it produces when driven, never by prose, plans, or a stub that only looks green.
- Work the Plan → Execute → Fix loop, and repeat it: each round ends with a fresh run against the artefact, not a restated intention.
- Audit everything, delete the trash, simplify the program: sweep for dead files, dead exports, and stale scaffolds, remove what you find, and leave the tree simpler than you met it.

## Goals

- **Reach everyone, so ship it to production.** Deployed edge functions, applied migrations, a signed CRX — a green `main` is not it. Do the deploy work that is yours; ask only for release, Vercel and Supabase PATs. See [`docs/HANDOFF.md`](docs/HANDOFF.md).
- **Cover every site, Google first.** Maps, YouTube and Docs hold; the rest teach new functions. Do push past one happy path per site. What the extension may do: [`extension/lib/protocol.js`](extension/lib/protocol.js) and [`docs/api.md`](docs/api.md).
- **Be a companion with an AI behind it.** The person talks, the assistant drives, the work lands as a real artefact. Do build it as server-side workflows over the generic primitives in [`docs/api.md`](docs/api.md). Don't put site-specific code in the extension.
- **Keep the tree honest.** A dead file, a dead export, a stale scaffold, a shortcut standing where the real code should be — all of it is trash that compounds. Do sweep for it every session and delete what you find.

## Priority order

Choose in this order. Simple outranks all three.

1. **Function** — it works, proven by driving it.
2. **Feature** — justified by a real case. No case, no feature.
3. **Speed** — short round trips. Measure before claiming a gain.