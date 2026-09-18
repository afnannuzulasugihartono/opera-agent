# Repowise R6 validation

R6 validates whether the local Repowise integration can answer concrete Opera
Agent architecture/impact questions more efficiently and safely than starting
from broad text search alone.

Repowise remains a derived context layer. All conclusions below were checked
against the repository source-of-truth before acceptance.

## Evidence head

Exact benchmark evidence head:

`7fae3a095e7096cec6945b7c4ea274764881b609`

CI:

- CircleCI #147 `repowise_r6_validation`: **SUCCESS**.
- CircleCI #148 normal test/check/Chromium regression: **SUCCESS**.
- Vercel: **SUCCESS**.

The first benchmark attempt, CircleCI #146 at `8d26460...`, completed all ten
Repowise MCP calls but failed when the baseline tried to execute `rg`, which is
not installed in the CircleCI Python image. This was a harness/environment
failure, not a Repowise failure. The baseline was changed to portable
`git grep -IlE` and rerun once.

The committed reproducible harness is
`tools/repowise/r6_validate.py`. Temporary R6 CircleCI instrumentation is
removed at closeout.

## Frozen validation questions

### A. Runtime path from the VM Edge Function to the reactive VM and P3 gate

Repository ground truth is **two related branches**, not a single linear chain:

- VM execution:
  `supabase/functions/opera-agent-vm/index.ts`
  -> `lib/reactive-vm-7d.js`
  -> `lib/reactive-vm.js`.
- P3 relevance after effect observation:
  `supabase/functions/opera-agent-vm/index.ts`
  -> `lib/reactive-vm-host-7e.js`
  -> `lib/multi-signal-relevance-p3.js`.

After a successful `opera_await`, the Edge host invokes
`reconcileVmEffectObservation7E`; the 7E host owns the live relevance pipeline
and invokes its P3 reconcile path.

Repowise result: **correct**. Two `get_dependency_path` calls returned exactly
those two 2-hop paths and surfaced exactly the five expected files, with no
nonexistent path.

### B. Likely impact if `advanceReactiveVm` changes

Repowise `get_context` identified `advanceReactiveVm` in
`lib/reactive-vm.js` and directly surfaced the wrappers/callers and tests,
including:

- `lib/reactive-vm-7c.js`
- `lib/reactive-vm-7d.js`
- `tests/performance-runtime-cutover-p6.test.mjs`
- `tests/reactive-vm-7c.test.mjs`
- `tests/reactive-vm-core.test.mjs`

The risk view reported five direct dependents and ten transitive affected paths,
and also surfaced the 7D/7F/host/P4 regression neighborhood.

Repository verification agrees that the core implementation, wrappers, and
reactive/P6 tests are the first impact surface. Exact changes still determine
which transitive tests must be rerun.

Repowise result: **correct and useful for impact triage**.

### C. Main authority for durable VM state

The authority is the DB-backed 7E host state, not the in-memory P4 host.
The Edge Function uses Supabase RPC-backed lease/claim/checkpoint/effect
reservation/idempotency state.

Repowise search placed
`supabase/migrations/20260912130000_opera_agent_reactive_vm_host.sql` and its
`public.opera_vm_checkpoint` function at the top of the relevant results, with
`supabase/functions/opera-agent-vm/index.ts` immediately connected to it.
It also surfaced the 7E host implementation.

Repowise result: **correct**. It reduced a broad durable-state search to the
actual persistence migration + consuming host.

### D. Why full live P3/P4 acceleration is not enabled in P6

Repository ground truth:

- caller-supplied `taskDependencies` are rejected because they are not a
  trustworthy server-authoritative dependency source;
- live P3 task context therefore remains `MISSING`;
- ordinary live relevance updates conservatively require
  `REASON_REQUIRED`;
- only a valid accepted `APPLY_AND_CONTINUE` with the required no-wake/no-extra
  observation conditions may continue locally;
- therefore the safe P6 subset must not be described as full integrated P3/P4
  acceleration.

Repowise result: **correct but mixed in retrieval quality**.

