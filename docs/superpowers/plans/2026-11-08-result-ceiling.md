# Result Ceiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the 512 KiB result cap and make the frame budget the one ceiling: 4 MiB frames on both runtimes, a 3.75 MiB result budget derived from them, and every trim keyed to that budget.

**Architecture:** `extension/lib/socket-protocol.js` owns `FRAME_MAX_BYTES`; `extension/lib/serialize.js` derives `RESULT_BUDGET_BYTES` from it, so one number moves the chain. The bridge keeps its own constant, and the existing chain tests compare the two. The trims that already exist (`read_page`'s element list, the map pull's tail, the tile slice) keep their shapes and change only their number.

**Tech Stack:** MV3 service worker modules, Deno edge function (`bridge-socket.ts`), `node:test`, Python browser harness.

**Spec:** `docs/superpowers/specs/2026-11-08-result-ceiling-design.md`

## Global Constraints

- `MAX_RESULT_BYTES` and the number 524288 disappear from the tree.
- One ceiling: `FRAME_MAX_BYTES = 4 MiB` (device) and `MAX_FRAME_BYTES = 4 MiB` (bridge); `RESULT_BUDGET_BYTES = FRAME_MAX_BYTES - 256 KiB` = 3.75 MiB.
- `MAX_DECOMPRESSED_BYTES` stays 8 MiB.
- `boundedResult` still refuses above the budget, with the new number in the message; it is the fail-fast for paths with no graceful form.
- Trims stay: `read_page`'s element list, the map pull's tail, and the tile slice, all keyed to `RESULT_BUDGET_BYTES`.
- No primitive, tool, or parameter changes.
- Headers and comment rules as usual; gates `npm test`, `npm run check`, the browser harness; re-pins only through `npm run gates:refresh` with the reason in the commit.

## Review Focus

- A result just under the budget with a command envelope around it: it must still fit the 4 MiB frame.
- A result over the budget on a path with no trim (`run_program`): it must fail fast with the new number, not hang to `AWAIT_OUTCOME_UNKNOWN`.
- A `read_page` on a long page: the element list must trim with `truncated: true` and a reason at the new budget, not before.
- A full-page tile walk: a slice must now carry more tiles than before, and the walk must still end at `documentHeight`.
- The chain tests: raising one runtime without the other must turn them red.

---

### Task 1: The frame budget, on both runtimes

**Files:**
- Modify: `extension/lib/socket-protocol.js` (`FRAME_MAX_BYTES` 1 MiB -> 4 MiB)
- Modify: `supabase/functions/opera-agent-bridge/bridge-socket.ts` (`MAX_FRAME_BYTES` 1 MiB -> 4 MiB)
- Test: `tests/device-socket-protocol.test.mjs`, `tests/bridge-socket.test.mjs`

**Interfaces:**
- Produces: `FRAME_MAX_BYTES = 4 * 1024 * 1024`; `MAX_FRAME_BYTES = 4 * 1024 * 1024`; `MAX_DECOMPRESSED_BYTES` unchanged at 8 MiB.

- [ ] **Step 1: Write the failing tests**

In `tests/device-socket-protocol.test.mjs`:

```js
test('the device carries a four-megabyte frame', () => {
  assert.equal(FRAME_MAX_BYTES, 4 * 1024 * 1024);
});
```

In `tests/bridge-socket.test.mjs`:

```js
test('the bridge accepts the frame the device now sends', () => {
  assert.equal(MAX_FRAME_BYTES, 4 * 1024 * 1024);
  assert.ok(MAX_DECOMPRESSED_BYTES >= MAX_FRAME_BYTES * 2, 'decompression still has twice the room');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/device-socket-protocol.test.mjs tests/bridge-socket.test.mjs`
Expected: FAIL — both constants are still 1 MiB.

- [ ] **Step 3: Implement**

Change the two constants only; no parsing logic moves.

- [ ] **Step 4: Run the two test files and the chain assertions**

Run: `node --test tests/device-socket-protocol.test.mjs tests/bridge-socket.test.mjs`
Expected: PASS, including the existing `>= 1.5 x MAX_RESULT_BYTES` relations.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/socket-protocol.js supabase/functions/opera-agent-bridge/bridge-socket.ts \
  tests/device-socket-protocol.test.mjs tests/bridge-socket.test.mjs
