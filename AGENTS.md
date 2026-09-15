# Opera Agent agent instructions

These instructions apply to the entire repository.

## Required session close

Before ending any work session that changes code, infrastructure, release state,
architecture, milestone status, accepted decisions, known limitations, or the next
task:

1. Update `docs/project-context.md` with the durable factual state.
2. Update `docs/next-session-handoff.md` so a fresh ChatGPT Web or Codex session
   can continue without relying on chat history.
3. Exclude transient quota values, speculation, passwords, tokens, pairing codes,
   OAuth secrets, private signing-key contents, raw sensitive page content, and
   other credentials.
4. Verify both documents against the repository and completed test evidence.
5. Include the context updates in the session's final commit and push them when
   the rest of that session is pushed.

For read-only questions that do not change project state, do not create noisy
context-only edits. If a session stops unexpectedly, perform this closeout at the
start of the next resumed session before taking new architectural work.

The durable context is a handoff aid, not a substitute for inspecting current code
and git state.

## Normal-Chat browser-control fallback

A ChatGPT conversation-level custom-MCP error is not evidence that the Opera
extension or durable browser command path is down. If the custom Opera Agent MCP
returns a host-side error such as `FORBIDDEN: This conversation does not support
developer MCPs`, do not redeploy/restart the MCP or extension merely to chase that
error.

When a connected Supabase connector is available, follow
`docs/chat-control-fallback.md`: use only the fixed `public.opera_enqueue` then
`public.opera_await` / `public.opera_await_capture` path and the frozen mapping in
`tests/fixtures/chat-control-fallback-v1.json`. Keep enqueue and await in separate
connector calls so the queued row commits before the extension must observe it.
Do not use arbitrary DML/DDL, generic SQL/RPC escape hatches, secret inspection,
pairing functions, or direct command/result-table writes as browser-control
fallback.

The fallback preserves the same browser safety rules as the MCP path: background
first, explicit target tab IDs, no silent foreground activation, and no password,
OTP, payment, upload, publish, purchase, send, or destructive action without the
user's explicit instruction. A successful fallback call proves the browser path,
not custom-MCP host eligibility; keep those acceptance claims distinct.

## Checkpoint implementation and milestone audit policy

Use one active writer on the milestone branch at a time. ChatGPT Web may own the
individual checkpoint implementation and live Opera/MCP acceptance. Codex performs
an independent audit after the complete milestone, before work starts on the next
milestone. Do not let two agents edit or push the same branch concurrently.

For every checkpoint implementation:

1. Read the repository instructions, current context, handoff, milestone plan,
   and all earlier acceptance records before editing.
2. State the exact checkpoint scope and explicit non-goals. Do not implement work
   assigned to a later checkpoint merely because it is convenient.
3. Inspect the current branch and remote head. Begin only from the latest accepted
   checkpoint commit and keep unrelated user changes intact.
4. Add deterministic failing tests before runtime behavior, then implement the
   smallest generic mechanism that satisfies the frozen contract.
5. Run focused tests, the full suite, static checks, and every browser/cloud/
   security gate required by the checkpoint plan.
6. Treat model-written reports and prior chat summaries as leads, not verified
   evidence. Record only results supported by repository state, exact commands,
   CI artifacts, browser observations, or production queries.
7. Never call a checkpoint complete when tests are intentionally red, CI is still
   running, temporary instrumentation remains, production cleanup is pending, or
   its acceptance record/context/handoff has not been committed.
8. Restore temporary CI changes, close temporary validation PRs according to the
   checkpoint plan, confirm cleanup/rollback state, record final SHA and net diff,
   update both context files, then commit and push.
9. Stop after the assigned checkpoint. Do not begin the next checkpoint in the
   same turn unless the user explicitly requests it after reviewing the result.

Request a Codex audit before production mutation, or immediately after a bounded
dark probe and before promotion, when a checkpoint changes authentication,
authorization, tenant isolation, encryption, signing identity, public MCP schemas,
extension/CRX distribution, irreversible actions, or production database shape.
An unexplained repeated failure or a proposed deviation from a frozen contract is
also an early-audit trigger.

At a milestone boundary, do not start the next milestone until Codex independently
reviews the complete diff and reruns proportionate tests. The audit must distinguish
code present, automated tests passing, live acceptance passing, and production
promotion. Its verdict is `PASS`, `CONDITIONAL PASS`, or `FAIL`; only `PASS` permits
the next milestone unless the user explicitly accepts documented residual risk.

The reusable ChatGPT Web checkpoint prompt is
`docs/prompts/chatgpt-web-checkpoint.md`.
