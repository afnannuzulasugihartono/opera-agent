# Milestone 8 Checkpoint 8B — pure decision-causal prepare engine

Status: accepted pure-runtime checkpoint on 2026-09-12.

## Scope

Checkpoint 8B implements only the environment-neutral single-action preparation and policy-decision layer frozen by Checkpoint 8A. It performs no browser, network, database, ambient-clock, OAuth, MCP, extension, signing, or production work. Approval challenge verification remains assigned to 8C; durable hosting and all external execution remain later checkpoints.

The checkpoint started from accepted 8A head `5aa591cd0535983cc9d9df95ff56290d52dbe882`. The pure implementation/test commit is `0f333a1`.

## Implementation

`lib/transaction-prepare.js` now provides:

- immutable canonical `OA_TRANSACTION_V1` preparation and validation;
- strict single-action, schema, size, lifetime, digest, vocabulary, and secret-like-value gates;
- deterministic decision-predicate compilation and dependency fingerprints;
- selective semantic-delta revalidation with mandatory authority-fence revalidation;
- full revalidation/fail-closed planning for incomplete, ambiguous, reset, unavailable, or stale dependency coverage;
- conservative internal effect classification for all generic primitives;
- `OFF`/`DARK`/`ENFORCED` direct-mutation and transaction-availability decisions;
- atomic rejection of mixed mutating bursts under enforcement;
- an internal-context-only executor exception shape, while client-supplied lookalikes remain gated;
- bounded digest-only transaction previews.

All outputs are deeply frozen. Preparation receives explicit timestamps in its input and never reads an ambient clock.

## 8A erratum

Implementation review found that the accepted 8A plan required a trusted effect-classification table with unknown-default behavior, but the 8A fixture had only enumerated methods and effect classes. The contract fixture now explicitly freezes all generic transaction primitives to `IRREVERSIBLE_OR_UNKNOWN`, declares client-supplied classifications untrusted, and leaves the trusted narrower-descriptor list empty.

This correction is conservative: it prevents downgrade and adds no runtime/public authority. The 8A focused suite now contains an explicit lock for the table.

## Acceptance evidence

- TDD red state: missing `lib/transaction-prepare.js` and missing 8A effect-classification table were both observed before implementation;
- focused 8A+8B suite: 22/22 pass;
- 10,000 generated bounded candidates: all accepted only within the frozen singular shape and limits;
- identical input: byte-identical prepared envelope and digest;
- goal/authority revision, action, target, provenance, postcondition, or enforcement-mode mutation: prepare digest changes;
- second action, unknown fields/methods, effect downgrade, sensitive field, and over-limit input: deterministic rejection;
- 18-tool policy matrix: observations preserved, direct mutations gated in `ENFORCED`, mixed burst rejected before dispatch;
- 64-predicate revalidation p95: `0.0324 ms` on the controlled local Node 22 run, below the 10 ms gate;
- full deterministic suite after implementation: 193/193 pass;
- `npm run check`: pass, reporting version 1.6.0 and 26 allowlisted browser primitives;
- source syntax, environment-neutrality scan, and `git diff --check`: pass.

## Security and compatibility boundary

The module does not grant approval, verify approval challenges, dispatch browser actions, persist state, reserve commits, issue receipts, or produce proof. Generic action descriptors cannot claim a narrower effect class. Page/model/tool values still grant no authority, and action success still cannot create `PROVED`.

Checkpoint 8B changes no extension source/version/ID, protocol, public capability, MCP source/tool/schema, Edge Function, database/migration, OAuth configuration, production flag/row, signing identity, pairing, or browser state.

## Rollback

Revert the 8B implementation/tests and the documented 8A table erratum. The accepted 8A transaction schemas and Milestone 7 runtime remain intact; no production rollback is needed.

## Next checkpoint

Checkpoint 8C is the next permitted unit after user review. It may implement only the pure provenance and one-shot approval challenge verifier. Browser commit, public MCP transport, Supabase persistence, OAuth runtime changes, extension/signing work, and production mutation remain prohibited.
