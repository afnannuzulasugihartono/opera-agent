@last-edited: 2026-10-07 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [handoff.md](handoff.md) - [api.md](api.md)

# Security

Opera Agent can interact with a local browser and therefore uses a strict allowlisted command model.

## Security principles

- No arbitrary `eval` or remote code execution.
- Browser actions must use known, validated primitives.
- A registered state reader (`extension/state-bridge.js` plus its pure
  decision module) is pinned, reviewed, bundled code — not remote code. It
  may run in the page's MAIN world to read whitelisted game fields and drive
  frame-rate input, because content scripts cannot see page JavaScript. The
  allowlist of readers lives in that one file; a new reader is a reviewed
  addition, never a parameter.
- Passwords, PINs, OTP/2FA codes, CVV/CVC, and security-code fields remain blocked.
- File uploads remain blocked unless explicitly designed and reviewed later.
- Private extension signing keys must never be committed to the repository.
- Production secrets belong in secure secret storage, not source code.
- Commands should be auditable and bounded by timeouts and payload limits.

## Supported versions

Only the latest patch of the current minor line receives security fixes: 1.6.x is supported,
anything below it is not. The version in [`extension/manifest.json`](../extension/manifest.json) is
the source of truth.

## Reporting a vulnerability

- Do not open a public issue.
- Report privately via the repository Security tab (Report a vulnerability) or direct
  contact with the maintainer.
- Include: affected version, reproduction steps, and impact.
- Acknowledgement within 5 business days, and a critical fix or mitigation within 30 days. Both
  targets are proposed, and the owner may adjust them during review.

## Token transport

The gateway accepts device tokens via header (`x-opera-agent-token`,
`Authorization: Bearer`) or `body.apiKey`, because GPT Actions cannot set
custom headers. No gateway route reads the query string, so `?apiKey=` is not a
token carrier anywhere. Tokens are verified then
dropped: regression tests pin that they never appear in logs, error payloads,
or persisted records, and pin the carrier set inside `extractToken`. Enforced by
[`tests/api-docs.test.mjs`](../tests/api-docs.test.mjs). A carrier
reached through a helper function, or read by a route handler outside
`extractToken`, stays covered by review rather than by that test. When
device-token verification fails, the gateway verifies the value as a
Supabase user JWT (`supabase.auth.getUser`) and resolves the caller's own
first non-disabled device by `user_id` — the ChatGPT plugin OAuth path —
so one account cannot drive another account's browser.

## Operator rules

For whoever holds the pager. Assumes no chat history.

- Every claim here was checked against the repository when written. If a step contradicts
  what you observe, **trust what you observe** and treat this document as the bug.
- SQL blocks run in the Supabase SQL editor, not PostgREST — the four operator-facing RPCs are
  revoked from `public`/`anon`/`authenticated`, so a PostgREST call fails on permissions.
- A row in `public.opera_devices` with `status = 'disabled'` was set by a human with direct
  database access: **nothing in this repository writes `disabled`**. Re-enabling one is
  owner-only and takes direct SQL. If you find yourself wanting a second way to do this, that is
  the signal to write the writer first, not to reach for SQL.
- Publishing the site: `.github/workflows/deploy-site.yml`, dispatched by hand, running
  `wrangler pages deploy landing --project-name=opera-agent --branch=main`. A green push
  publishes nothing; the CRX publishes through `.github/workflows/publish-crx.yml`.

## Model calls

One model call per task, made by the device itself to the owner's configured
endpoint. What leaves: the goal text plus the capped page observation
(`buildPlanRequest`: goal under 1200 characters, page text under 1200
characters, at most 40 elements). What never leaves the device: the model key,
which travels only in the `Authorization` header to that endpoint and never to
our server, queue, database, or logs; page content beyond the capped
observation; anything from another tab. An unconfigured device refuses with
`MODEL_NOT_CONFIGURED` before any network call. Live proof with a real key
awaits the owner and is outside this change. External model config stays
localhost-only (`externally_connectable` plus origin check): the owner sets the
key by hand in the options page, and no website can push config into the
extension.