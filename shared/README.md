# @last-edited: 2026-11-14 UTC+7.
# @title: shared/ - the one pure core the remaining consumers import.
# @state: the contract list; nothing lands here without a reason and a line.
# @dependencies: none.

# The one pure core

Every module here is pure JavaScript with no I/O, no DOM, no fetch, no Postgres, no chrome.*, no process, no Deno. The hosted functions and the driver import them; nothing else may claim a copy.

| Module | What it is | Who imports it |
|---|---|---|
| `digest.js` | The one canonical encoder and its SHA-256. The VM digests itself with this, byte-identical by construction. | `shared/reactive-vm*.js`, `hosted/functions/_shared/goal-ledger.ts` |
| `ax-menu.js` | The AX-tree menu walk (find, plan, open, fast-open, refused). | shared by the local surface driver; gates on `tests/shared/ax-menu.test.mjs` |
| `canonical-order.js` | The code-unit comparator every digest sorts by. | `shared/semantic-working-state.js`, `shared/reactive-vm-host.js`, `hosted/functions/_shared/proof-engine.ts`, `hosted/functions/_shared/goal-ledger.ts` |
| `delta-first-observation.js` | The changed-fact computation the model consumes as what moved, instead of the page wholesale. | the local read path |
| `multi-signal-relevance.js` | Relevance scoring the two read ladders use to decide what the model should look at. | the surface drivers |
| `reactive-vm.js` | The reactive VM: what a program may be, and what it evaluates to. | `hosted/functions/opera-agent-vm`, `tests/vm/` |
| `reactive-vm-collect.js` | The collector: the run of a program into the evidence it leaves. | `hosted/functions/opera-agent-vm`, `tests/vm/` |
| `reactive-vm-control-flow.js` | The control-flow state machine: branches, waits, retries, refusals. | `hosted/functions/opera-agent-vm`, `tests/vm/` |
| `reactive-vm-core.js` | The guard factory the three VM modules share — one implementation, byte-identical semantics. | the three `reactive-vm-*` modules |
| `reactive-vm-host.js` | The host side: what a run may persist and what it must refuse. | `tests/vm/` (pinned) |
| `secret-pattern.js` | The one credential-shape check the server refuses to cross. | `shared/reactive-vm*.js`, `hosted/functions/_shared/{goal-ledger,proof-engine}.js` |
| `semantic-working-state.js` | The semantic working state a read produces: the model's memory of the page. | the local read path |

# The rule for adding a module

Write it pure. The remaining consumers import it. It gets a line in the table. `tests/` covers it. If it needs chrome.*, fetch, fs, process or Deno, it does not belong here — it belongs on its own side.
