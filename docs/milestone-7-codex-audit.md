# Independent Codex audit — Milestone 7

Date: 2026-09-12

Verdict: **PASS**

Audited final milestone head:

`551e8283c0417b173e106ee0598cca848f2f4ff0`

Accepted Checkpoint 7E baseline:

`4240ff69458d9e80fbb2225f97973529d8198fa9`

The complete Checkpoint 7A–7F chain was independently reconciled against the
repository, automated tests, GitHub CI/PR state, the production Supabase dark
state, and the frozen compatibility and authority boundaries. No blocking
correctness, security, compatibility, or acceptance defect was found.

## Independently reproduced evidence

- local `npm test`: **171/171 pass**;
- local `npm run check`: **pass**, extension `1.6.0`, protocol `1`, and `26`
  allowlisted browser capabilities;
- focused `tests/reactive-vm-7f.test.mjs`: **6/6 pass**;
- controlled browser extension harness through `py -3
  tests/browser_extension_test.py`: **exit 0**;
- `opera-agent-vm` Edge Function bundle through esbuild `0.25.9`: **pass**;
- `git diff --check` across Milestone 7: **pass**;
- repository worktree clean before this audit record was written;
- local and remote milestone heads matched at the audited SHA;
- final standard GitHub Actions run `34692726487`: **success** at the exact
  audited SHA;
- temporary PR `#23`: **closed without merge**;
- standard workflow blob restored to
  `074da3349f71f80bb8174d28ab5aa6ec3797fda9`.

## Contract and authority findings

- No Milestone 7 diff exists in the extension, public MCP Edge Function,
  package contract, or standard CI workflow relative to the frozen planning
  baseline.
- The public surface remains `18` MCP tools; no VM tool was exposed publicly.
- VM commands remain a closed read-only set. Restricted `browser.burst` accepts
  only `read`, `find`, and `wait` steps. Navigation, activation, click, fill,
  pointer, scroll, media mutation, and consequential effects remain rejected.
- There is no arbitrary JavaScript, dynamic-code, raw-CDP, SQL, or shell escape
  surface in the VM contract.
- Browser observations remain provenance-bound; VM execution and command
  receipts cannot manufacture `PROVED` or universal completeness.
- Tenant, program, goal, target, tab, document, lease, and logical-transition
  fences remain present. Durable effects retain deterministic idempotency.
- Private VM tables and VM RPCs remain service-role-only with RLS enabled and
  explicit function search paths.
- The Windows hash repair canonicalizes CRLF and lone CR bytes to LF before
  SHA-256 while retaining the frozen expected source hash and inventory lock.

## Production reconciliation

Read-only production checks independently confirmed:

- `milestone7_vm_enabled=false`;
- `vm_runs=0`;
- `vm_effects=0`;
- `vm_rate_windows=0`;
- temporary `m7-7f-*` command rows `=0`;
- device `opera` online on extension `1.6.0`, protocol `1`, with `26`
  capabilities;
- deployed `opera-agent-vm` remains JWT-protected and dark;
- no Milestone 7-specific unresolved security-advisor ERROR/WARN was found.

## Scope distinction and residual notes

- This audit confirms code presence, automated acceptance, exact-head CI,
  production dark state, and the recorded live normal-profile acceptance. It
  does not claim production promotion: the VM flag intentionally remains off.
- A fresh isolated-Opera run was not repeated because Milestone 7 does not alter
  the extension bytes or browser contract. That limitation is explicitly
  recorded in Checkpoint 7F; fresh browser coverage consists of controlled
  Chromium and the signed normal Opera profile.
- `docs/milestone-7-plan.md` remains a frozen pre-implementation planning
  artifact, so its historical status labels are not the current project state.
  Current status is governed by the acceptance records, project context, this
  audit, and verified repository/CI/production evidence.

## Gate result

Milestone 7 satisfies the independent audit gate. Milestone 8 is now permitted
to enter planning, but it remains **not started**. This PASS grants no new
browser authority and does not enable the production VM flag.
