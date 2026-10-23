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
  diversity, PvP/opponent modeling, touch/gamepad input, and audio beyond
  listen/transcribe: element-tap capture to Groq Whisper with segments in
  `opera_listen_segments` is shipped, extended audio modalities are deferred.

## Gates

- C3 (real-time dino) is the first acceptance test for real-time control.
- Later: unknown-game protocol (a game the agent has never seen, scored on
  adaptation cost, not just final score), then GameWorld-style breadth.

## Known gaps (from the 18-question audit)

- CAPTCHA/consent policy: stop, report, ask the user. Shipped as the
  total-stop rule in [`unknown-site.md`](unknown-site.md).
- Unknown-site protocol: what to do on a site with no skill, in which
  order, with what budget. Shipped as the `browse.recon` workflow, with the
  readable half in [`unknown-site.md`](unknown-site.md).

## Vetted external direction

Verified against primary sources (arXiv abstracts match the claims):
GameWorld (34 games, state-verifiable, RT track) and OSWorld 2.0 (108
long-horizon workflows, best 20.6% completion) both say the same thing:
frontier agents fail on constraints, mid-task information, hidden state,
and skipped verification — harness problems, not click problems. The rest
of the cited literature (SIMA 2, Voyager, WebWorld, OpenWebRL, PlugMem,
CUA-Skill, Agent S3) is accepted as cited, not yet verified here.

Adopted consequences, in priority order:

1. Opera stays the orchestrator and capability router; specialized workers
   (browser CUA, desktop CUA, coding) plug in underneath. Never the reverse,
   and never a tool-spaghetti pile without the router first.
2. Reliability over benchmark scores: observe, act, verify, recover. Our
   action pipeline and termination sensors already work this way at small
   scale; grow them before chasing any leaderboard.
3. Memory as reusable skill/knowledge, not raw history. Traces and workflows
   are the seed; formalize extraction only when a real task needs it.
4. OSWorld 2.0-class breadth is a later gate, not a current goal: it needs
   a desktop harness we do not have.
5. Queued design (not build): execute(graph) — ad-hoc intent graphs with
   constraints and verification, closing the gap between linear bursts and
   named workflows. The local-surface half now has a design:
   [`superpowers/specs/2026-10-23-local-run-task-design.md`](superpowers/specs/2026-10-23-local-run-task-design.md).
   Plus a generic-first grounding cascade (generic text
   find, site selectors as fallback) as a standing refinement rule.

Non-goals restated: no Fara competitor, no training cluster, no scores table
of vibes. Measured or it did not happen.
