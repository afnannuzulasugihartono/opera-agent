# Milestone 7 Checkpoint 7F — compatibility, performance, and production acceptance

Date: 2026-09-12

Status: **ACCEPTED**

Checkpoint 7F is the production-acceptance closeout for the bounded Reactive Browser VM milestone. It adds no new browser authority, no extension behavior, no public MCP surface, no protocol capability, and no consequential effect. The accepted extension remains `1.6.0`.

## Baseline and scope

7F began from accepted Checkpoint 7E head:

`4240ff69458d9e80fbb2225f97973529d8198fa9`

The frozen compatibility baseline remains:

- extension `1.6.0`;
- protocol `1`;
- extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`;
- `26` public browser capabilities;
- `18` MCP tools with unchanged names and input schemas;
- production device `opera`;
- existing signing identity and pairing;
- background-first focus isolation with no silent foreground fallback;
- immediate signed rollback `1.5.2`;
- signed 1.6.0 CRX SHA-256 `cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0`;
- canonical LF MCP source SHA-256 `f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`;
- locked 7A inventory digest `sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a`.

No new CRX was built or published for 7F.

## Collaboration policy integration

The milestone/checkpoint collaboration policy from commit
`387dbd44f3d2f00c479fc0377520772e0269606e` was applied to the milestone branch.
That commit is a direct child of the then-current 7F validation head, so applying it
was a clean fast-forward equivalent to cherry-picking it and did not discard any
7F evidence.

The durable policy is now:

- one active writer on the milestone branch;
- ChatGPT Web may implement and accept one checkpoint at a time;
- repository/test/CI/production state, not chat text, is the acceptance authority;
- temporary CI and PR state must be cleaned before a checkpoint is closed;
- Codex performs an independent audit after the complete milestone before the next milestone starts;
- high-risk auth, tenancy, encryption, signing, public MCP, extension distribution, irreversible-effect, or production-schema boundaries may trigger an earlier Codex review.

The authoritative collaboration rules are in `AGENTS.md`; the reusable execution prompt is `docs/prompts/chatgpt-web-checkpoint.md`.

## Cross-platform MCP hash-lock repair

A Windows checkout exposed three false contract failures. Git converted the MCP source checkout to CRLF, producing a raw-byte SHA-256 beginning `6235ed…`, while the frozen fixture correctly represents the canonical LF source and locks:

`f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`

The defect was in test byte handling, not in MCP behavior or contract content.

7F fixes this without weakening any lock:

- added `tests/helpers/canonical-source-hash.mjs`;
- canonicalization is explicit at the byte boundary: CRLF and lone CR are normalized to LF before SHA-256;
- updated only the three source-hash call sites in:
  - `tests/ledger-server.test.mjs`;
  - `tests/semantic-release-gate.test.mjs`;
  - `tests/reactive-vm-7f.test.mjs`;
- added a 7F regression assertion that a simulated CRLF checkout canonicalizes to the same frozen LF hash;
- retained the expected contract hash unchanged;
- retained the 7A inventory lock unchanged;
- did not modify `supabase/functions/opera-agent-mcp/index.ts`;
- did not change the 18-tool public MCP contract.

An actual `windows-latest` GitHub Actions job subsequently passed all `171/171` Node tests and `npm run check`, proving the fix on a real Windows checkout rather than only by simulation.

## Focused 7F acceptance suite

`tests/reactive-vm-7f.test.mjs` contains six focused acceptance gates and all pass:

1. extension 1.6.0, protocol/capability/MCP inventory, canonical MCP hash, and the frozen read-only VM effect policy remain unchanged;
2. controlled lazy-list collection is bounded, deduplicated, and never universal;
3. 100 bounded collection replays agree byte-for-byte;
4. bounded browser evidence yields zero false `PROVED` results;
5. effect idempotency identity is deterministic and request-sensitive;
6. durable host metadata rejects raw page content and secret-like values.

The Windows CRLF regression is included in gate 1.

## Normal-profile browser acceptance

Read-only 7F production acceptance used the existing signed normal Opera profile and the Opera Agent relay itself.

### Google Maps

- the Maps automation target remained inactive;
- read-only bounded observation completed without stealing the active foreground tab;
- the observed result feed reported `reachedBoundary:false`;
- completion therefore remained `PARTIAL` rather than claiming every place or universal geographic completeness.

### YouTube

- the target remained inactive;
- `media.state` reported only the state actually observed;
- `page.read` did not expose a transcript field in the tested state;
- 7F did not infer or claim transcript availability from unobserved state.

### GitHub

- the target remained inactive;
- bounded link collection with `limit=10` stopped at exactly 10 entries;
- no claim was made beyond that observed bounded scope.

### Tight focus audit

Immediately before and after a read-only background `browser.burst`, the same ChatGPT tab remained active and the Maps target remained inactive. This isolates command behavior from unrelated user tab changes elsewhere in the session.

## Durable-host dark-run acceptance

A bounded production transaction exercised the accepted 7E durable host and then cleaned itself completely.

Observed acceptance behavior:

- exact checkpoint redelivery remained on logical transition `1` rather than advancing twice;
- effect reservation replay was detected;
- conflicting idempotency material was rejected;
- worker-death recovery reclaimed at a higher lease epoch (`3` in the probe);
- cancellation survived worker death;
- expiry terminalized as `EXPIRED`;
- cross-tenant access returned `RUN_NOT_FOUND`;
- replay/redelivery resolved to one logical command row rather than a duplicate logical effect.

The first expiry harness attempt tried to move only `expires_at` backward and correctly violated the existing `vm_runs_expiry` constraint. PostgreSQL aborted that transaction, so the temporary flag/state also rolled back. The rerun used internally consistent synthetic timestamps and passed without weakening runtime constraints.

Post-probe production state was explicitly verified:

- `milestone7_vm_enabled = false`;
- `opera_agent_private.vm_runs = 0`;
- `opera_agent_private.vm_effects = 0`;
- `opera_agent_private.vm_rate_windows = 0`;
- `opera_commands` rows with `request_id LIKE 'm7-7f-%' = 0`;
- device `opera` is online at extension `1.6.0`, protocol `1`, capability count `26`.

The production security advisor was also re-read. Existing baseline findings remain visible, but 7F introduced no schema/function change and no 7F-introduced security-advisor finding.

## CI and performance evidence

The portability-validation run is GitHub Actions run `34692142866`.

Ubuntu job `103549171072` passed:

- focused 7F: `6/6`;
- full Node suite: `171/171`;
- `npm run check`: `26 allowlisted browser primitives, version 1.6.0`;
- controlled Chromium extension regression;
- background focus audit: `55` commands, focus preserved;
- bounded burst stability: `20/20`;
- paired same-runner deterministic replay agreement: `1 -> 1`;
- paired same-runner focus changes: `0 -> 0`;
- accepted 1.6.0 semantic-read median: `41.37 ms`;
- 7F head semantic-read median: `47.10 ms`;
- ordinary semantic-read regression: `13.851%`, below the frozen `<15%` limit.

Windows job `103549171171` passed:

- full Node suite: `171/171`;
- `npm run check`: `26 allowlisted browser primitives, version 1.6.0`;
- the three formerly failing CRLF source-hash locks all passed with the canonical LF expected hash unchanged.

An earlier accepted 7F exact-head run (`34681531141`, job `103520930361`) independently passed focused 6/6, full 171/171, static validation, Chromium, the 55-command focus audit, burst 20/20, and a paired same-runner regression sample of `12.235%`.

## Isolated-Opera compatibility boundary

7F did not change extension source, the signed 1.6.0 artifact, protocol, capabilities, or pairing identity. A fresh separate isolated-Opera launcher was not available in the repository during this closeout. Therefore 7F does **not** claim a newly executed isolated-Opera run.

Compatibility for that ladder step is inherited from the already accepted 1.6.0 isolated-Opera evidence because the extension bytes/source relevant to that behavior are unchanged. Fresh browser acceptance for 7F consists of controlled Chromium plus the signed normal Opera profile. This distinction is intentional and recorded rather than overstated.

## Proof and completion semantics

7F preserves the Milestone 6/7 separation between execution and proof:

- action/command success is process evidence only;
- VM return is not `PROVED`;
- stable screenshots are not exhaustive proof;
- bounded lazy-list/feed observations may become `BOUNDED_COMPLETE` only inside their declared observed scope;
- truncated, unbounded, or boundary-unobserved collection remains `PARTIAL`;
- the 7F adversarial proof gate produces zero false `PROVED` outcomes.

## Rollback and final state

No extension rollback action is required because 7F did not change the extension. The immediate signed browser rollback remains 1.5.2.

The durable VM remains default-off in production. Server rollback remains:

1. keep `milestone7_vm_enabled=false`;
2. stop new VM claims;
3. let bounded read-only slices terminate;
4. use the pre-VM runner/MCP path, which remained available throughout 7E/7F;
5. purge bounded checkpoint rows by TTL if necessary.

Temporary CI instrumentation must be restored byte-for-byte to the standard workflow before final closure, and temporary PR #23 must be closed without merge. The final branch SHA and final net diff are recorded by the session closeout after that restoration commit, since a Git commit cannot contain its own final SHA.

## Checkpoint result

All substantive 7F exit gates pass. Checkpoint 7F is accepted once the final standard-workflow exact-head CI, temporary-PR closure, and final repository-state reconciliation complete.

After those administrative closeout steps, **Milestone 7 is complete**. Milestone 8 must not begin in this session. Per the collaboration policy, the next action is an **independent Codex audit of the complete Milestone 7** before any Milestone 8 implementation begins.
