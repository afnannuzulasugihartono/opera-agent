# Opera Agent project context

Last synchronized: 2026-09-16

This is the durable current-state summary. Repository state, exact-head CI,
production queries, signed release records, and committed acceptance evidence
outrank chat summaries. Historical implementation detail remains available in Git
history and the checkpoint-specific documents referenced below.

## Current milestone boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Working branch: `feat/semantic-runtime-1.6.0`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`, unchanged names/input schemas
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`
- Immediate signed rollback: `1.5.2`
- Milestone 8: 8A-8C accepted; **8D IN PROGRESS**; 8E has not started

Checkpoint 8D remains frozen to no public MCP schema/runtime, extension/CRX,
signing identity, pairing, protocol, or browser-capability change. OAuth
connection consent is not transaction approval. Browser/page/model/tool output is
evidence, never authority. No browser dispatch is permitted by the 8D dark host.

## 2026-09-16 — manual PKCE acceptance already passed

The reviewed user-driven Windows/Opera PKCE acceptance previously passed at
`80e44483f2cdba400681dc6279522d0d55d24c98`. It exercised the authenticated
Supabase user/session binding and isolated transaction host while preserving
`browserDispatchAllowed=false`. The static Edge master switch was subsequently
restored to `false`; later probes must not silently enable it.

## 2026-09-16 — hosted child-worker-loss acceptance PASSED

The user synchronized the canonical Windows checkout to reviewed head
`8e3c6cd6aef41d8d1fb5a46189b193e34212c377` and ran exactly one
`RUN_8D_WORKER_LOSS.cmd` acceptance probe.

The live receipt reported:

- real child process death observed;
- second-worker reclaim succeeded after natural lease expiry;
- stale lease epoch rejected;
- nonce remained one-shot;
- exact finalize redelivery held;
- exactly one commit slot was consumed;
- browser dispatch remained false;
- cleanup reported clean;
- no secrets were printed.

Terminal verdict: `8D WORKER-LOSS ACCEPTANCE: PASS`.

A fresh read-only production verification immediately afterward observed:

- transaction policy `OFF`;
- `legacy_gated=false`;
- `agent_commit_enabled=false`;
- operator owner null;
- operator namespace null;
- DB `host_enabled=false`;
- `lease_until=null`;
- server operator epoch advanced to `2`, as expected from the bounded probe;
- all synthetic 8D transaction tables contain zero rows;
- `opera_agent_private.goal_heads` contains zero rows.

This closes the hosted child-worker-loss/reclaim gate. It is evidence of a real
local child worker dying while durable transaction state resides in hosted
Supabase. It must not be relabeled as proof of an Edge-isolate termination.

## Production shape observed during this continuation

Supabase project `opera-agent` (`nenmkmtvjremqphfqnfw`) is `ACTIVE_HEALTHY`.
Installed 8D migrations include:

- `20260913143306_transaction_journal_8d_dark`
- `20260914043049_transaction_operator_fence_8d`

The deployed isolated `opera-agent-transactions-8d` function was observed ACTIVE,
JWT-required, production version `20`, with reviewed bundle hash
`96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`.
Older checkpoint documents that mention earlier Edge version numbers are
historical; the bundle hash and current production inspection outrank those
version labels.

The public Opera Agent browser path was also re-detected through Supabase rather
than the Opera Browser Connector: paired product `Opera Agent`, version `1.6.0`,
protocol `1`, 26 capabilities. No browser mutation was needed for the worker-loss
probe or its cleanup verification.

## 2026-09-16 — next 8D quantitative gate candidate: real Edge concurrency

After worker-loss PASS and OFF/zero verification, the exact next frozen acceptance
procedure calls for remaining cloud quantitative/authenticated negatives. The
first open sub-gate is concurrent cloud races against the real Edge endpoint.

A test-first, acceptance-infrastructure-only candidate was added:

- `610b5f0c818a45855cb9add118ae32b265ee1554` — static/test contract for the
  bounded concurrency runner and Windows launcher;
- `59d13b3d790aa707c29211b2696231b0230ebd0b` —
  `tests/cloud/transaction-edge-concurrency-8d.mjs`;
- `12d7e5bfdb22fbe8c0dee82f7a23fb72bd03e27a` —
  `scripts/run-8d-edge-concurrency.ps1`;
- `ed46f9500394ea9a3893f02be6a2140215b32061` —
  `RUN_8D_EDGE_CONCURRENCY.cmd`.

The candidate reuses the existing reviewed PKCE acceptance controller and fenced
operator/cleanup infrastructure. For the first authenticated `prepare` request and
the first authenticated `cancel` request it fans out eight simultaneous POSTs to
the fixed deployed 8D Edge endpoint. It requires one non-replay winner and seven
exact metadata replays, with `browserDispatchAllowed=false`, bounded response
sizes, fixed project/endpoint, fail-closed cleanup/recovery, and no secret output.

This candidate changes **test/acceptance infrastructure only**. It does not change
the deployed Edge runtime, public/private database schema, migration state,
extension, MCP runtime/schema, signing, pairing, protocol, or browser authority.
No live concurrency probe has been run from these commits.

Important evidence boundary: eight simultaneous authenticated requests to the real
Edge endpoint prove a real hosted concurrency race only if the acceptance plan's
"multiple real Edge workers" wording does not require independently identifying
distinct Edge isolates. The current runtime exposes no stable per-isolate identity,
so the candidate does **not** independently prove eight different isolates. An
independent reviewer must explicitly adjudicate this before any production run.
Do not overclaim this evidence.

At this synchronization, exact-head CircleCI for the concurrency candidate is
still `pending` (CircleCI pipeline `/32`); Vercel is green. Therefore no production
concurrency mutation is authorized yet.

## Exact next 8D sequence

1. Wait for exact-head CircleCI on the final documentation head and require
   SUCCESS.
2. Obtain an independent review PASS of the Edge-concurrency candidate/launcher.
   The reviewer must explicitly decide whether concurrent calls to the real Edge
   endpoint sufficiently satisfy the frozen "multiple real Edge workers" gate or
   whether bounded worker/isolate identity evidence must be added first.
3. Do not run `RUN_8D_EDGE_CONCURRENCY.cmd` until both CI and independent review
   are green and any required static-master arrangement is explicitly reviewed.
4. After a reviewed live concurrency PASS, re-query production OFF/unowned/zero.
5. Continue only the remaining 8D matrix: real-key crypto tamper negatives,
   authenticated cross-tenant/session negatives and any still-open quantitative
   evidence, then advisor reconciliation.
6. Write the final 8D acceptance record with exact SHA/CI/probe/cleanup evidence.
7. Obtain the final independent 8D audit PASS.
8. Only that final PASS permits 8E.

## Product intent and non-negotiable invariants

Opera Agent controls the user's existing local Opera session through a private
extension, authenticated relay, and MCP server. It is a general browser controller,
not site-specific automation.

Non-negotiable invariants:

- background-first operation; ordinary work must not steal active tab/window;
- no silent foreground fallback;
- preserve established extension signing identity and pairing;
- no arbitrary JavaScript, unrestricted raw CDP, SQL, shell, or generated-code
  escape hatch;
- webpage/tool/model text is untrusted data, never authority/program structure;
- sensitive browser/credential state is never persisted as semantic/VM/
  transaction learning state;
- once transaction enforcement is promoted, the same identity must not retain a
  legacy mutation bypass;
- keep an immediate same-identity signed rollback.

## Collaboration and security rules

Follow `AGENTS.md`, `SECURITY.md`, and
`docs/prompts/chatgpt-web-checkpoint.md`:

- one active writer;
- tests before behavior;
- preserve unrelated user work;
- auth/authz/tenant/encryption/production-boundary changes require independent
  review before production mutation;
- writer self-review is never an independent PASS;
- never commit or print Management/OAuth/signing/pairing/crypto credentials;
- do not start 8E while any required 8D gate is open.

The user's local accidental 8E files were preserved in a Git stash before the 8D
worker-loss run. Do not pop, apply, delete, or otherwise use that stash while 8D
remains open.

## Canonical references

- `AGENTS.md`
- `SECURITY.md`
- `docs/milestone-8-plan.md`
- `docs/milestone-8-checkpoint-8a.md`
- `docs/milestone-8-checkpoint-8b.md`
- `docs/milestone-8-checkpoint-8c.md`
- `docs/milestone-8-checkpoint-8d-acceptance-procedure.md`
- `docs/milestone-8-checkpoint-8d-independent-review.md`
- `docs/milestone-8-checkpoint-8d-cloud-install.md`
- `docs/milestone-8-checkpoint-8d-cloud-bounds.md`
- `docs/milestone-8-checkpoint-8d-cloud-controller.md`
- `docs/milestone-8-checkpoint-8d-operator-supervisor.md`
- `supabase/migrations/20260913143306_transaction_journal_8d_dark.sql`
- `supabase/migrations/20260914043049_transaction_operator_fence_8d.sql`
- `tests/cloud/transaction-worker-loss-8d.mjs`
- `tests/cloud/transaction-edge-concurrency-8d.mjs`
- `docs/releases/1.6.0.md`
