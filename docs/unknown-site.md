@last-edited: 2026-10-08 UTC+7.
@related: [`AGENTS.md`](../AGENTS.md) - [`uec-north-star.md`](uec-north-star.md) - [`superpowers/specs/2026-10-08-unknown-site-design.md`](superpowers/specs/2026-10-08-unknown-site-design.md)

# Unknown-site protocol

Order for a site with no skill: detect blocks, map the page, act with generic grounding, verify semantically. Enforced by `browse.recon`; this file is the readable half.

## Patterns and thresholds

Strong (one hit blocks): recaptcha, captcha, verify you are human, select all images. Weak (two hits block): consent, privacy notice. A plain cookie banner carries one weak hit at most, so it continues as an ordinary dismiss step.

## Budgets

12 commands, 3 re-reads, no repeat nodes, 60-second run timeout. Reads stay bounded (limit 12000, finds limit 5-10).

## Stop, report, ask

A block stops the run totally: no probe clicks after detection. The run returns the matched pattern plus a text excerpt as evidence. The operator is asked with page context (title, url, excerpt) and reports a novel pattern for the list above instead of clicking through.

## Skill formation

A pattern recurring 3 times becomes a named-workflow candidate, feeding skill memory instead of living as improvisation.
