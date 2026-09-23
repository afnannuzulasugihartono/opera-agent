# U-V Action Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every action (click/fill/key/pointer) waits out dynamic targets, heals stale refs, and returns a final verified outcome in one command — no `stale` dead-ends, no model retries.

**Architecture:** One pure, DOM-free policy engine (`extension/lib/action-pipeline.js`, pattern of `lib/watch.js`) decides poll schedule, classification, and result envelopes. A thin host (`runActionPipeline` in `extension/background.js`) wraps the existing trusted executors, which are the single funnel all action paths already share (MCP page.*, burst steps, gateway /command, workflow steps, ETW local actions).

**Tech Stack:** Vanilla ES modules (`"type": "module"`), `node:test` + `node:assert/strict`, Python browser regression harness (Edge headless), CRX3 offline signing.

**Spec:** `docs/superpowers/specs/2026-09-23-uv-action-pipeline-design.md` (this plan argues from the spec; read both).

## Global Constraints

- Frozen protocol: METHOD_SPECS primitive set stays exactly the current 26 browser primitives; `watch.*` remains the only internal family. No new method names.
- Deadlines come from existing METHOD_SPECS values: `page.click`/`page.pointer`/`page.fill` = 8000 ms, `page.key` = 5000 ms. No new timeout constants.
- Poll ramp: 25 → 400 ms adaptive (25, 50, 100, 200, 400, 400…) clipped to deadline.
- Rebind ambiguity stays hard-refused (U-I geometry guard unchanged); ambiguity is reported, never guessed.
- `verified` is only ever set from an actual post-action check; no check ⇒ field omitted, never `true` by default.
- Error surface: `TARGET_NOT_READY { code, reason: 'not-found'|'not-actionable'|'ambiguous', waitedMs, hint, candidates? }`.
- Existing success envelopes are supersets: all current fields keep their meaning; only `resolved` is added.
- Any `extension/content.js` byte change triggers the 4 content hash-lock tests → rebaseline in the same task (procedure in Task 2), never left red across tasks.
- 1.6.7 ships build+sign+verify+upload **inactive**; activation is an explicit owner decision, out of plan scope.

## Review Focus

1. **Slow pages now block 8 s on genuinely missing targets** — a person clicking a command for a target that will never appear waits the full deadline. Expectation: `reason:'not-found'` arrives at deadline, and `waitedMs` makes the stall visible; pinned by Task 1 deadline-clipping test and Task 3 not-found integration test.
2. **Toggle buttons whose click leaves them actionable** — verify would report `verified:false` forever on aria-pressed toggles. Expectation: click verify treats "still present but state/aria changed" as verified; Task 3 verify test pins the state-change path, not just disappearance.
3. **Ambiguous rebind must not silently pick a candidate** — a person would expect the same refusal behavior as U-I, with candidates listed. Pinned by Task 1 classify test (ambiguous returns candidates, never a pick) and Task 3 ambiguous error-shape test.
4. **Burst partial failure semantics** — a burst step that ends `TARGET_NOT_READY` after waiting must fail that step with the structured error, not the old string error, and later steps must not run. Pinned by Task 3 source-contract test on burst routing + error mapping.
5. **Deadline double-borrowing** — the command deadline (`executeCommand` race) and the pipeline wait budget share one clock; pipeline must never outlive the command race or the race wins with a generic timeout. Pinned by Task 3 test that pipeline honors `context.deadline` when smaller than METHOD_SPECS.

---

### Task 1: Pure engine `action-pipeline.js`

**Files:**
- Create: `extension/lib/action-pipeline.js`
- Test: `tests/action-pipeline.test.mjs`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Task 3): `ACTION_RAMP_MS` (const `[25,50,100,200,400]`), `pollDelays(deadlineMs, elapsedMs=0) -> number[]` (ramp values, last repeating, cumulative never exceeding `deadlineMs - elapsedMs`; empty when no budget), `classifyResolve(state) -> 'ready'|'not-found'|'not-actionable'|'ambiguous'` (state: `{present, actionable, ambiguous, candidates?}`), `makeNotReady(reason, waitedMs, hint, candidates?) -> {code,reason,waitedMs,hint,candidates?}`, `attachResolution(envelope, {attempts, waitedMs, healed, verified?}) -> envelope` (adds `resolved`; omits `verified` when `undefined`).

- [ ] **Step 1: Write the failing test**

