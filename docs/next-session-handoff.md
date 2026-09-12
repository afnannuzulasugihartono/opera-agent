# Opera Agent next-session handoff

Use this as the starting point after Milestone 7 closeout. Verify repository, production flag state, CI, and PR state before making claims.

## Handoff prompt

```text
Continue the private Opera Agent project from repository:
https://github.com/afnannuzulasugihartono/opera-agent

Working branch:
feat/semantic-runtime-1.6.0

Read first, in order:
1. AGENTS.md
2. docs/project-context.md
3. docs/next-session-handoff.md
4. docs/milestone-7-plan.md
5. docs/milestone-7-checkpoint-7a.md
6. docs/milestone-7-checkpoint-7b.md
7. docs/milestone-7-checkpoint-7c.md
8. docs/milestone-7-checkpoint-7d.md
9. docs/milestone-7-checkpoint-7e.md
10. docs/milestone-7-checkpoint-7f.md
11. docs/semantic-runtime-plan.md
12. docs/milestone-6-plan.md
13. SECURITY.md

Verified compatibility baseline:
- extension 1.6.0
- protocol 1
- extension ID ohbbpamcljckmjhcpkcmefdobkoeaick
- 26 browser capabilities
- 18 MCP tools with unchanged names/input schemas
- production device name opera
- established signing identity and pairing preserved
- background-first focus isolation preserved
- no silent foreground fallback
- immediate signed rollback remains 1.5.2
- signed 1.6.0 CRX SHA-256:
  cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0
- canonical-LF MCP source SHA-256:
  f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11
- locked 7A inventory digest:
  sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a

Milestones 1–7 are complete. Milestone 8 has NOT started.

Milestone 7 accepted chain:
- 7A froze OA_REACTIVE_VM_V1, OA_REACTIVE_VM_CHECKPOINT_V1,
  OA_CANONICAL_JSON_V1, the closed grammar, read-only-first effects,
  persistence boundary, hostile corpus, and quantitative budgets.
- 7B added lib/reactive-vm.js as the pure deterministic core.
- 7C left 7B untouched and added lib/reactive-vm-7c.js for bounded LOOP,
  UNTIL, WAIT_EVENT, and safe read-only RETRY.
- 7D left 7B/7C untouched and added lib/reactive-vm-7d.js for COLLECT,
  DEDUP, bounded observation envelopes, causal invalidation, and
  non-exhaustive proof binding.
- 7E left the pure VM layers intact and added the separate durable host:
  service-role-only private VM storage, bounded AES-256-GCM tokens,
  tenant/program/goal/target/tab/document/lease fencing, deterministic
  vm1:<sha256> effect idempotency, cancellation/expiry/reclaim, and the
  default-off milestone7_vm_enabled feature flag.
- 7F completed compatibility, performance, Windows portability, normal-profile,
  dark-production, proof-safety, and cleanup acceptance without changing the
  extension or public MCP surface.

Accepted VM effects remain only the frozen 7A read-only set:
- browser.ping
- restricted read/find/wait subset of atomic browser.burst
- tabs.list / tabs.get / tabs.find
- page.read / page.query / page.find / page.collect_links / page.capture /
  page.wait_for
- media.state

No navigation, tab mutation, click/fill/key, pointer, scroll, media mutation,
consequential effect, direct logical-ID action, arbitrary JavaScript/raw CDP,
or public VM MCP tool was accepted.

7F acceptance evidence:
- tests/reactive-vm-7f.test.mjs: 6/6 focused gates
- full Node suite: 171/171 on Ubuntu
- full Node suite: 171/171 on actual windows-latest
- npm run check: 26 allowlisted primitives / version 1.6.0 on both platforms
- controlled Chromium regression passed
- background focus audit: 55 commands, zero focus takeover
- bounded burst stability: 20/20
- 100 deterministic collection replays agree byte-for-byte
- zero false PROVED in bounded-evidence acceptance
- paired same-runner semantic-read regression 13.851% (<15%)
- Maps target remained inactive; unobserved feed boundary stayed PARTIAL
- YouTube target remained inactive; no unobserved transcript inference
- GitHub target remained inactive; link collection stopped at limit 10
- Supabase dark-run passed checkpoint replay/idempotency collision/worker death/
  cancellation/expiry/cross-tenant behavior and cleaned all synthetic state
- final production checks: milestone7_vm_enabled=false; vm_runs=0;
  vm_effects=0; vm_rate_windows=0; m7-7f command rows=0
- device opera online on 1.6.0 / protocol 1 / 26 capabilities
- no 7F-introduced security-advisor finding

Windows portability fix:
- the old CRLF checkout produced a raw hash beginning 6235ed..., while the
  frozen canonical LF MCP hash is f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11
- tests/helpers/canonical-source-hash.mjs explicitly canonicalizes CRLF/lone CR
  bytes to LF before SHA-256
- exactly three source-hash call sites were updated
- the expected hash and 7A inventory digest were NOT changed
- supabase/functions/opera-agent-mcp/index.ts was NOT changed
- actual Windows CI now passes 171/171 plus npm run check

7F browser compatibility note:
A fresh separate isolated-Opera launcher was not available during 7F closeout.
Do not invent a fresh isolated-Opera run. That rung is inherited from accepted
unchanged 1.6.0 extension behavior; fresh 7F browser evidence is controlled
Chromium plus the signed normal Opera profile.

Collaboration policy:
- follow AGENTS.md and docs/prompts/chatgpt-web-checkpoint.md
- one active writer on the milestone branch
- ChatGPT Web implements/accepts one checkpoint at a time
- chat text is not acceptance authority until reconciled with repo/CI/production
- Codex independently audits a complete milestone before the next milestone starts
- high-risk auth/tenant/encryption/signing/public-MCP/extension-distribution/
  irreversible-effect/production-schema work triggers earlier Codex review

INDEPENDENT CODEX AUDIT: PASS on final Milestone 7 head
551e8283c0417b173e106ee0598cca848f2f4ff0. Read
docs/milestone-7-codex-audit.md for reproduced evidence and scope distinctions.

NEXT ACTION: plan Milestone 8 before implementation. Do not enable the production
VM flag or broaden browser authority from the Milestone 7 audit result.
```

## Session-close note

Checkpoint 7F began from accepted 7E head
`4240ff69458d9e80fbb2225f97973529d8198fa9`. Its durable acceptance record is
`docs/milestone-7-checkpoint-7f.md`.

The collaboration/checkpoint policy from
`387dbd44f3d2f00c479fc0377520772e0269606e` is part of the accepted branch state.
The policy was a direct child of the then-current 7F validation head, so it was
integrated without discarding 7F evidence.

The final Milestone 7 branch SHA is established only after temporary CI
instrumentation is restored and the final exact-head standard CI passes; record
that SHA in the closing session report rather than attempting a self-referential
commit inside this file.

## Audit gate

**Passed on 2026-09-12.** Codex independently audited final head
`551e8283c0417b173e106ee0598cca848f2f4ff0`; see
`docs/milestone-7-codex-audit.md`. Milestone 8 remains not started, but its
planning gate is now open.
