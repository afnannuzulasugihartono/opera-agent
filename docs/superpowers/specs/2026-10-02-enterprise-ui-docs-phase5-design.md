# Enterprise UI & docs Phase 5 design

- Date: 2026-10-02
- Branch: `chore/enterprise-ui-docs-phase5` (basis `origin/main` = `eef35e5`)
- Basis: owner-approved sections A–E (2026-10-02); open decisions delegated
  to controller, rulings below are binding unless overridden.
- Status: approved by owner, awaiting spec review before `writing-plans`.

## Intended outcome

A new user can install, pair, operate, and troubleshoot Opera Agent
without reading source; every public surface (extension UI, consent
page, gateway API, deployment endpoints) is documented; deployment
URLs have a single source of truth per deploy unit.

## Constraints (from AGENTS.md + prior phases)

- Evidence-first for behavior changes; frozen-digest re-freeze with
  reason on intentional byte moves; `npm test` + `npm run check` green
  every commit; SDD execution; Deno 2.9.6 verification.
- No MCP contract/protocol/SQL change; no release/promotion; no new
  language switcher (popup `en`, consent `id` — established Fase 4).
- No external docs links (private repo, no public docs URL).

## Ruling R1 — no device rename, no external links

Options page omits device rename (identity belongs to the pairing
flow) and external links (nothing public to link to); inline
troubleshooting instead. Narrower scope, zero identity risk.

## Scope

### A. Options page

- `extension/options.html` + `extension/options.js` (module, imports
  logger + error mapper where useful) + `options_page` registration in
  `extension/manifest.json`.
- Controls: bridge URL override (default = endpoints constant; empty
  resets), log level select (`debug`/`warn`/`error`, persists to
  `chrome.storage.local`, applies to logger threshold live),
  read-only version/protocol display, inline troubleshooting (5–6
  bullets mirroring install/pairing failure modes).
- `background.js` reacts via `chrome.storage.onChanged` (no hot-path
  polling change); bridge URL resolution order: override → default.

### B. Runbook (`docs/runbook.md`)

- Incidents: bridge unreachable, pairing code rejected, update stuck
  on legacy channel, MCP auth failures — each with symptoms,
  diagnosis commands (incl. exact `opera_run` smoke queries), and
  escalation path.
- Proposed SLOs (owner-adjustable, SECURITY-style): pairing success,
  command p95, update propagation window.
- Data retention table (commands, telemetry, pairing hashes, logs).
- Accessibility appendix (current popup semantics: aria-live,
  labelled controls, keyboard operability).

### C. API docs without drift (`docs/api.md` + pin test)

- Narrative: base URLs, auth (header-first, body.apiKey for GPT
  Actions, query confined to read-only), endpoints table, error codes,
  curl examples. Machine source of truth stays live `/openapi.json`.
- New test asserts every endpoint path documented in `docs/api.md`
  exists in the gateway `openApiSpec` source (frozen-contract idiom);
  failures force doc-or-spec alignment, never silent drift.

### D. Single endpoint source per deploy unit

- New `extension/lib/endpoints.js` (frozen constants:
  `DEFAULT_BRIDGE_URL`, derived siblings) imported by `background.js`;
  test pins all extension consumers import from it (no second literal).
- `oauth-consent/index.html` keeps its literal (separate Vercel
  deploy, cannot import) + new test asserts its `configEndpoint`
  prefix equals the endpoints constant (equality lock, existing idiom).
- `supabase/functions/opera-agent-update/index.ts:81` derives base
  from `SUPABASE_URL` (already in scope in that file).
- Documented exceptions (static by platform): `manifest.json`
  `update_url`, applied migrations (never rewritten), `release.yml`,
  historical install URLs.

### E. Extension README permissions rationale

- Expand `extension/README.md` (14 lines) with per-permission
  justification (`debugger`, `tabs`, `scripting`, `storage`,
  `alarms`, `activeTab`, `<all_urls>`, host permissions) for
  enterprise review, plus pointer to runbook/install docs.

## Non-goals

- No MCP/protocol/SQL changes; no UI redesign beyond Options;
  no language switcher; no release/promotion; no Sonar chase.

## Acceptance

1. Options page opens from `chrome://extensions`, persists + applies
   bridge URL and log level, displays version; covered by tests where
   DOM-free logic allows (storage shape, mapper reuse) + manual pass
   checklist in the plan.
2. Runbook lets a fresh operator resolve the four incidents without
   source access (reviewer-read bar).
3. `docs/api.md` endpoint list ⊆ live spec paths (test green).
4. Exactly one endpoint literal per deploy unit (tests green);
   exceptions documented in the spec + code comments.
5. `npm test` + `npm run check` green; per-workflow CI green on the
   branch head before merge consideration (merge stays owner decision).