```js
// tests/action-pipeline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_RAMP_MS, pollDelays, classifyResolve, makeNotReady, attachResolution
} from '../extension/lib/action-pipeline.js';

test('pollDelays follows the 25..400 ramp', () => {
  assert.deepEqual(pollDelays(10_000), [25, 50, 100, 200, 400, 400, 400, 400]);
});
test('pollDelays clips to remaining budget and is empty with none', () => {
  assert.deepEqual(pollDelays(300), [25, 50, 100]);
  assert.deepEqual(pollDelays(100, 100), []);
});
test('classifyResolve maps states', () => {
  assert.equal(classifyResolve({ present: true, actionable: true }), 'ready');
  assert.equal(classifyResolve({ present: false }), 'not-found');
  assert.equal(classifyResolve({ present: true, actionable: false }), 'not-actionable');
  assert.equal(classifyResolve({ present: true, actionable: false, ambiguous: true, candidates: ['a', 'b'] }), 'ambiguous');
});
test('makeNotReady shape: ambiguous carries candidates, others do not', () => {
  const amb = makeNotReady('ambiguous', 8000, 'Pick deliberately.', ['x', 'y']);
  assert.equal(amb.code, 'TARGET_NOT_READY');
  assert.deepEqual(amb.candidates, ['x', 'y']);
  assert.equal('candidates' in makeNotReady('not-found', 8000, 'Wait or re-find.'), false);
});
test('attachResolution adds resolved and omits absent verified', () => {
  const env = attachResolution({ ok: true, method: 'debugger' }, { attempts: 3, waitedMs: 175, healed: true });
  assert.deepEqual(env.resolved, { attempts: 3, waitedMs: 175, healed: true, verified: undefined });
  assert.equal('verified' in env.resolved, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/action-pipeline.test.mjs`
Expected: FAIL with "Cannot find module … action-pipeline.js"

- [ ] **Step 3: Write minimal implementation**

```js
// extension/lib/action-pipeline.js
// U-V Action Pipeline (2026-09-23): pure policy engine for Resolve -> Wait ->
// Heal -> Verify. NO DOM, NO chrome: the host supplies resolve snapshots and
// executes decisions, so the engine stays deterministic and testable in Node.
// Semantics locked by tests/action-pipeline.test.mjs.

export const ACTION_RAMP_MS = [25, 50, 100, 200, 400];

export function pollDelays(deadlineMs, elapsedMs = 0) {
  const budget = deadlineMs - elapsedMs;
  const delays = [];
  let used = 0;
  for (let i = 0; ; i += 1) {
    const d = ACTION_RAMP_MS[Math.min(i, ACTION_RAMP_MS.length - 1)];
    if (used + d > budget) break;
    delays.push(d);
    used += d;
  }
  return delays;
}

export function classifyResolve(state) {
  if (!state || state.present !== true) return 'not-found';
  if (state.ambiguous === true) return 'ambiguous';
  return state.actionable === true ? 'ready' : 'not-actionable';
}

export function makeNotReady(reason, waitedMs, hint, candidates) {
  const err = { code: 'TARGET_NOT_READY', reason, waitedMs, hint };
  if (reason === 'ambiguous' && candidates) err.candidates = candidates;
  return err;
}

export function attachResolution(envelope, { attempts, waitedMs, healed, verified }) {
  const resolved = { attempts, waitedMs, healed };
  if (verified !== undefined) resolved.verified = verified;
  return { ...envelope, resolved };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/action-pipeline.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/lib/action-pipeline.js tests/action-pipeline.test.mjs
git commit -m "feat(uv): pure action-pipeline policy engine (poll ramp, classify, TARGET_NOT_READY, resolved telemetry)"
```

### Task 2: Content resolver `page.action_state` + hash rebaseline

**Files:**
- Modify: `extension/content.js` (message handler switch, near the existing `page.click_info` handler)
- Test: `tests/action-pipeline.test.mjs` (append source-contract block)

**Interfaces:**
- Consumes: existing content machinery `resolveActionRef(ref)`, `actionabilityOf(el)` (names as found in content.js — locate exact spellings before writing).
- Produces: content message `page.action_state` `{ref} -> {present:boolean, actionable:boolean, ambiguous:boolean, candidates?:string[], rebound?:boolean, stateChanged?:boolean}` — the shape Task 1's `classifyResolve` consumes and Task 3's host polls. `stateChanged` is set when the element is present and a click toggled its state (aria-pressed/disabled transition) — consumed by Task 3's verify step.

- [ ] **Step 1: Write the failing source-contract test**

```js
test('content exposes page.action_state for the U-V pipeline', () => {
  const src = read('extension/content.js');
  assert.match(src, /page\.action_state/, 'handler must exist');
  assert.match(src, /resolveActionRef\(.*ref/, 'must resolve through the U-I rebind machinery');
  assert.match(src, /candidates/, 'ambiguity must surface candidates');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/action-pipeline.test.mjs`
