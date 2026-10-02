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

# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from
[Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876)
on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks,
use judgment.

## How this relates to `AGENTS.md`

`AGENTS.md` in this repository is **binding** and already enforces much of this,
plus considerably more that is specific to a codebase with frozen public-surface
digests, named migration orderings and checkpoint evidence requirements. Where the
two disagree, **`AGENTS.md` wins**. Nothing below relaxes a repo rule.

Two places where this file adds something `AGENTS.md` did not have before
2026-10-03, and both came from a real violation rather than from reading this:

- **Principle 3, "mention don't delete."** `AGENTS.md` rule 6 said preserve
  before overwrite, but it covered *overwriting* and said nothing about
  *discovering* something unusable. `opera_run_fast` was dropped and locked in a
  test on 2026-10-02, then restored on 2026-10-03. Rule 6 now carries that case
  explicitly, including the exception that makes it followable and the ban on
  locking a removal in a test.
- **Principle 1, "surface the tradeoff."** This repository has no rule about
  declining work or reporting an inaccessible prerequisite. Both happened during
  the 2026-10-02/03 latency work and neither had a rule to point at.

Where the two overlap, prefer `AGENTS.md`'s more specific wording. In particular
this repository's discipline of **deterministic failing tests before runtime
behavior** is stricter than "think before coding" and is not optional here.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

Two additions this repository needs on top of the above:

- **Report an inaccessible prerequisite instead of working around it.** If a task
  needs a credential, key, or project access that is not present, say so plainly.
  Do not substitute a different action that looks adjacent and silently change the
  scope.
- **Prefer a cheap reversible commit over an irreversible one.** If a change can be
  merged and undone later, do that first and ask about the part that cannot.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes,
simplify.

Note for this repository: a lock is not "speculative flexibility". A test that
pins a contract is the deliverable. Simplicity applies to the mechanism, not to
the evidence.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- **If you notice unrelated dead code, mention it - don't delete it.**

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

The bolded line is the one this repository found by breaking it. See the
`AGENTS.md` rule 6 note above. Concretely, here:

- Reporting is cheap; deleting someone else's artifact is a decision.
- Removing something **this change supersedes** is required work, not tidying.
  Say in the commit message which of the two it was.
- A test that requires an artifact to stay deleted makes a preference
  irreversible. Do not write one.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it
work") require constant clarification.

This is the most load-bearing principle in this repository, and it is already
enforced far beyond the text above: a lock here is not accepted until it has been
made to fail on a realistic violation, and a harness must test both directions.
Verifying means running the thing, not reading it and asserting that it would
work.