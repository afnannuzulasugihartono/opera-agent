---
name: "karpathy-guidelines"
description: "Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria."
license: MIT
metadata:
  author: "community (multica-ai/andrej-karpathy-skills)"
  source: "https://github.com/multica-ai/andrej-karpathy-skills"
  derived_from: "https://x.com/karpathy/status/2015883857489522876"
  note: "Not authored by Andrej Karpathy. A community file derived from his public observations."
---
@last-edited: 2026-10-04 18:25 UTC+7.
Last edited: 2026-10-04 17:52.

# Karpathy Guidelines

Simplify first. State what is true now, never its history.

Cover every button on every site. After the main sites hold, add sites that teach new functions.

Related: [AGENTS.md](../../../AGENTS.md) rules

Behavioral guidelines that reduce common LLM coding mistakes, derived from
[Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876)
on LLM coding pitfalls.

- Tradeoff: these bias toward caution over speed. For trivial tasks, use judgment.
- `[AGENTS.md](../../../AGENTS.md)` is binding and stricter. Where the two disagree, `[AGENTS.md](../../../AGENTS.md)` wins.
- Nothing here relaxes a repo rule.
- Simplicity applies to the mechanism, not to the evidence: a test that pins a contract
  is the deliverable, not speculative flexibility.

## 1. Think before coding

- Do not assume. Do not hide confusion. Surface tradeoffs.
- State assumptions explicitly. If uncertain, ask.
- If several interpretations exist, present them; never pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what is confusing, and ask.
- Report an inaccessible prerequisite instead of working around it. If a task needs a
  credential, key, or access that is not present, say so plainly; never substitute a
  different action that looks adjacent and silently rescope the work.
- Prefer a cheap reversible commit over an irreversible one. Do the reversible part
  first and ask about the part that cannot be undone.

## 2. Simplicity first

- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstraction for a single use.
- No flexibility or configurability nobody requested.
- No error handling for impossible scenarios.
- If it is 200 lines and could be 50, rewrite it.

Ask: would a senior engineer say this is overcomplicated? If yes, simplify.

## 3. Surgical changes

- Touch only what you must.
- Never improve adjacent code, comments, or formatting.
- Never refactor something that is not broken.
- Match the surrounding style even when you would write it differently.
- If you notice unrelated dead code, mention it; do not delete it.
- When your own change creates an orphan, remove it.
- Every changed line traces to the request.

Reporting is cheap; deleting someone else's artifact is a decision. Removing something
this change supersedes is required work, not tidying, and the commit message says which
of the two it was. A test that requires an artifact to stay deleted turns a preference
into an irreversible decision; never write one.

## 4. Goal-driven execution

- Define success as something verifiable, then loop until it actually runs.
- "Add validation" → write the failing test, then make it pass.
- "Fix the bug" → reproduce it, then make it pass.
- "Refactor X" → confirm the suite passes before and after.

For multi-step work, state the plan as steps each with its own verification:

```
1. <step> -> verify: <command or observable>
2. <step> -> verify: <command or observable>
```

Verifying means running the thing. Reading it and asserting it would work is not
verification, and neither is a green suite on its own.
