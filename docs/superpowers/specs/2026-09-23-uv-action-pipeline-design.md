# U-V Action Pipeline: Resolve → Wait → Heal → Verify (Design)

Date: 2026-09-23
Status: Approved design (brainstorming, 2026-09-23) — awaiting owner spec review
Author session: Buffy (Freebuff), with owner
Predecessors: U-S burst atomic actions (1.6.6), U-T event-triggered workflows (1.6.6 candidate), gateway 1-hop fastpath

## 1. Problem

Live evidence from T041 (2026-09-21) and the ETW acceptance work: the action
layer is fast when the page is stable, but on dynamic pages (YouTube ad
overlays, SPA re-renders) an AI platform still sees:

- `Element not found or reference is stale.` on an action against a ref that
  was valid milliseconds earlier (model round-trip exceeds DOM lifetime)
- Dead-end errors that force the model to re-find, re-decide, and re-act —
  extra round-trips, extra latency, wrong-by-construction UX for AI
- No final outcome: a model cannot tell "action landed" from "action sent,
  effect unconfirmed"

U-S made find→click one transaction. U-T removed model trips entirely for
watched conditions. The remaining latency lives at the single-action layer:
the server returns an error instead of a waited-for, healed, verified result.

## 2. Goal and Success Criteria

Make every action **instant-by-default**: the action engine itself resolves,
waits, heals, and verifies, so an AI platform never receives `stale` and never
needs a blind retry.

Success criteria:

1. A target that appears up to the method deadline later is acted upon in
   **one command** (zero model retries).
2. A ref invalidated by DOM replacement is **rebound via the proven U-I
   intrinsic-signature machinery** and acted upon (healed), never returned as
   `stale`.
3. Every action result carries final-outcome telemetry:
   `resolved: { attempts, waitedMs, healed, verified }`.
4. Un-actionable or ambiguous targets produce a **self-explanatory error**
   (`TARGET_NOT_READY` with reason, waitedMs, and actionable hint/candidates),
   not a dead end.
5. All action paths (MCP page.*, burst steps, gateway /command, workflow
   steps, ETW local actions) share the guarantee through **one funnel**.
6. The frozen 26-primitive protocol surface is unchanged; behavior is
   extended, not re-plumbed.

## 3. Non-Goals

- No new MCP tool, no new protocol primitive, no surface change.
- No server-side orchestration of waits (gateway/MCP stay thin).
- No changes to read methods (`page.find`, `page.read`, `page.query`).
- No activation of 1.6.7 in this effort — build, sign, upload inactive;
  activation remains an explicit owner decision after live acceptance.

## 4. Architecture

### 4.1 Pure engine: `extension/lib/action-pipeline.js`

A pure, DOM-free, deterministic policy engine (pattern of `lib/watch.js`):

- `plan(deadlineMs, now)` → poll schedule: adaptive ramp 25→400 ms
  (25, 50, 100, 200, 400, 400…) clipped to the deadline.
- `classify(state)` → `ready | not-ready(reason) | ambiguous(candidates) | stale`
- `envelope(result, resolution)` → success envelope with
  `resolved: { attempts, waitedMs, healed, verified }`.
- `notReadyError(state, waitedMs)` → structured `TARGET_NOT_READY` object:
  `{ code: 'TARGET_NOT_READY', reason: 'not-found' | 'not-actionable' |
  'ambiguous', waitedMs, hint, candidates? }`.

The engine contains **no chrome.*, no DOM** — all effects are decided here
and executed by the host.

### 4.2 Host wiring: `extension/background.js`

A thin async host wraps the engine around existing executors:

```
1. RESOLVE  content 'page.action_state' {ref} → present/actionable/geometry
2. WAIT     not-ready? → poll per plan(deadline from METHOD_SPECS) with
            re-resolve each cycle; stop early on ready
3. HEAL     stale (ref gone) → U-I intrinsic-signature rebind (existing,
            proven machinery in content.js, geometry guard intact; ambiguous
            stays refused and is classified 'ambiguous')
4. EXECUTE  existing trusted executors (trustedClick/trustedFill/…)
5. VERIFY   post-action verification per action type; verified:true/false
            reported, never invented
```

