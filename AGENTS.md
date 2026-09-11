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