Expected: new test FAILs (no `page.action_state` in content.js)

- [ ] **Step 3: Implement the handler in content.js**

In the content message switch, add a case mirroring `page.click_info`'s structure: resolve via `resolveActionRef(ref)`; on miss return `{present:false, actionable:false, ambiguous:false}`; on hit compute actionability via the same path `page.click_info` uses; when resolve reports a keyed rebind, set `rebound:true`; when the U-I machinery refuses as ambiguous, return `{present:true, actionable:false, ambiguous:true, candidates:[...labels]}` from the refusal payload it already builds.

- [ ] **Step 4: Rebaseline the content hash-locks (same task, never deferred)**

Run: `npm test 2>&1 | grep "^not ok"` — expect the 4 content.js hash-lock failures plus nothing else new.
Then recompute and replace the old sha256 with the new content.js digest at each lock site (same procedure as U-S/U-T):

```bash
SHA=$(node -e "const c=require('crypto'),f=require('fs');const b=f.readFileSync('extension/content.js');console.log(c.createHash('sha256').update(b).digest('hex'))")
grep -rln "$OLD_SHA" tests/ | xargs sed -i "s/$OLD_SHA/$SHA/g"   # OLD_SHA printed by the failing tests
npm test 2>&1 | grep -c "^not ok"   # expect only pre-existing #250
```

- [ ] **Step 5: Run engine+contract suite, then commit**

Run: `node --test tests/action-pipeline.test.mjs`
Expected: PASS (all, including new contract test)

```bash
git add extension/content.js tests/action-pipeline.test.mjs
git commit -m "feat(uv): content page.action_state resolver (present/actionable/ambiguous/rebound) + content hash rebaseline"
```

### Task 3: Host wiring — `runActionPipeline` over every action route

**Files:**
- Modify: `extension/background.js` (new `runActionPipeline` near the trusted executors; wrap the four dispatch call sites for `page.fill`/`page.click`/`page.pointer`/`page.key` (~lines 825–848), the workflow click site (~line 1001), the burst action-step executor, and the ETW local-action click)
- Test: `tests/action-pipeline.test.mjs` (append source-contract block)

**Interfaces:**
- Consumes: Task 1 engine functions; Task 2 `page.action_state`; existing `contentCall`, `trustedClick/trustedFill/trustedKey/trustedPointer`, `METHOD_SPECS` via `command.timeoutMs`, `context.deadline` already threaded by `executeCommand`.
- Produces: `async runActionPipeline(tabId, method, params, context, exec) -> envelope` where `exec(resolvedRef) -> envelope` runs the original trusted executor. Exported nowhere (internal), but source-contract locked.

- [ ] **Step 1: Write the failing source-contract tests**

```js
test('every action route funnels through runActionPipeline', () => {
  const src = read('extension/background.js');
  for (const site of ["trustedFill(tabId", "trustedClick(tabId", "trustedPointer(tabId", "trustedKey(tabId"]) {
    const direct = src.split('\n').filter(l => l.includes(site) && !l.includes('function ') && !l.includes('runActionPipeline'));
    assert.deepEqual(direct, [], `unwrapped direct call: ${site}`);
  }
  assert.match(src, /runActionPipeline/, 'host must exist');
  assert.match(src, /METHOD_SPECS|timeoutMs/, 'deadline from METHOD_SPECS/command');
  assert.match(src, /TARGET_NOT_READY/, 'structured error must pass through executeCommand verbatim');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/action-pipeline.test.mjs`
Expected: FAIL listing the unwrapped direct trusted* call lines

- [ ] **Step 3: Implement the host and wrap the routes**

