@last-edited: 2026-10-06 11:55 UTC+7.
@related: [`README.md`](README.md) - [`docs/HANDOFF.md`](docs/HANDOFF.md)

# Opera Agent agent instructions

MV3 browser extension + Supabase backend. This file binds every task, in every area.
Full freedom: simplify, delete, and rewrite anything — tests included — as long as the Goals below move and every word here stays true.

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.

## Always

These ride with every job. Read them before acting, not once per session.

- Code first, comments second: ship the smallest thing that works, then say why.
- Think, then write: name the assumption and the tradeoff, choose against Priority order.
- Simplify every file including this one; state what is true now; drive before claiming.
- Full freedom, bound by the Goals below: delete, rewrite, and simplify anything that moves them.

## Goals

- **Reach everyone, so ship it to production.** Deployed edge functions, applied migrations, a signed CRX — a green `main` is not it. Do the deploy work that is yours; ask only for release, Vercel and Supabase PATs. See [`docs/HANDOFF.md`](docs/HANDOFF.md).
- **Cover every site, Google first.** Maps, YouTube and Docs hold; the rest teach new functions. Do push past one happy path per site. What the extension may do: [`extension/README.md`](extension/README.md).
- **Be a companion with an AI behind it.** The person talks, the assistant drives, the work lands as a real artefact. Do build it as server-side workflows over the generic primitives in [`docs/api.md`](docs/api.md). Don't put site-specific code in the extension.

## Priority order

Choose in this order. Simple outranks all three.

1. **Function** — it works, proven by driving it.
2. **Feature** — justified by a real case. No case, no feature.
3. **Speed** — short round trips. Measure before claiming a gain.
