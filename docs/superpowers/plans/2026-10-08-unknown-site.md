# Unknown-Site Recon (browse.recon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give sites with no skill one explicit recon order with a total-stop CAPTCHA rule, as a registered workflow plus a written policy.

**Architecture:** A versioned `browse.recon` workflow migration (same `$wf$` registration pattern as `browse.find_in_list`) implements detect-then-map-then-act-then-verify using only proven mechanics — `page.find` counts with `truthy` checks (never text `contains`), `$ref` click chains (never cross-step `refFromStep`), and `fail` steps carrying codes. A new `docs/unknown-site.md` carries the order, pattern tables, budgets, and the stop/report/ask rule. No new primitive, no new step type, no MCP tool (runs via `run_workflow`), no compiler change.

**Tech Stack:** Node >= 22 (`node --test`), Supabase Postgres / PLpgSQL workflow definitions.

**Spec:** `docs/superpowers/specs/2026-10-08-unknown-site-design.md`

## Global Constraints

- Extension holds generic primitives only: no per-site code and no free `eval` ever in the extension.
- Migrations are timestamp-ordered and never rewritten once applied.
- Version in `extension/manifest.json` is the source of truth (currently `1.6.20`).
- Fast suite is `npm test`; gates are `npm test` plus `npm run check`.
- Every comment block is spaced from code it does not document (hygiene gate); migrations are exempt.
- No secret, token, or private key in the tree.

## Review Focus

- A block with novel wording evades every pattern and the run proceeds onto a CAPTCHA page — the verify phase must still catch the anomaly as a failed expectation, and the policy doc must tell the operator to report the new pattern rather than click through.
- A stale ref between the target find and the click silently no-ops — no scroll or re-render may sit between them; the click must directly follow its find.
- A consent wall with novel wording slips past the weak pair — same answer as the first line: fail honest, report, ask.
- A dismissible cookie banner must never read as a wall — `consent` alone (single weak hit) must never set blocked.
- A huge page must not blow the observation budget — the recon reads stay bounded (`limit: 12000` on reads, `limit: 5`–`10` on finds).

---

## File structure

- Create `supabase/migrations/20261009000001_opera_agent_browse_recon.sql` — registers `browse.recon` v1 (Task 1; verify the timestamp sorts after all existing migrations with `ls` first).
- Create `tests/recon-workflows.test.mjs` — parses the `$wf$` JSON and pins phases, patterns, thresholds, budgets, fail codes (Task 1).
- Create `docs/unknown-site.md` — order, pattern tables, budget table, stop/report/ask, skill-formation rule (Task 2).
- Modify `docs/handoff.md` — record the feature within the 150-line cap (Task 3).

Task 1 is the workflow plus its pins. Task 2 is the policy doc. Task 3 is the handoff plus the green gates.

---

### Task 1: browse.recon workflow

**Files:**
- Create: `supabase/migrations/20261009000001_opera_agent_browse_recon.sql`
- Create: `tests/recon-workflows.test.mjs`

**Interfaces:**
- Consumes: runner vocabulary (`command`, `if`, `set`, `fail`); `$ref` paths (`input.*`, `steps.*.result.*`, `vars.*`); proven result fields (`steps.<id>.result.page.text/title/url`, `steps.<id>.result.count`, `steps.<id>.result.item.ref`).
- Produces: workflow `browse.recon` v1 taking `{tabId, targetText?, action? ('click'|'fill'), value?, expectText?}` and emitting `{blocked, found, ref?, label?, title, url, blockPattern?}`.

Definition requirements (exact — write the JSON to meet them):