```js
// background.js — U-V host: Resolve -> Wait -> Heal -> Verify around executors.
const UV_WAIT_FLOOR_MS = 250; // keep pipeline strictly inside the command race
async function runActionPipeline(tabId, method, params, context, exec) {
  const started = Date.now();
  const specTimeout = METHOD_SPECS[method]?.timeoutMs ?? 8000;
  const cmdDeadline = context?.deadline ?? (started + specTimeout);
  const deadline = Math.min(cmdDeadline, started + specTimeout);
  let attempts = 0; let healed = false; let waitedMs = 0;
  let state = await contentCall(tabId, 'page.action_state', { ref: params.ref });
  attempts += 1;
  if (state?.rebound) healed = true;
  let verdict = classifyResolve(state);
  const delays = pollDelays(deadline - started, 0);
  let di = 0;
  while (verdict !== 'ready' && verdict !== 'ambiguous' && di < delays.length
         && Date.now() + delays[di] < deadline - UV_WAIT_FLOOR_MS) {
    await new Promise(r => setTimeout(r, delays[di]));
    waitedMs += delays[di]; di += 1;
    state = await contentCall(tabId, 'page.action_state', { ref: params.ref });
    attempts += 1;
    if (state?.rebound) healed = true;
    verdict = classifyResolve(state);
  }
  if (verdict === 'ambiguous') {
    const hint = 'Refusal is deliberate (U-I guard). Pick a candidate or re-find with narrower text.';
    throw makeNotReady('ambiguous', waitedMs, hint, state.candidates);
  }
  if (verdict !== 'ready') {
    const hints = {
      'not-found': 'Target never appeared before deadline. Wait via watch.start or re-find later.',
      'not-actionable': 'Target present but not actionable (offscreen/hidden/disabled). Scroll or re-evaluate.'
    };
    throw makeNotReady(verdict, waitedMs, hints[verdict]);
  }
  const result = await exec(params.ref);
  if (state?.rebound) { /* healed already captured above */ }
  return attachResolution(result, { attempts, waitedMs, healed });
}
```

