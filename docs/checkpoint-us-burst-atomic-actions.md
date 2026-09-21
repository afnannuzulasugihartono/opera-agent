# Checkpoint U-S — Burst Atomic Actions (2026-09-21)

## Motivation (live evidence)

Acceptance rerun of T041 on the signed 1.6.4 candidate (extension installed
07:21 UTC, verified `opera_devices.extension_version=1.6.4` online) reproduced
the YouTube skip failure with a decisive audit trail:

- `page.find "Skip"` at 15:29:36.329Z **succeeded perfectly** — the real ad
  control was selected (`actionable:true`, `fullyInViewport:true`), not
  `Skip navigation`. Target selection is fixed (U-I/R8 work).
- The follow-up `page.click(ref)` at 15:29:50.434Z failed with
  `Element not found or reference is stale` — **14.1 s** after the find.
- A re-find after the failure saw only `Skip navigation` (`actionable:false`):
  the ad lifecycle had destroyed and re-rendered the control. There was no
  successor for rebind (I4) to find — the node was gone entirely.
- Same failure class on a freshly found `Play (k)` button: this is a general
  observation→action gap, not a Skip-specific bug.
- Inserting a row into `opera_workflow_runs` does not run anything; only the
  `opera_start_workflow` RPC (which fires the runner via pg_net) executes a
  workflow, and no MCP path reached it.

Root cause: the LLM round trip between observation and action. Transport poll
latency (~250 ms cadence) is irrelevant at 14 s.

## Research grounding (journals / industry, 2025-2026)

- **Agent JIT Compilation** (ICML 2026, arXiv 2605.21470): the serial
  screenshot-LLM-execute loop is the latency bottleneck (73% of Browser-Use
  latency is inter-step LLM inference); compiling deterministic step groups
  into one executable plan yields 10.4× speedup with +28pp accuracy.
  Their tool protocol rejects illegal sequences at composition time — our
  `refFromStep` forward-reference validation mirrors this.
- **Efficient GUI Agents: A Systems Survey** (arXiv 2609.02309, Sep 2026):
  action-efficiency axis — verification-aware control (SenseAct cuts VLM
  consults ~65% by fusing post-condition checks), action abstraction
  (ActionEngine: repeated patterns compiled → 10.2 → 1.8 model calls), and
  OSWorld-Human: planning+reflection dominates 76–96% of end-to-end latency.
- **Playwright locator model** (industry standard): re-query the live DOM at
  action time instead of holding frozen handles — the workflow retry loop
  re-queries the skip control every iteration.

Conclusion shared by all sources: never leave the LLM inside a deterministic
action loop; batch find→click→verify into one local execution and make
repeated intents versioned, server-side workflows.

## Implementation (no new primitive; frozen 26-method contract intact)

### P1 — Burst ref passthrough (extension + MCP)
- `extension/lib/protocol.js`: burst `click`/`fill` steps accept
  `refFromStep` (0-based earlier step index) + `refIndex`;
  `validateBurst` rejects forward/self references (`refFromStep must
  reference an earlier burst step`) and bad `refIndex`.
- `extension/background.js`: `burstPassthroughRef` resolves the ref from the
  referenced step's `result.items` in memory; the step result is annotated
  `resolvedFrom: "step:N"` for auditability.
- `supabase/functions/opera-agent-mcp/index.ts`: `run_browser_burst` schema
  accepts the same keys; instructions now teach the atomic pattern:
  find + click + wait inside ONE burst for dynamic UIs (players, ad overlays).

### P2 — Workflows as the normal path
- Migration `20260921163000_opera_agent_youtube_skip_ads_workflow.sql`:
  registers `youtube.skip_ads` — bounded `repeat` loop (≤40 × 250 ms) that
  re-queries `.ytp-ad-skip-button-modern, …` fresh each iteration, clicks the
  fresh ref, and polls the `.ad-showing` post-condition before returning.
  Follows the R6 pattern; historical workflow migrations untouched.
- New MCP tool `run_workflow(name, input, timeoutMs)`: calls the audited
  `opera_start_workflow` RPC (which snapshots the definition, inserts the run,
  and fires the runner itself via pg_net) then polls `opera_get_workflow_run`
  and returns status/result/timing. This closes the "row insert does not
  execute anything" integration gap.
- MCP tool inventory: 18 → **19** (byte-for-byte rebaselined with recorded
  reason: fixtures `mcp-contract-v1`, `reactive-vm-contract-v1`,
  `transaction-contract-v1`, `goal-ledger-contract-v1`, plus thresholds and
  the R4/R5 inventory tests).
- `lib/transaction-prepare.js`: `run_workflow` classified OBSERVATION
  (server-side execution is bounded by the workflow itself), preserving
  fail-closed default for unknown tools.

## Verification

- Node suite: **463/464** — the single failure is the pre-existing local-only
  governance artifact (ignored local folders), unchanged and recorded in the
  handoff.
- `npm run check`: PASS — 26 primitives, 69 runtime safety files, 1.6.5.
- Controlled browser regression (Edge headless): **exit 0**, including the new
  U-S benchmarks:
  - `us.burst.find-click-wait`: find→click→wait in ONE burst — total command
    latency **161.6 ms** vs the 14,100 ms live round-trip (~87× faster), with
    `resolvedFrom:"step:0"` evidence and the `#docs-result` post-condition met.
  - `us.burst.forward-ref.rejected`: forward `refFromStep` fails closed at
    validation.
  - `us.page.click.separate-roundtrip`: the split find→click shape still works
    through rebind when no re-render intervenes (control group).
- Hash-lock rebaseline with recorded reason (U-S P1/P2): boundary tests
  P2/P3/P4/P5 now pin content.js, background.js, manifest.json,
  opera-agent-mcp/index.ts at the U-S blobs.

## Release state

- Version sweep 1.6.4 → **1.6.5** across manifest, protocol, popup, package,
  `check.mjs`, and all version-contract tests.
- Branch: `feat/pre-8e-usability-repair-r8`, commit pushed, CircleCI gate
  awaited at push time (see handoff for the final status).
- CRX 1.6.5 signed from the release commit with the established identity key,
  uploaded **inactive** to `opera_releases`; production `update.xml` still
  serves 1.6.2 until live acceptance and activation.

## Next (owner actions)

1. Side-load `opera-agent-1.6.5.crx` in Opera (identity and pairing preserved).
2. Live T041 rerun: YouTube pre-roll → "skip the ad". Preferred model path is
   now either one `run_browser_burst` (find→click via `refFromStep`→wait) or
   the `youtube.skip_ads` workflow via `run_workflow`.
3. On pass: activate 1.6.5 in `opera_releases` and verify `update.xml`.