- Header comment: what the flow does plus the no-boundary-changes notice (copy the 5-line form from `20261008220000_opera_agent_browse_find_v3.sql:3-5`), then `select public.opera_register_workflow('browse.recon', $wf$...$wf$, '<description>', true);`.
- Steps in order: `read0` (`page.read`, params `{"tabId":{"$ref":"input.tabId"},"limit":12000}`); `setBlockedFalse` (`set` `vars.blocked = false`, `vars.blockPattern = ''`); four strong-pattern finds (name each stably, e.g. `findRecaptcha`: `page.find`, `{"tabId":...,"text":"<pattern>","exact":false,"limit":5}` for `recaptcha`, `captcha`, `verify you are human`, `select all images`), each followed by `if truthy steps.<id>.result.count → set blocked=true plus blockPattern=<pattern>`; two weak-pattern finds (`consent`, `privacy notice`) combined as nested pairs only (if w1-count truthy → [if w2-count truthy → set blocked]); `if vars.blocked truthy → fail {code:'CAPTCHA_BLOCKED', message naming the pattern from vars.blockPattern}`; map resolves from `read0` elements (no `collect` step — `page.collect_links` would add only unused hrefs); intent branch `if input.targetText exists` → `findT` (`page.find`, text `$ref input.targetText`, `exact:false`, `limit:10`) → `if findT.count truthy` → act (`page.click` with `ref: {$ref: 'steps.findT.result.item.ref'}` when action is click, `page.fill` with `ref` plus `value: {$ref:'input.value'}` when fill — encode with an `if/else` on `input.action`) → `read1` (`page.read`, same params as read0, keeping the observation fresh) → optional expect check (`if input.expectText exists` → `findV` text `$ref input.expectText` → `if count falsy → fail VERIFY_FAILED`) → `else (count falsy) → fail TARGET_NOT_FOUND`; output `{blocked: $ref vars.blocked, found, ref, label, title: $ref steps.read0.result.page.title, url: $ref steps.read0.result.page.url, blockPattern}`.
- Budgets: at most 12 `type: command` nodes, zero `repeat` nodes, no `page.scroll` anywhere (nothing may sit between findT and its click).
- Methods used, and only these: `page.read`, `page.find`, `page.click`, `page.fill`.

- [ ] **Step 1: Write the failing test**