Wrap each route: `page.click` becomes
`? await runActionPipeline(tabId, 'page.click', params, context, (ref) => trustedClick(tabId, ref, context, executionMode(params), clickOptions))`
— same shape for fill/pointer/key (pointer passes `params`, key passes non-trusted fallback inside `exec` unchanged). Workflow site (line ~1001) and burst action-step executor get the same wrapper with their own `context`. ETW local action click likewise. **Verify step:** after `exec` for click, re-resolve once; `verified = !(st.present && st.actionable) || st.stateChanged === true` (content sets `stateChanged` on aria-pressed/disabled transition when present); attach `verified` only here; fill/key/pointer leave `verified` omitted in this plan (spec's open item).

- [ ] **Step 4: Map TARGET_NOT_READY through normalizeError**

In `executeCommand`'s catch path: if `error.code === 'TARGET_NOT_READY'`, return `{ ok:false, error: error }` verbatim (structured), preserving legacy string errors for everything else.

- [ ] **Step 5: Run suites, then commit**

Run: `node --test tests/action-pipeline.test.mjs && node --check extension/background.js`
Expected: PASS + clean syntax

```bash
git add extension/background.js tests/action-pipeline.test.mjs
git commit -m "feat(uv): runActionPipeline host wiring across MCP/burst/workflow/ETW action routes + TARGET_NOT_READY mapping"
```

### Task 4: Browser regression (Edge headless) — dynamic-target scenarios

**Files:**
- Create: `tests/fixtures/pre-uv-action-pipeline.html`
- Modify: `tests/browser_extension_test.py` (new scenario block after the U-T ETW block, before `tabs.close`)

**Interfaces:**
- Consumes: fixture conventions of `pre-8e-usability-ui-identity.html` (STATE.push command bridge, delayed DOM injection pattern of the ETW fixture).
- Produces: regression proof for spec §7.3 scenarios (a)(b)(c).

- [ ] **Step 1: Add the fixture**

Delayed targets: a `#late-btn` injected at +1.5 s (`setTimeout` in fixture), a `#replacer` that swaps `#victim` for a fresh node with identical geometry+text at +0.8 s (kills the ref), and a toggle `#tog` whose click flips `aria-pressed`. Copy the bridge/bootstrap blocks verbatim from the ETW fixture.

- [ ] **Step 2: Add the Python scenario**

```python
# U-V: instant-by-default actions (single command, no retries)
r = STATE.push('page.click', {'tabId': uv_tab_id, 'ref': uv_late_ref, 'timeoutMs': 8000})
assert r['ok'] is True, r                       # waited out the +1.5s injection
assert r['result']['resolved']['waitedMs'] >= 1400, r
assert r['result']['resolved']['attempts'] >= 2, r
r2 = STATE.push('page.click', {'tabId': uv_tab_id, 'ref': uv_victim_ref})
assert r2['ok'] is True and r2['result']['resolved']['healed'] is True, r2
r3 = STATE.push('page.click', {'tabId': uv_tab_id, 'ref': uv_tog_ref})
assert r3['result']['resolved'].get('verified') is True, r3
nr = STATE.push('page.click', {'tabId': uv_tab_id, 'ref': uv_ghost_ref})
assert nr['ok'] is False and nr['error']['code'] == 'TARGET_NOT_READY', nr
assert nr['error']['reason'] == 'not-found', nr
```

(`uv_*_ref` values are captured from a prior `page.find` exactly like the U-S/U-T blocks do — follow the existing pattern in the file.)

- [ ] **Step 3: Run the browser regression**

Run: `OA_BROWSER_EXECUTABLE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" python tests/browser_extension_test.py 2>&1 | tail -20`
Expected: EXIT=0, all scenarios green including U-V block

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/pre-uv-action-pipeline.html tests/browser_extension_test.py
git commit -m "test(uv): Edge-headless regression for wait/heal/verify/not-found scenarios"
```

### Task 5: Suite sweep, rebaseline, version 1.6.7

**Files:**
- Modify: `extension/manifest.json` (version 1.6.7), the version-assertion test sites named by the failing tests (same set as the 1.6.6 sweep), any digest/hash locks that pin background.js bytes
- Test: full `npm test`

**Interfaces:**
- Consumes: established U-S/U-T rebaseline script pattern (`sha256CanonicalLf` over changed sources; replace old digests with new).
- Produces: green full suite at version 1.6.7.

- [ ] **Step 1: Full suite, collect failures**

Run: `npm test > /tmp/uv-test.log 2>&1; grep "^not ok" /tmp/uv-test.log`
Expected: only hash/digest/version-class failures (plus pre-existing #250)

- [ ] **Step 2: Rebaseline digests, sweep version to 1.6.7**

Update every failing lock with the recomputed digest of its pinned file (read the expected/actual diff in the log for exact values); bump manifest to `1.6.7`; update the same version-assertion sites the 1.6.6 sweep touched (visible in `git show` of that sweep).

- [ ] **Step 3: Full suite green**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 1` (pre-existing #250 root-governance only) and pass count ≥ the 1.6.6 baseline

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore(uv): rebaseline locks for action pipeline, version 1.6.7"
```

### Task 6: Release candidate — CRX 1.6.7 inactive + docs

**Files:**
- Create: `D:\Opera\opera-agent-1.6.7.crx` (build artifact, outside repo)
- Modify: `docs/checkpoint-uv-action-pipeline.md` (new), `docs/next-session-handoff.md` (release section)

**Interfaces:**
- Consumes: identity key `D:\Opera\signing-private\opera-agent-new-identity.pem`, calibrated verifier `D:\github\us-crx-verify.js`, DPAPI write path (`management-token.dpapi`) for `opera_releases` insert.
- Produces: signed 1.6.7 inactive in production; 1.6.6 remains the active serving line.

- [ ] **Step 1: Build + sign from a clean worktree**

```bash
cd /d/github && git -C opera-agent worktree add /d/github/uv-build HEAD
cd /d/github/uv-build && npm ci --omit=dev 2>/dev/null; true
# pack extension/ per the 1.6.6 procedure (documented in handoff §release), then:
# sign: chrome CRX3 with D:\Opera\signing-private\opera-agent-new-identity.pem
# output: D:\Opera\opera-agent-1.6.7.crx
git -C /d/github/opera-agent worktree remove /d/github/uv-build
```

- [ ] **Step 2: Offline verification**

```bash
cd /d/github && sed -i "s|for (const path of \['D:.*|for (const path of ['D:\\\\Opera\\\\opera-agent-1.6.7.crx']|" us-crx-verify.js && node us-crx-verify.js
```
Expected: `signatureValid:true`, two-way ID `ohbbpamcljckmjhcpkcmefdobkoeaick`, deterministic resign match.

- [ ] **Step 3: Upload inactive + negative check**

Insert the `opera_releases` row via the DPAPI database/query path (never print the token), then:
`update.xml?id=ohbbpamcljckmjhcpkcmefdobkoeaick` still serves **1.6.6**; the 1.6.7 CRX path returns **404** while inactive. SHA-256 of disk = DB row.

- [ ] **Step 4: Docs + push**

Write `docs/checkpoint-uv-action-pipeline.md` (evidence: suite counts, browser EXIT=0, CRX bytes/SHA); add the 1.6.7 release section to `docs/next-session-handoff.md` (shipped-inactive; acceptance + activation owner-gated); commit and push docs+code on `feat/pre-8e-usability-repair-r8` (repo convention), wait for CircleCI+Vercel green on the head.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-23-uv-action-pipeline.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next starts. Most thorough; Freebuff has no subagent dispatch, so this degrades to task-by-task fresh-context review in-session.
- **Native** — I implement every task myself in this session (executing-plans style), with one whole-branch review at the end. Fastest; matches how this harness runs work.

For this plan I recommend **Native**, because the six tasks share tightly coupled interfaces (engine → content handler → host routes) and browser regression needs one continuous environment; a shipped mistake is caught by the full suite + browser gate either way.