git commit -m "Give both runtimes a four-megabyte frame, before anything else is measured against it"
```

---

### Task 2: One result budget, derived, with the trims re-keyed

**Files:**
- Modify: `extension/lib/serialize.js` (remove `MAX_RESULT_BYTES`, add `RESULT_BUDGET_BYTES`)
- Modify: `extension/background.js` (both trims)
- Modify: `extension/worker/capture-page.js` (`TILE_SLICE_BYTES`)
- Test: `tests/serialize-budget.test.mjs`, `tests/hygiene.test.mjs`, `tests/role-reconcile.test.mjs`, `tests/mcp-surface.test.mjs` if a digest moves

**Interfaces:**
- Consumes: `FRAME_MAX_BYTES` from `extension/lib/socket-protocol.js`.
- Produces: `RESULT_BUDGET_BYTES = FRAME_MAX_BYTES - 256 * 1024`; `oversized(value)` compares against it; `boundedResult` throws `Result exceeds ${RESULT_BUDGET_BYTES} bytes. Use bounded/chunked reads.`

- [ ] **Step 1: Write the failing test**

In `tests/serialize-budget.test.mjs`:

```js
test('the result budget is the frame budget, less one envelope', () => {
  assert.equal(RESULT_BUDGET_BYTES, FRAME_MAX_BYTES - 256 * 1024);
  assert.equal(RESULT_BUDGET_BYTES, 3.75 * 1024 * 1024);
});

test('a three-megabyte result rides, and one over the budget is refused with the new number', () => {
  const big = { text: 'x'.repeat(3 * 1024 * 1024) };
  assert.equal(oversized(big), false);
  assert.doesNotThrow(() => boundedResult(big));
  const over = { text: 'x'.repeat(RESULT_BUDGET_BYTES + 1024) };
  assert.equal(oversized(over), true);
  assert.throws(() => boundedResult(over), new RegExp(`${RESULT_BUDGET_BYTES} bytes`));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/serialize-budget.test.mjs`
Expected: FAIL — `RESULT_BUDGET_BYTES` is not exported.

- [ ] **Step 3: Implement**

In `extension/lib/serialize.js`: import `FRAME_MAX_BYTES` from `./socket-protocol.js`; replace the constant with `export const RESULT_BUDGET_BYTES = FRAME_MAX_BYTES - 256 * 1024;`; make `oversized` compare against it and `boundedResult`'s message use it. Delete `MAX_RESULT_BYTES` and every import of it.

In `extension/background.js`: the `page.read` guard and both trims use `RESULT_BUDGET_BYTES` (no second subtraction).

In `extension/worker/capture-page.js`: `TILE_SLICE_BYTES = RESULT_BUDGET_BYTES - 256 * 1024`.

Update the pins that name the old constant: `tests/hygiene.test.mjs` (the `oversized` source assertion) and `tests/role-reconcile.test.mjs` (the refusal message), then `npm run gates:refresh`.

- [ ] **Step 4: Run the whole suite**

Run: `node --test tests/*.test.mjs`, `npm run check`, `npm run gates:refresh`
Expected: PASS. The commit names every pin that moved.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/serialize.js extension/background.js extension/worker/capture-page.js \
  tests/serialize-budget.test.mjs tests/hygiene.test.mjs tests/role-reconcile.test.mjs \
  tests/helpers/boundary-locks.mjs gates.lock
git commit -m "Delete the 512 KiB cap: the frame is the ceiling, and every trim reads from it"
```

---

### Task 3: The proof

- [ ] **Step 1:** Run the browser harness; expect the map pull and `read_page` on the fixture to carry no `truncated`.
- [ ] **Step 2:** Merge to `main`, reload the extension, and on the Wikipedia article pull `class: "link"` with `limit: 1000`; expect every element of the class' first thousand, no `truncated`, and a frame the bridge accepts.
- [ ] **Step 3:** Report the element count, the answer size, and the latency.

---

## Self-Review

- **Spec coverage:** the constant deleted (Task 2), the derived budget (Task 2), both frames raised (Task 1), decompression unchanged (Task 1's test), the trims re-keyed (Task 2), `boundedResult`'s new number (Task 2), the chain tests kept (Tasks 1-2), the proof (Task 3).
- **Type consistency:** `RESULT_BUDGET_BYTES` is the name every consumer uses; nothing keeps importing `MAX_RESULT_BYTES`; `TILE_SLICE_BYTES` derives from the budget.
- **Review Focus:** the envelope reserve covers a result just under the budget (Task 2's 3 MiB test); a refused path fails fast with the number (Task 2's throw test); `read_page` trims at the new budget (the harness in Task 3); the tile walk still ends at `documentHeight` (the harness's existing assertion); one runtime raised alone turns the chain red (Task 1's tests).