`get_why` correctly refused to invent a decision record and recovered the
relevant Git archaeology, including the commit that fail-closed unauthoritative
caller `taskDependencies`. The companion full-text search surfaced the
`reactive-vm-host-7e.js` text explaining that caller-supplied dependencies are
not server-authoritative, plus P3/P4 gate code.

Limit: `get_why` reported no file-specific Git history for
`docs/delta-first-performance-plan.md` even though the repo-level Git tier was
full. That observation is not used as authority; the plan itself remains the
source of truth.

### E. File controlling the public MCP tool inventory

The public Opera Agent MCP inventory is registered in:

`supabase/functions/opera-agent-mcp/index.ts`

specifically inside `createServer()`, where the public tools are registered.

Repowise result: **correct target, but literal grep is better for this query**.
Searching for the literal `server.registerTool` produced a fuzzy-symbol warning
and extra neighbors; `get_context` on the known file correctly exposed
`createServer`. Repowise itself explicitly advised using grep for exhaustive
literal usage. This is an expected boundary, not something to hide.

## Repowise vs broad text search

The benchmark intentionally compares targeted Repowise MCP discovery with one
broad `git grep -IlE` candidate search per question.

| Question | Repowise calls | Repowise surfaced paths | Baseline grep calls | Baseline candidate files | Finding |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 2 | 5 | 1 | 19 | Repowise is much more focused and preserves both runtime branches. |
| B | 2 | 11 | 1 | 13 | Similar file count, but Repowise adds callers, dependents, risk and test context. |
| C | 2 | 8 | 1 | 33 | Repowise strongly narrows durable-state discovery. |
| D | 2 | 18 | 1 | 17 | No raw file-count win; Git archaeology/context is useful, decision lookup has limits. |
| E | 2 | 5 | 1 | 2 | Literal grep is simpler and more precise. |

Aggregate benchmark evidence:

- Repowise MCP calls: **10**.
- Baseline grep calls: **5**.
- Baseline candidate-file count summed across questions: **84**.
- Baseline unique candidate files: **51**.
- Repowise surfaced-path count summed across questions: **47**.
- Repowise nonexistent path mentions: **0**.

These counts are discovery metrics, not proof that Repowise always uses fewer
tool calls. Repowise often trades one cheap grep call for richer structural
context. The value is largest when the question is about dependency paths,
impact, durable ownership/state, or Git history; it is lower for exact literal
inventory searches.

The baseline candidate list also includes the R6 harness itself when its frozen
query strings match. This slightly inflates the raw baseline count, so the result
must not be presented as a universal performance ratio.

## Relevance, hallucination, and source-of-truth checks

- **Path correctness:** no nonexistent paths were emitted in the ten MCP calls.
- **Hallucination:** no material fabricated code path or durable-state authority
  was found.
- **Source-of-truth conflict:** no accepted answer contradicted the repository.
- **Decision/history caution:** `get_why` can return no decision record or
  incomplete per-file history; that must not be upgraded into an architectural
  conclusion.
- **Literal-search caution:** fuzzy symbol search is not an exhaustive literal
  search. Use `git grep`/repository search for exact inventory/rename work.
- **Freshness:** the benchmark index reported the evidence head as both indexed
  commit and live head; `index_behind=false`.
- **Mock embedder:** semantic search remained unavailable by design; the accepted
  R4/R5 privacy boundary was preserved.

## R6 conclusion

R6 validation evidence **passes** with documented limitations.

Repowise materially improves structural and impact-oriented orientation for this
repository, especially A, B, and C. It adds useful Git archaeology for D but
does not replace authoritative plan/decision records. For E-style literal
inventory queries, normal repository grep remains the preferred first tool.

The intended workflow is therefore hybrid:

`Repowise orientation -> exact source verification -> tests/CI evidence`

and not:

`Repowise output -> assumed truth`.

No R6 result changes Opera Agent runtime, production Supabase, OAuth/signing,
Protocol 1, the 26 browser capabilities, the 18 public Opera Agent MCP tools,
the P6 acceptance state, or the Milestone 8E boundary.
