@last-edited: 2026-10-08 UTC+7.
@related: [`AGENTS.md`](../AGENTS.md) - [`security.md`](security.md) - [`handoff.md`](handoff.md)

# UEC north star

Universal Environment Controller. A direction, not a build plan. Nothing
here authorizes work; every item still needs its own case, design, and plan.

## Thesis

The target is general real-time computer-use, not a game bot. Web games are
its hardest benchmark: fixed-step scoring punishes every millisecond of
latency, every hallucinated pixel, every unmeasured assumption. An agent
that survives unknown games transfers to docs, sheets, maps, and every
visual workflow for free.

## Layers

```text
strategy (LLM/VLM, seconds) -> tactical (policy, ~100ms) -> motor (Hz)
       observation bus: DOM/state -> CV -> small VLM -> large VLM
       experience: trace -> reflection -> versioned skills -> next game
```

## Principles

- Cheapest method that solves the subproblem. A threshold is not a
  placeholder for a model; a model is not a placeholder for thinking.
- Escalate observation only on low confidence. Never screenshot what DOM
  already says; never invoke VLM what CV already answers.
- Measure experience cost beside score (generalization efficiency): unseen
  performance per unit of experience, not raw score after infinite retries.
- No case, no feature. Audio, touch, gamepad, opponent models, and any
  training loop wait for a task that demands them.

## Already here (names added later)

- Async execution (burst, device-local loops), observation ladder (DOM to
  vision), trace-as-experience, death/stillness as termination.

## Next when earned

- Confidence values on every reading, gating aggressive action.
- Skill versioning with rollback on regression.
- GE/transfer/RT-robustness metrics on the fixture ladder (C0-C3).

## Explicitly deferred

- RL training, learned world models, JEPA pretraining, XLand-scale
  diversity, PvP/opponent modeling, audio/touch/gamepad input.

## Gates

- C3 (real-time dino) is the first acceptance test for real-time control.
- Later: unknown-game protocol (a game the agent has never seen, scored on
  adaptation cost, not just final score), then GameWorld-style breadth.
