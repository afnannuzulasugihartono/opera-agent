# Opera Agent project context

Last synchronized: 2026-09-17

Repository/CI/production evidence outranks chat summaries. Follow `AGENTS.md`,
`SECURITY.md`, accepted checkpoint records, and the selected execution plan.

## Current boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/performance-runtime-cutover-p6`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`
- Signed rollback: `1.5.2`
- Milestone 8: 8A–8D **ACCEPTED**; 8E paused/not started
- Durable 8D closeout: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`
- Active work: **Performance Track P — Runtime Cutover P6**
- P0 accepted: `699578904e2f19ea713a0933632331cad7299c11`, CircleCI #76 + Vercel
- P1 accepted: `cbf3259a337d92410a5ba805dd0fd987a51c1bc5`, CircleCI #85 + Vercel
- P2 accepted: `8621e2dc454f8e8f1e977c350522e6fb2b5dc51d`, CircleCI #91 + Vercel
- P3 accepted: `d5310508aeb5c156657bd4d4abd06a4d172daaba`, CircleCI #94 + Vercel
- P4 accepted: `e550bc90f49df2541dfd91789d99b2b33e4bf2aa`, CircleCI #98 + Vercel
- P5 accepted: historical real-Opera performance acceptance record preserved
- P6 completed: **Authoritative Live Runtime Cutover (Maximal Safe Subset)**
- 8E remains paused/not started

Canonical plan: `docs/delta-first-performance-plan.md`.

Acceptance records:
- `docs/delta-first-performance-p0.md`
- `docs/delta-first-performance-p1.md`
- `docs/delta-first-performance-p2.md`
- `docs/delta-first-performance-p3.md`
- `docs/delta-first-performance-p4.md`
- `docs/delta-first-performance-p5.md`

## P6 Authoritative Runtime Cutover (Maximal Safe Subset)

P6 connects Performance Track P mechanisms (P1–P4) directly into the active live VM runtime loop:

1. **Live Consuming Path**:
   - `supabase/functions/opera-agent-vm/index.ts` (the durable DB-backed 7E VM host) and `lib/reactive-vm-host-7e.js` import and execute `reconcileVmEffectObservation7E` directly during `executeEffect` after receiving observation results from `opera_await`.
2. **Cold-Start & Session Continuity**:
   - On Edge function cold start or worker restart, missing in-memory session continuity in P1/P2/P3 fails closed to `RESET_REQUIRED` and demands a `FULL_SNAPSHOT`. Stale continuation is never permitted.
3. **Server-Authoritative Dependency Context**:
   - Caller-asserted `taskDependencies` are rejected as unauthoritative in live VM host reconciliation (`contextStatus: 'MISSING'`). Observation updates default conservatively to `REASON_REQUIRED`. Dependencies are never fabricated. This represents the maximal safe P6 subset without introducing an unsafe public/stateful protocol.
4. **Preservation of Low-Level Primitives & Text**:
   - Low-level browser primitives (`read_page`, `page.read`, `find_elements`, `click_element`, `fill_element`, `scroll_page`, `browser.burst`, `browser.ping`), Protocol 1, 26 browser capabilities, and `opera_enqueue`/`opera_await` low-level transport remain fully preserved. Full document page text (`page.text`) and elements are retained for VM AST expression evaluation and snapshot recovery.
5. **MCP Version Metadata**:
   - MCP server metadata in `supabase/functions/opera-agent-mcp/index.ts` updated to `1.6.0`.
6. **Durable 7E Host & Security**:
   - Durable DB-backed 7E host tokens (`sealVmHostToken`, `openVmHostToken`), RPCs (`opera_vm_claim`, `opera_vm_checkpoint`), and table schemas are preserved intact. No production deployments, database migrations, OAuth changes, or 8E work were initiated.

## Permanent invariants

- one active writer;
- tests before runtime behavior;
- repository/CI/production evidence outranks chat;
- background-first browser operation;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- preserve signing identity/pairing and immediate signed rollback;
- never commit or print credentials or sensitive page values;
- action success is not completion proof;
- performance gains never justify stale-state action, false completion, missed relevant changes, or foreground takeover.
