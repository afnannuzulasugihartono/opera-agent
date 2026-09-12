# 8D prerequisite — local lifetime remediation

Date: 2026-09-12.
Status: completed local prerequisite only; **Checkpoint 8D remains unaccepted and production remains closed**.
Starting head: `d266499fbf82bec95b44ab44f71ea8d8eba7e115`.
Implementation/test commit: `07a217d355874cba083dfd03e6117d3da03d5bd2`.

## Scope and implementation

This unit addresses only interval and declared lifetime-budget findings from the independent prerequisite review. Preparation now rejects lifetimes above either declared `prepareLifetimeMs` or `totalTransactionLifetimeMs`, in addition to the global bound. Approval creation and response verification use one shared interval validator: positive duration, global/declared approval TTL minimum, containment within prepared validity, and evaluation in the half-open issued/expiry interval.

Global and declared exact TTL boundaries remain valid; evaluation at expiry does not. No schema, tool, descriptor, provenance grammar, trusted identity model, persistence, clock source, or browser authority changed.

## Tests-first evidence

- Before runtime edits, the six-test suite had five expected missing-rejection failures and one passing compatibility test.
- Focused final remediation tests: 6/6 PASS, including global overrun, independently narrowed prepare/total lifetime, narrowed approval lifetime at creation/import, digest-valid imported overlong/reversed/zero/out-of-prepare intervals, no input mutation/state advancement on rejection, and precise inclusive TTL/exclusive expiry boundaries.
- Full Node regression: 210/210 PASS. An additional narrow-validity boundary assertion was subsequently added and the focused suite rerun 6/6; final exact-head CI is the required final regression gate.
- Syntax checks on both modified modules, `npm run check`, and `git diff --check`: PASS. Version remains 1.6.0, with 26 browser primitives and 18 locked MCP tools.
- Existing valid prepared fixture/digest compatibility remains covered by the full suite.

## Remaining gate

These changes do not authenticate provenance source claims, prove actual argument coverage, authenticate OAuth labels, prove human confirmation, or implement atomic nonce consumption. Those remain host/transport prerequisites, not claimed capabilities of this pure module. Other declared count/budget enforcement remains a candidate-review requirement; this unit specifically repairs lifetime budgets.

No Supabase queries, production rows/flags/configuration, migration, Edge Function, public MCP, OAuth runtime, extension/signing, pairing, or browser state was changed. No 8D host or SQL candidate was constructed and 8E did not begin.

Next bounded unit after user continuation: construct the isolated default-OFF/dark local host/admission candidate tests-first. Actual source/operand admission, database role/concurrency/rollback tests on real PostgreSQL, and independent review of exact SQL/host remain mandatory before any separately authorized production mutation.
