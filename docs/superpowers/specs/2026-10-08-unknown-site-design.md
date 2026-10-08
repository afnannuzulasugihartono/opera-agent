@last-edited: 2026-10-08 UTC+7.
@related: [`AGENTS.md`](../../../AGENTS.md) - [`../uec-north-star.md`](../../uec-north-star.md) - [`../../handoff.md`](../../handoff.md)

# Spec: unknown-site protocol with CAPTCHA stop rule

Generic reconnaissance plus a total-stop CAPTCHA policy. Approved in chat 2026-10-08.

## Intent

A task on a site with no skill follows one explicit order instead of improvisation: detect blocks, map the page, act with generic grounding, verify semantically — inside fixed budgets. CAPTCHA or content-blocking consent walls stop the run totally: no probe clicks, evidence returned, the user asked with page context. Success: a hand-written recon definition completes the `detect -> map -> act -> verify` sequence on an unknown page within budget, and a CAPTCHA page yields `CAPTCHA_BLOCKED` with evidence and zero clicks after detection. No new browser primitive, no new step vocabulary, no per-site extension code, no free `eval`.

## Non-goals

No CAPTCHA solving or single-checkbox attempts, no instruction-text-only protocol, no page-semantics logic in the compiler, no new queue transport, no secrets in definitions.

## Architecture

A versioned registered workflow `browse.recon` (same migration pattern as `browse.find_in_list`) plus a written policy in `docs/unknown-site.md`. The workflow is the enforced half; the document is the readable half, pinned only where it makes testable claims. Detection runs first and re-runs every iteration, so a mid-run CAPTCHA still stops the remainder.

## Components and workflow steps

Four phases using only allowlisted primitives and existing runner vocabulary. (1) `detect`: compact `page.read` plus `page.find` over the pattern list (`captcha`, `recaptcha`, `verify you are human`, `select all images`, `consent`) plus overlay coverage from read metadata. Threshold: one strong hit (captcha iframe or exact-match element) or two weak hits blocks. (2) `map`: `page.collect_links` plus interactive-element find, emitting `{ref, role, label}`. (3) `act`: caller-supplied intent steps consuming fresh `refFromStep` refs from the map. (4) `verify`: re-read plus declared success condition, one re-query plus one retry, then an honest status. A plain cookie banner is an ordinary step (dismiss when present, continue); a content-blocking wall is `CAPTCHA_BLOCKED`.

## Budgets and error handling

Hard budgets in the definition: 12 commands, 3 re-reads, repeat at most 6, 60-second run timeout. A block appearing mid-run re-triggers detection inside verification and fails the remainder with partial evidence (map plus screenshot hash). Unresponsive sites keep the existing `AWAIT_TIMEOUT` path: verify page state before any retry, never blind-repeat.

## Testing

All in `npm test`, no live fleet: definition pins (phase order, known types and methods only, `fail` carrying `CAPTCHA_BLOCKED`); pattern pins (every pattern string present, strong-single and weak-double thresholds coded); budget pins (12 commands, repeat at most 6, 60-second timeout); banner-versus-wall pins (dismissible banner continues, blocking wall stops). One integration test: the hand-written recon sequence completes within budget on a benign page shape.

## Policy document

`docs/unknown-site.md` carries the recon order, the pattern list with thresholds, the budget table, and the stop/report/ask rule (stop totally, return evidence, ask the user with page context). It also names the skill-formation rule: a pattern recurring 3 times becomes a named-workflow candidate, feeding the skill memory instead of living as improvisation.
