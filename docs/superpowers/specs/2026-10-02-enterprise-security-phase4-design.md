# Enterprise security Phase 4 design — hardening + hygiene

- Date: 2026-10-02
- Branch: `chore/enterprise-security-phase4` (basis `origin/main` = `ae7ede9`)
- Basis: owner delegates all decisions to controller (2026-10-02:
  "ikut rekomendasi, butuh rapi profesional standar perusahaan").
  Controller rulings below are binding unless the owner overrides.
- Status: spec written by controller under delegated authority; execution
  waits for Fase 3 CI verdict (verification base must be green/stable).

## Intended outcome

Auth, CORS, error surfaces, and repo hygiene meet enterprise review:
no wildcard CORS on state-changing surfaces, tokens never logged,
users see actionable errors (never internals), deploy-time values come
from env, and the tree has no local-state droppings — with zero
behavior breakage for existing clients (notably GPT Actions, which
cannot set custom headers).

## Constraints (from AGENTS.md + prior phases)

- Evidence-first repair loop per behavior change; frozen-boundary digest
  re-freeze with reason on intentional byte moves (established precedent).
- `npm test` + `npm run check` green every commit; SDD execution.
- No MCP contract/protocol/SQL change; no release/promotion action.

## Ruling R1 — token transport: KEEP body.apiKey, harden around it

`body.apiKey` exists because GPT Actions cannot set custom headers
(`gateway/index.ts:4-8`, CHANGELOG, locked by
`tests/etw-watch-engine.test.mjs:123`). Removal would break an
advertised integration with no migration path (platform limitation).
Therefore: header-first order stays, body fallback stays, query tokens
stay confined to read-only surfaces (existing rule). Hardening instead:
audit bridge/runner/mcp/gateway for any logging or error-echo of
`Authorization` / `body.apiKey` (redaction exists in `_shared/` +
reactive-vm; prove by test that secrets never reach logs or error
payloads), and record the accepted platform risk in SECURITY.md.

## Scope

### A. CORS allowlist, env-driven, fail closed

- Replace `"Access-Control-Allow-Origin": "*"` in `opera-agent-gateway`,
  `opera-agent-mcp`, `opera-agent-update` with an allowlist read from
  `CORS_ALLOWED_ORIGINS` (comma-separated), defaulting to exactly:
  `chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick` (this extension)
  and `https://oauth-consent-three.vercel.app` (consent page fetches
  `opera-agent-auth/config`). Non-listed origins get no ACAO header.
- Same rule everywhere including `/health` and `/openapi.json`
  (server-to-server callers like GPT Actions need no CORS).
- `.env.example` gains `CORS_ALLOWED_ORIGINS` with the default value
  documented. Regression tests assert fail-closed default + env override.

### B. Token handling audit (no transport removal)

- Prove by test: bearer tokens and `body.apiKey` never appear in logs,
  error payloads, or persisted records on any of the four functions.
- Document the GPT-Actions platform limitation + accepted risk in
  SECURITY.md (one paragraph, no new policy beyond acknowledgment).

### C. User-actionable error mapping

- Popup (`extension/popup.js` error paths) and consent page stop
  rendering raw `error.message`/Supabase English strings; map internal
  codes to bilingual actionable messages, details to console/log only.
- Regression tests pin the mapping table (known codes → strings) and
  assert no raw internals leak (no `stack`, no token-shaped substrings).

### D. Publishable defaults to env-first

- The two 8D scripts' `$PublishableKey` literals become
  env-first-with-identical-fallback (Task 6 pattern), enabling rotation
  without breakage. Gitleaks allowlist entries stay valid (same lines).

### E. Repo hygiene (bounded, history-safe)

- Verify-only sweep first: untracked droppings, local-state dirs,
  empty dirs, stale references. Fix ONLY safe items (gitignored
  enforcement, doc pointer updates); never delete evidence/history;
  every removal recorded with reason. If the sweep finds nothing safe,
  it closes with that verdict — no churn for its own sake.

## Non-goals

- No auth-model redesign (JWT allowlist stays), no MCP surface change,
  no UI redesign (Options page is Fase 5), no Sonar chase beyond the
  recorded wall, no release/promotion.

## Acceptance

1. No `Access-Control-Allow-Origin: *` on state-changing surfaces;
   fail-closed proven by test (unknown origin → no header).
2. Secret-leak regression tests green (tokens/keys absent from logs,
   errors, persisted records in covered paths).
3. Popup/consent show only mapped messages (leak tests green).
4. `npm test` + `npm run check` green; CircleCI per-gate green on the
   branch head (Fase 3 verdict incorporated).
5. Single active line; merge to `main` stays an explicit owner decision.
