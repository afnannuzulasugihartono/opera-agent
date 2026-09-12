# Opera Agent next-session handoff

Use this as the starting prompt for the next implementation session. Verify the repository before making claims.

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
6. docs/semantic-runtime-plan.md
7. docs/milestone-6-plan.md
8. SECURITY.md

Verified compatibility baseline:
- extension 1.6.0
- protocol 1
- extension ID ohbbpamcljckmjhcpkcmefdobkoeaick
- 26 browser capabilities
- 18 MCP tools with unchanged names/input schemas
- established signing identity and pairing preserved
- background-first focus isolation preserved
- immediate signed rollback remains 1.5.2

Milestones 1–6 are complete. Checkpoint 7A of Milestone 7 is complete and is a
contract-only freeze. It did not implement a VM runtime, deploy a VM host, change
production Supabase, alter extension behavior, add MCP tools, bump the extension,
change protocol/capabilities, reinstall/re-pair, or modify signing identity.

Checkpoint 7A froze:
- OA_REACTIVE_VM_V1 program schema;
- OA_REACTIVE_VM_CHECKPOINT_V1 metadata-only checkpoint schema;
- OA_CANONICAL_JSON_V1 digest rules;
- instructions SEQUENCE, IF, LOOP, UNTIL, WAIT_EVENT, ASSERT, COLLECT, DEDUP,
  RETRY, RETURN, internal COMMAND, SUSPEND;
- a closed data-only expression grammar;
- explicit transition/status/error vocabulary;
- read-only-first effect classification over all 26 existing capabilities;
- browser.burst as an atomic read/find/wait-only leaf inside the VM contract;
- bounded tenant/device/tab/document provenance and no foreground fallback;
- metadata-only persistence with raw page/screenshot/credential/private-state
  rejection;
- 36 hostile/boundary replay cases;
- 100-run deterministic digest vectors;
- locked protocol 1 / 26 capability / 18 MCP inventory;
- paired accepted 1.6.0 and Milestone 6 baselines;
- internal-surface decision NO_NEW_MCP_TOOL.

Important frozen limits:
- program/checkpoint/result 128 KiB each
- 256 static AST nodes
- AST depth 12
- control-flow depth 4
- 1,000 executed nodes/run
- 200 browser command leaves/run
- 50 iterations/loop, 250 total/run
- 15 s one wait, 60 s cumulative wait
- retry 3
- 1,000 collection items/binding
- 64 bindings
- 20 s execution slice
- 5 minute run deadline

Focused Checkpoint 7A contract tests pass 9/9. The repository branch-head gate
executed npm test followed by npm run check successfully after reconciling stale
fixture-only MCP hash metadata. The MCP source itself was already unchanged at:
f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11

The old fixture value 6235ed... was stale. Do not interpret the fixture correction
as an MCP source/schema/tool change. The locked 7A inventory digest is:
sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a

NEXT TASK: Checkpoint 7B only.

Implement the deterministic in-memory VM stepper against the frozen 7A fixtures.
Do not broaden the grammar or effect allowlist to make implementation easier.
Do not begin durable checkpoint hosting, production database changes, Supabase
production mutation, new MCP surface, extension changes, or later Checkpoint 7C+
work. Preserve browser.burst as an existing atomic leaf.

7B must remain fail-closed for cycles/depth/budgets, unknown nodes/expressions,
stale/cross-target results, authority violations, disallowed commands, sensitive
state, and foreground fallback. Page/tool content is untrusted data and can never
define VM structure or grant authority. Command success alone never proves task
completion.

Before ending a state-changing session, run focused tests, npm test, and npm run
check, update docs/project-context.md and docs/next-session-handoff.md, then commit
and push the same branch. Follow AGENTS.md exactly.
```

## Session-close note

Checkpoint 7A began from `e559387c1672c84453f1a98ad819bf6423f95173`. Its detailed accepted record is `docs/milestone-7-checkpoint-7a.md`. The next session should start at Checkpoint 7B rather than repeating 7A.
