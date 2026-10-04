# Tests

Simplify first. State what is true now, never its history.

Related: [AGENTS.md](../AGENTS.md) rules - [runbook.md](../docs/runbook.md)

`npm test` runs `tests/*.test.mjs`, non-recursive. Node's built-in runner, no framework.
The count moves every session, so read it from the run rather than from this file.

| Path | Runs where |
|---|---|
| `tests/*.test.mjs` | every `npm test` |
| `tests/helpers/`, `tests/fixtures/` | support code and pinned contracts |
| `tests/cloud/`, `tests/postgres/`, `tests/deno/` | live-only, not in the fast suite |
| `tests/browser_extension_test.py` | browser harness against a real Brave |

Two kinds of test live here, and they are not equally load-bearing:

- **Behavior tests** import a runtime module and assert on what it does. These
  are the evidence; a change that breaks one broke the product.
- **Contract locks** pin a frozen digest (`tests/fixtures/*.json`,
  `tests/helpers/boundary-locks.mjs`). They exist so a deliberate edit to a
  runtime file has to say out loud why it is safe. Editing a pinned file without
  re-freezing is a red build, not a silent regression.

A lock is not a preference. Do not weaken a test to make a build pass, and do
not lock a removal — a test that requires an artifact to stay deleted turns one
opinion into an irreversible decision.