- Deadline: `METHOD_SPECS[method].timeoutMs` — no new constants
  (page.click/pointer/fill 8000 ms, page.key 5000 ms).
- The pipeline wraps **all** action routes because they already funnel through
  the shared executors: MCP page.*, burst action steps, gateway /command,
  workflow steps, ETW watcher local actions.
- Watch/ETW and burst internal callers pass explicit deadlines where their
  own spec differs; default remains METHOD_SPECS.

### 4.3 Content-side support: `extension/content.js`

- Extend the existing resolve path with a compact `page.action_state` handler
  (present / actionable / ambiguity candidates), reusing the U-I machinery —
  no duplicate actionability logic.

## 5. Result Semantics (backward compatible)

- **Success**: existing envelope, plus `resolved` telemetry (superset; no
  existing field changes meaning).
- **Target never becomes ready by deadline** → `TARGET_NOT_READY`
  `{ code, reason: 'not-found'|'not-actionable'|'ambiguous', waitedMs, hint,
  candidates? }`. Ambiguity keeps its hard-refusal semantics (geometry guard
  unchanged) but reports `candidates` the model can act on deliberately.
- **Verify fails** → `ok: true, resolved.verified: false` with detail: the
  action was delivered; the model decides the next step from data instead of
  assuming failure.

## 6. Scope

- Action methods: `page.click`, `page.fill`, `page.key`, `page.pointer`.
- Burst action steps, workflow steps, ETW local actions — via the same funnel.
- Read methods unchanged.
- Release: CRX **1.6.7** (build, sign, offline verify, upload inactive).
  Activation = separate explicit owner decision after live acceptance.
- Governance: content.js/background.js edits trigger content hash-locks and
  the MCP digest inventory — rebaseline via the established U-S/U-T script
  pattern; frozen 26-primitive protocol untouched (internal family pattern,
  as with watch.*).

## 7. Testing (TDD)

1. **Node pure-engine tests** (`tests/action-pipeline.test.mjs`): ramp shape
   and deadline clipping; classify states incl. ambiguous-with-candidates;
   envelope shape; TARGET_NOT_READY shape; heal-cycle accounting (attempts,
   healed flag). Red → implement → green.
2. **Source-contract tests**: every action route demonstrably funnels through
   the pipeline (grep-contract style, repo convention); METHOD_SPECS is the
   only deadline source; protocol METHOD_SPECS set unchanged (26 primitives).
3. **Browser regression (Edge headless)**, fixture page with delayed/replaced
   targets: (a) button appears at +1.5 s → single command succeeds with
   `waitedMs ≥ 1500`, zero retries; (b) ref invalidated by DOM replacement →
   `healed: true` and the action lands on the successor; (c) verify path →
   `verified` reflects reality.
4. Full node suite green (except the known pre-existing #250 root-governance
   failure from untracked local artifacts), CI green, then release engineering
   (hash-lock rebaseline, version sweep, CRX build/sign/verify/upload inactive).

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Waiting masks real bugs (silent 8 s stalls) | `waitedMs` always reported; `reason:'not-found'` distinct from `'not-actionable'`; deadline caps worst case |
| Rebind acts on wrong element | Geometry guard + ambiguity refusal **unchanged** from U-I; ambiguity returns candidates instead of guessing |
| Protocol/lock drift | No METHOD_SPECS surface change; hash-lock rebaseline only, per convention |
| Deadline mismatch for internal callers | Explicit deadline parameter with METHOD_SPECS default |
| Verify invents success | `verified` only set from an actual post-action check; no check ⇒ verified omitted, not true |

## 9. Open Items for Planning

- Exact `page.action_state` response shape (content handler contract)
- Verify implementation per action type (click: element gone/hidden? fill:
  value assertion? key: focus/dispatch ack?)
- Burst step plumbing point (wrap step executor vs wrap whole burst)
- 1.6.7 release engineering order (rebaseline → version sweep → sign → upload)