Create `tests/recon-workflows.test.mjs` (header convention: `@last-edited`, `@title`, `@state`, `@dependencies: node:test, strict, node:fs`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261009000001_opera_agent_browse_recon.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

const STRONG = ['recaptcha', 'captcha', 'verify you are human', 'select all images'];
const WEAK = ['consent', 'privacy notice'];
const COMMAND_BUDGET = 12;

function walk(steps, visit, conditions = []) {
  for (const step of steps || []) {
    visit(step, conditions);
    const nest = (branch) => walk(branch, visit, [...conditions, step.condition]);
    if (step.type === 'if') { nest(step.then); nest(step.else); }
    if (step.type === 'repeat' || step.type === 'foreach') walk(step.steps, visit, conditions);
  }
}
const condText = (c) => JSON.stringify(c || {});

test('recon runs detect, map, act, verify in order with honest failures', () => {
  const def = definition();
  const ids = def.steps.map((s) => s.id || s.name);
  assert.ok(ids.indexOf('read0') < ids.indexOf('findT'), 'detect before act');
  const fails = [];
  walk(def.steps, (s) => { if (s.type === 'fail') fails.push(s.code); });
  assert.deepEqual([...new Set(fails)].sort(), ['CAPTCHA_BLOCKED', 'TARGET_NOT_FOUND', 'VERIFY_FAILED']);
});

test('every strong pattern blocks alone, weak patterns block only in pairs', () => {
  const def = definition();
  const findText = {};
  walk(def.steps, (s) => { if (s.type === 'command' && s.method === 'page.find') findText[s.id] = s.params.text; });
  for (const p of STRONG) assert.ok(Object.values(findText).includes(p), `strong pattern missing: ${p}`);
  for (const p of WEAK) assert.ok(Object.values(findText).includes(p), `weak pattern missing: ${p}`);
  const patternsIn = (conds) => conds
    .flatMap((c) => [...condText(c).matchAll(/steps\.([A-Za-z0-9_]+)\.result\.count/g)].map((m) => m[1]))
    .map((id) => findText[id])
    .filter(Boolean);
  const violations = [];
  walk(def.steps, (s, conditions) => {
    if (s.type !== 'if') return;
    const branches = [...(s.then || []), ...(s.else || [])];
    if (!branches.some((b) => b.type === 'set' && b.name === 'blocked' && b.value === true)) return;
    const pats = patternsIn([...conditions, s.condition]);
    const strongHits = pats.filter((p) => STRONG.includes(p));
    const weakHits = pats.filter((p) => WEAK.includes(p));
    if (strongHits.length === 0 && weakHits.length < 2) violations.push(pats);
  });
  assert.deepEqual(violations, [], 'consent alone must never block');
});

test('recon uses only known runner step types and methods, within budget', () => {
  const def = definition();
  const types = new Set(['command', 'if', 'set', 'repeat', 'foreach', 'wait', 'fail']);
  const methods = new Set(['page.read', 'page.find', 'page.click', 'page.fill']);
  let commands = 0;
  walk(def.steps, (s) => {
    assert.ok(types.has(s.type), `unknown step type ${s.type}`);
    if (s.type === 'command') {
      commands += 1;
      assert.ok(methods.has(s.method), `unknown method ${s.method}`);
    }
    assert.ok(s.type !== 'repeat', 'recon carries no repeat');
    if (s.type === 'command' && s.method === 'page.find') assert.equal(s.params.exact, false, 'generic-first: never exact');
  });
  assert.ok(commands <= COMMAND_BUDGET, `${commands} commands exceed budget ${COMMAND_BUDGET}`);
  assert.ok(!JSON.stringify(def.steps).includes('page.scroll'), 'nothing may sit between find and click');
});

test('output reports honestly', () => {
  const def = definition();
  for (const key of ['blocked', 'found', 'title', 'url']) assert.ok(def.output[key] !== undefined, `output misses ${key}`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/recon-workflows.test.mjs`
Expected: FAIL reading the missing migration file.

- [ ] **Step 3: Write the migration** to meet every requirement above (verify timestamp ordering with `ls supabase/migrations/ | tail -n 3` first; name pattern `^[a-z0-9][a-z0-9._-]{1,127}$` holds for `browse.recon`).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/recon-workflows.test.mjs` (expect PASS all 4), then `npm test 2>&1 | tail -n 9` (all pass).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261009000001_opera_agent_browse_recon.sql tests/recon-workflows.test.mjs
git commit -m "feat: browse.recon unknown-site workflow with CAPTCHA stop"
```

If any requirement cannot be expressed with the proven mechanics above (e.g. a `$ref` path with no in-tree precedent), STOP and report BLOCKED naming the path — do not invent executor semantics.

### Task 2: Policy document

**Files:**
- Create: `docs/unknown-site.md`

- [ ] **Step 1: Write the document** with exactly these sections (terse style, no sentence starting with `Do ` or `Don't ` — the hygiene gate forbids contradictions and this avoids them entirely):

```md
@last-edited: 2026-10-08 UTC+7.
@related: AGENTS.md, uec-north-star.md, superpowers/specs/2026-10-08-unknown-site-design.md (plain names here; the implementer writes them as resolving links in the real file per the brief)

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
```

Verify every relative link resolves (the suite's link gate checks this).

- [ ] **Step 2: Run** `node --test tests/hygiene.test.mjs` (link plus contradiction gates pass) and commit:

```bash
git add docs/unknown-site.md
git commit -m "docs: unknown-site protocol policy"
```

### Task 3: Handoff plus green gates

**Files:**
- Modify: `docs/handoff.md` (Still-open area only, cap 150 lines)

- [ ] **Step 1: Update the handoff** recording: `browse.recon` ships the unknown-site order (detect, map, act, verify) with total-stop CAPTCHA policy; novel patterns go to the operator loop, 3x recurrence becomes a named-workflow candidate. Cut a spent sentence to hold 150 lines.

- [ ] **Step 2: Run the full gates fresh** (`npm test` all pass; `npm run check` ok, still 28 primitives — no new primitive) and commit docs with `git commit -m "docs: unknown-site protocol shipped"`.

---

## Self-review

- Spec coverage: detect/map/act/verify plus stop rule is Task 1's definition; thresholds plus budgets are Task 1's pins; policy doc is Task 2; docs are Task 3. Re-detection every iteration is implemented as a post-act verify check (single-pass definition, no repeat nodes by budget design) — recorded here as the honest mechanism.
- Placeholder scan: every step carries exact code, patterns, numbers, file names, and commands. The `$ref` paths used all have in-tree precedent (`steps.*.result.page.*`, `steps.*.result.count`, `steps.*.result.item.ref`, `input.*`, `vars.*`).
- Type consistency: `browse.recon`, `CAPTCHA_BLOCKED`/`TARGET_NOT_FOUND`/`VERIFY_FAILED`, STRONG/WEAK lists, `COMMAND_BUDGET = 12` identical across tasks; input/output field names identical in Task 1's definition and the plan's Interfaces.
- Review Focus: novel-wording evasion is the report-and-ask loop (Task 2) plus verify-catch; stale refs are the no-scroll plus adjacency rule (Task 1 pin); novel consent walls are fail-honest plus report (Task 2); banner misclassification is the weak-pair structural pin (Task 1); huge pages are the read/find limit pins (Task 1).
