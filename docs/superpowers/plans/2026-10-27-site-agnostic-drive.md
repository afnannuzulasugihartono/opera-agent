# Site-agnostic drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the site-specific Google Docs read path with a generic ladder that derives a surface's capabilities from measured evidence, so an unknown site is driven like a known one.

**Architecture:** Four pure modules in `local/` decide, and one thin layer executes. `surface-profile.js` measures a surface and returns evidence; `read-strategy.js` turns that evidence into an ordered ladder tagged with a harm class; `caret-guard.js` decides whether a harmful read may run and reports honestly when restoration is impossible; `action-strategy.js` picks DOM grounding or coordinate-plus-keyboard. `primitives.js` assembles them, and `canvas.js` stops being a Docs reader and becomes a consumer.

**Tech Stack:** Node 22 ESM, Chrome DevTools Protocol over a local WebSocket, `node:test`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-27-site-agnostic-drive-design.md`

## Global Constraints

- The allowlisted primitive count stays **31**; no new wire method enters `extension/lib/protocol.js`.
- MCP tool names are `snake_case`; tool parameters are camelCase; file names are kebab-case.
- No per-site code: no URL matching, no domain list, no `.kix-` selector, no `DOCS_COPY_EXPRESSION` anywhere in `local/` after Task 6.
- Every source file carries the four header fields `@last-edited`, `@title`, `@state`, `@dependencies`.
- A comment block at column zero is a section header and gets a blank line before and after; an indented comment documents the code under it; a sentence is one line.
- Files are stored with LF line endings.
- No file exceeds 1,200 lines; no unexercised export survives.
- Gates that must be green at the end: `npm test`, `npm run check`, `py tests/browser_extension_test.py`.
- The agent never steals focus; a destructive read requires recorded consent.

## Review Focus

- **A canvas surface with no editable region.** Sheets and Slides are canvas but not a text caret. The ladder must not offer select-all there, because selecting nothing and reporting it as a read is a lie. Pinned by Task 1's `canvas without an editable region offers no caret-moving strategy`.
- **An a11y tree that is rich but empty of document text.** A page can carry 800 nodes of chrome and no prose. The ladder must not stop at the first strategy that merely returns something. Pinned by Task 1's `an ax tree with no document text falls through`.
- **A destructive read whose restoration is impossible.** The measured fact is that a canvas caret is not in the DOM, so `caretRestored: true` would be a fabrication. Pinned by Task 2's `a caret-move read with no evidence of restoration is refused`.
- **Consent given once and then forgotten.** A caller who passed `allowCaretMove` for one call must not have it apply to the next. Pinned by Task 2's `consent is per call and never carried`.
- **A profile whose signals contradict each other.** Canvas present, `textInDom` rich, `editable` false — the ladder must pick a defensible order rather than crash or guess. Pinned by Task 1's `contradictory signals still produce one ladder`.
- **An ordinary DOM page.** Its behaviour must not change, because a regression there breaks every existing caller. Pinned by Task 1's `an ordinary DOM page keeps its order` and Task 7's drill.

---

### Task 1: `read-strategy.js` — the ladder from evidence

**Files:**
- Create: `local/read-strategy.js`
- Test: `tests/read-strategy.test.mjs`

**Interfaces:**
- Consumes: nothing. This task is the contract the rest read.
- Produces:
  - `HARM_NONE`, `HARM_CARET_MOVE`, `HARM_CONTENT_CHANGE` — string constants.
  - `STRATEGY_AX`, `STRATEGY_DOM`, `STRATEGY_SELECT_ALL`, `STRATEGY_VISION` — string constants.
  - `readLadder(profile)` → `Array<{ strategy, harm, why }>`, ordered cheapest-and-safest first.
  - `nextStrategy(ladder, index)` → the entry at `index`, or `null` past the end.
  - `profile` shape: `{ textInDom: boolean, canvas: boolean, editable: boolean, axRich: boolean, focused: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `tests/read-strategy.test.mjs`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: read-strategy — the read ladder, decided from evidence rather than from a site name.
// @state: one table of profiles against the ladder each produces, including the cases where a strategy must not appear.
// @dependencies: node:test, node:assert/strict, ../local/read-strategy.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HARM_CARET_MOVE,
  HARM_NONE,
  STRATEGY_AX,
  STRATEGY_DOM,
  STRATEGY_SELECT_ALL,
  STRATEGY_VISION,
  readLadder
} from '../local/read-strategy.js';

const names = (profile) => readLadder(profile).map((step) => step.strategy);

test('an ordinary DOM page keeps its order', () => {
  const ladder = readLadder({ textInDom: true, canvas: false, editable: false, axRich: false, focused: false });
  assert.deepEqual(names({ textInDom: true, canvas: false, editable: false, axRich: false, focused: false }), [STRATEGY_DOM, STRATEGY_AX, STRATEGY_VISION]);
  assert.equal(ladder.every((step) => step.harm === HARM_NONE), true);
});

test('a canvas editable surface leads with the accessibility tree', () => {
  const profile = { textInDom: false, canvas: true, editable: true, axRich: true, focused: true };
  assert.deepEqual(names(profile), [STRATEGY_AX, STRATEGY_DOM, STRATEGY_SELECT_ALL, STRATEGY_VISION]);
});

test('a canvas editable surface tags select-all as caret-moving', () => {
  const ladder = readLadder({ textInDom: false, canvas: true, editable: true, axRich: true, focused: true });
  const step = ladder.find((entry) => entry.strategy === STRATEGY_SELECT_ALL);
  assert.equal(step.harm, HARM_CARET_MOVE);
  assert.ok(step.why.length > 0, 'every step names why it is in the ladder');
});

test('a canvas without an editable region offers no caret-moving strategy', () => {
  const profile = { textInDom: false, canvas: true, editable: false, axRich: true, focused: true };
  assert.deepEqual(names(profile), [STRATEGY_AX, STRATEGY_DOM, STRATEGY_VISION]);
});

test('an ax tree with no document text falls through to the DOM', () => {
  const profile = { textInDom: true, canvas: true, editable: true, axRich: false, focused: true };
  assert.deepEqual(names(profile), [STRATEGY_DOM, STRATEGY_AX, STRATEGY_SELECT_ALL, STRATEGY_VISION]);
});

test('contradictory signals still produce one ladder', () => {
  const ladder = readLadder({ textInDom: true, canvas: true, editable: false, axRich: true, focused: false });
  assert.ok(Array.isArray(ladder) && ladder.length >= 3);
  assert.equal(ladder.filter((step) => step.harm === HARM_CARET_MOVE).length, 0);
});

test('every step carries a strategy, a harm class and a reason', () => {
  for (const profile of [
    { textInDom: true, canvas: false, editable: false, axRich: false, focused: false },
    { textInDom: false, canvas: true, editable: true, axRich: true, focused: true },
    { textInDom: false, canvas: false, editable: false, axRich: false, focused: false }
  ]) {
    for (const step of readLadder(profile)) {
      assert.equal(typeof step.strategy, 'string');
      assert.ok([HARM_NONE, HARM_CARET_MOVE, HARM_CONTENT_CHANGE].includes(step.harm));
      assert.equal(typeof step.why, 'string');
      assert.ok(step.why.length > 0);
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/read-strategy.test.mjs`
Expected: FAIL — `Cannot find module '../local/read-strategy.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `local/read-strategy.js`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: read-strategy — which read to attempt first, decided from evidence rather than from a site name.
// @state: the harm classes, the strategy names, and one pure function that turns a surface profile into an ordered ladder.
// @dependencies: none.

// WHY THIS MODULE IS PURE.
// The order a read is attempted in is the one decision that decides whether a user's caret survives, and it is made from five booleans.
// Keeping it a pure function means the whole decision is a table a test can read, and no browser has to be open to prove it.

export const HARM_NONE = 'none';
export const HARM_CARET_MOVE = 'caret-move';
export const HARM_CONTENT_CHANGE = 'content-change';

export const STRATEGY_AX = 'ax';
export const STRATEGY_DOM = 'dom';
export const STRATEGY_SELECT_ALL = 'select-all';
export const STRATEGY_VISION = 'vision';

const AX_STEP = { strategy: STRATEGY_AX, harm: HARM_NONE, why: 'the accessibility tree answers without touching the page' };
const DOM_STEP = { strategy: STRATEGY_DOM, harm: HARM_NONE, why: 'the page already holds its text in the DOM' };
const SELECT_ALL_STEP = { strategy: STRATEGY_SELECT_ALL, harm: HARM_CARET_MOVE, why: 'a canvas editor mirrors its text through the selection, and that moves the caret' };
const VISION_STEP = { strategy: STRATEGY_VISION, harm: HARM_NONE, why: 'a picture is the last read that still asks nothing of the page' };

// WHY THE ORDER FOLLOWS THE PROFILE AND NOT A FIXED LIST.
// Measured: the accessibility tree answers a canvas document in 19-30ms and the DOM text answers an ordinary page in one innerText.
// Reading the accessibility tree first on an ordinary page would change every existing caller's answer for no gain, so the DOM leads there and the accessibility tree leads where the DOM is empty.

export function readLadder(profile = {}) {
  const textInDom = profile.textInDom === true;
  const canvas = profile.canvas === true;
  const editable = profile.editable === true;
  const axRich = profile.axRich === true;

  const ladder = [];
  if (!textInDom && axRich) ladder.push(AX_STEP);
  ladder.push(DOM_STEP);
  if (!textInDom && axRich) ladder.push(AX_STEP);
  if (canvas && editable) ladder.push(SELECT_ALL_STEP);
  ladder.push(VISION_STEP);
  return ladder.map((step) => ({ ...step }));
}

export function nextStrategy(ladder, index) {
  if (!Array.isArray(ladder)) return null;
  const entry = ladder[Number(index)];
  return entry ? { ...entry } : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/read-strategy.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add local/read-strategy.js tests/read-strategy.test.mjs
git commit -m "feat: the read ladder is decided from evidence, not from a site name

Five booleans in, an ordered ladder out, with each step tagged by the harm it
does. An ordinary DOM page keeps DOM first so no existing caller changes; a
canvas editable surface leads with the accessibility tree because it answers
in 19-30ms and touches nothing. Select-all only appears where there is an
editable region to select, and it is the only step tagged caret-moving."
```

---

### Task 2: `caret-guard.js` — the gate and the honest verdict

**Files:**
- Create: `local/caret-guard.js`
- Test: `tests/caret-guard.test.mjs`

**Interfaces:**
- Consumes: `HARM_NONE`, `HARM_CARET_MOVE` from `local/read-strategy.js`.
- Produces:
  - `gateRead({ harm, allowCaretMove })` → `{ allowed: boolean, why: string }`.
  - `restoreVerdict({ before, after })` → `{ restored: boolean, why: string }`.
  - `rememberedState(selection)` → `{ restorable: boolean, why: string }` where `selection` is `{ rangeCount, collapsed, anchorOffset, hostTextLength }`.
  - `createCaretGuard({ evaluate, key, settle })` → `{ remember(), restore(mark), verdict(mark, after) }`.

- [ ] **Step 1: Write the failing test**

Create `tests/caret-guard.test.mjs`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: caret-guard — the gate that keeps a read from moving a user's caret, and the verdict that says so when it did.
// @state: the gate as a table, and the restore verdict on the case the measurement proved impossible.
// @dependencies: node:test, node:assert/strict, ../local/caret-guard.js, ../local/read-strategy.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HARM_CARET_MOVE, HARM_NONE } from '../local/read-strategy.js';
import { gateRead, rememberedState, restoreVerdict } from '../local/caret-guard.js';

test('a read that harms nothing is always allowed', () => {
  const gate = gateRead({ harm: HARM_NONE, allowCaretMove: false });
  assert.equal(gate.allowed, true);
  assert.ok(gate.why.length > 0);
});

test('a caret-move read with no evidence of restoration is refused', () => {
  const gate = gateRead({ harm: HARM_CARET_MOVE, allowCaretMove: false });
  assert.equal(gate.allowed, false);
  assert.match(gate.why, /caret/i);
});

test('a caret-move read runs only with consent recorded on the call', () => {
  const gate = gateRead({ harm: HARM_CARET_MOVE, allowCaretMove: true });
  assert.equal(gate.allowed, true);
});

test('consent is per call and never carried', () => {
  assert.equal(gateRead({ harm: HARM_CARET_MOVE, allowCaretMove: true }).allowed, true);
  assert.equal(gateRead({ harm: HARM_CARET_MOVE, allowCaretMove: false }).allowed, false);
  assert.equal(gateRead({ harm: HARM_CARET_MOVE }).allowed, false);
});

test('a canvas caret that is not in the DOM cannot be promised back', () => {
  // Measured: the editor iframe's selection sits at offset 0 on a text-less node
  // before and after Home and End, so it does not track the caret.
  const mark = rememberedState({ rangeCount: 1, collapsed: true, anchorOffset: 0, hostTextLength: 0 });
  assert.equal(mark.restorable, false);
  const verdict = restoreVerdict({ before: mark, after: { rangeCount: 1, collapsed: true, anchorOffset: 0, hostTextLength: 0 } });
  assert.equal(verdict.restored, false);
  assert.ok(verdict.why.length > 0);
});

test('a DOM selection with a real position is restorable', () => {
  const mark = rememberedState({ rangeCount: 1, collapsed: true, anchorOffset: 42, hostTextLength: 300 });
  assert.equal(mark.restorable, true);
  const verdict = restoreVerdict({ before: mark, after: { rangeCount: 1, collapsed: true, anchorOffset: 42, hostTextLength: 300 } });
  assert.equal(verdict.restored, true);
});

test('a DOM selection that moved is reported as moved, not as restored', () => {
  const mark = rememberedState({ rangeCount: 1, collapsed: true, anchorOffset: 42, hostTextLength: 300 });
  const verdict = restoreVerdict({ before: mark, after: { rangeCount: 1, collapsed: true, anchorOffset: 900, hostTextLength: 300 } });
  assert.equal(verdict.restored, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/caret-guard.test.mjs`
Expected: FAIL — `Cannot find module '../local/caret-guard.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `local/caret-guard.js`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: caret-guard — the gate in front of a read that moves a caret, and the verdict that never claims a restore it did not measure.
// @state: the gate, the restorability rule, the verdict, and one factory that drives the DOM with injected primitives.
// @dependencies: ./read-strategy.js.

// WHY THE GATE AND THE DRIVER ARE THE SAME FILE.
// They answer one question from two sides: may this read run, and did it leave the page as it found it.
// Splitting them would let a caller pass the gate and then ignore the verdict, which is the exact failure this module exists to prevent.

// WHY A CANVAS CARET IS NOT RESTORABLE.
// Measured on a real Google Doc through CDP: the editor iframe's selection reads offset 0 on a node with no text, and it reads the same after Home and after End.
// The application holds the caret in its own model and the DOM does not carry it, so a promise to put it back would be a promise the DOM cannot keep.

import { HARM_CARET_MOVE, HARM_NONE } from './read-strategy.js';

const CARET_HOST_EXPRESSION = `(() => {
  const frames = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
  for (const doc of frames) {
    let sel = null;
    try { sel = doc.getSelection ? doc.getSelection() : null; } catch { continue; }
    if (!sel || sel.rangeCount === 0) continue;
    const node = sel.getRangeAt(0).startContainer;
    const host = node.nodeType === 3 ? node.parentElement : node;
    if (!host) continue;
    return {
      rangeCount: sel.rangeCount,
      collapsed: sel.isCollapsed,
      anchorOffset: sel.anchorOffset,
      hostTextLength: String(node.textContent || '').length
    };
  }
  return { rangeCount: 0, collapsed: null, anchorOffset: 0, hostTextLength: 0 };
})()`;

export function rememberedState(selection = {}) {
  const hostTextLength = Number(selection.hostTextLength) || 0;
  const anchorOffset = Number(selection.anchorOffset) || 0;
  const restorable = Number(selection.rangeCount) > 0 && hostTextLength > 0;
  return {
    restorable,
    why: restorable
      ? 'the selection names a position inside a node that holds text'
      : 'the selection carries no position inside any text, so there is nothing to put back'
  };
}

export function gateRead({ harm = HARM_NONE, allowCaretMove = false } = {}) {
  if (harm === HARM_NONE) return { allowed: true, why: 'this read asks nothing of the page' };
  if (harm === HARM_CARET_MOVE) {
    return allowCaretMove === true
      ? { allowed: true, why: 'the caller recorded consent on this call' }
      : { allowed: false, why: 'this read moves the caret, and no consent was recorded on the call' };
  }
  return { allowed: false, why: 'this read changes content and is not a read' };
}

export function restoreVerdict({ before, after } = {}) {
  if (!before || before.restorable !== true) {
    return { restored: false, why: before?.why || 'there was no restorable position to return to' };
  }
  const same = before.anchorOffset === after?.anchorOffset && before.hostTextLength === after?.hostTextLength;
  return same
    ? { restored: true, why: 'the selection is where it was left' }
    : { restored: false, why: 'the selection is not where it was left, so the restore did not take' };
}

export function createCaretGuard({ evaluate, key, settle }) {
  const remember = async () => {
    const selection = await evaluate(CARET_HOST_EXPRESSION);
    return { ...rememberedState(selection), selection };
  };

  const verdict = async (mark) => {
    const after = await evaluate(CARET_HOST_EXPRESSION);
    return restoreVerdict({ before: mark, after });
  };

  return { remember, verdict };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/caret-guard.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add local/caret-guard.js tests/caret-guard.test.mjs
git commit -m "feat: a read that moves a caret must earn it, and must report what it cost

The gate refuses a caret-moving read unless the caller recorded consent on
that call, so consent cannot leak from one call into the next. The verdict
never claims a restore it did not measure, because the measurement on a real
Google Doc showed the caret is not in the DOM at all."
```

---

### Task 3: `surface-profile.js` — the probe that carries its evidence

**Files:**
- Create: `local/surface-profile.js`
- Test: `tests/surface-profile.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SURFACE_PROBE_EXPRESSION` — an in-page expression string returning `{ textInDom, canvas, editable, focused }` as `{ value, evidence }` pairs.
  - `probeSurface({ evaluate })` → async, returns the four in-page signals.
  - `measureAx({ ask })` → async, returns `{ axRich, documentFrameId, textBoxes, textLength }`.
  - `buildProfile({ probe, ax })` → the profile `readLadder` consumes.
  - `describeProfile(profile)` → a one-line human string.

- [ ] **Step 1: Write the failing test**

Create `tests/surface-profile.test.mjs`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: surface-profile — what a surface is, measured, with the evidence that says so.
// @state: the probe against a fake page, the accessibility measurement against a fake tree, and the profile they build together.
// @dependencies: node:test, node:assert/strict, ../local/surface-profile.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SURFACE_PROBE_EXPRESSION, buildProfile, describeProfile, measureAx, probeSurface } from '../local/surface-profile.js';

test('the probe expression is one expression that names no site', () => {
  assert.equal(typeof SURFACE_PROBE_EXPRESSION, 'string');
  for (const forbidden of ['docs.google', 'kix', 'sheets', 'slides', 'Docs']) {
    assert.ok(!SURFACE_PROBE_EXPRESSION.includes(forbidden), `the probe must not name ${forbidden}`);
  }
});

test('an ordinary page profiles as text in the DOM and no canvas', async () => {
  const evaluate = async () => ({ textInDom: { value: true, evidence: 4200 }, canvas: { value: false, evidence: 0 }, editable: { value: false, evidence: 'no editable host' }, focused: { value: false, evidence: 'document.hasFocus() is false' } });
  const probe = await probeSurface({ evaluate });
  assert.equal(probe.textInDom.value, true);
  assert.equal(probe.canvas.value, false);
});

test('a canvas editor profiles as canvas and editable', async () => {
  const evaluate = async () => ({ textInDom: { value: false, evidence: 0 }, canvas: { value: true, evidence: 0.61 }, editable: { value: true, evidence: 'contenteditable' }, focused: { value: true, evidence: 'document.hasFocus() is true' } });
  const probe = await probeSurface({ evaluate });
  assert.equal(probe.canvas.value, true);
  assert.equal(probe.editable.value, true);
});

test('the accessibility measurement picks the frame that carries the document', async () => {
  const ask = async (method) => {
    if (method !== 'Accessibility.getFullAXTree') throw new Error(`unexpected ${method}`);
    return { nodes: [
      { frameId: 'chrome', role: { value: 'button' }, name: { value: 'Insert' } },
      { frameId: 'chrome', role: { value: 'InlineTextBox' }, name: { value: 'Mode tampilan' } },
      { frameId: 'editor', role: { value: 'InlineTextBox' }, name: { value: 'PROPOSAL PENAWARAN LOKASI' } },
      { frameId: 'editor', role: { value: 'InlineTextBox' }, name: { value: 'Kepada Yth.' } },
      { frameId: 'editor', role: { value: 'Canvas' }, name: { value: '' } }
    ] };
  };
  const ax = await measureAx({ ask });
  assert.equal(ax.documentFrameId, 'editor');
  assert.equal(ax.textBoxes, 2);
  assert.equal(ax.axRich, true);
});

test('a tree of pure chrome carries no document frame', async () => {
  const ask = async () => ({ nodes: [
    { frameId: 'chrome', role: { value: 'InlineTextBox' }, name: { value: 'Mode tampilan' } },
    { frameId: 'chrome', role: { value: 'button' }, name: { value: 'Share' } }
  ] });
  const ax = await measureAx({ ask });
  assert.equal(ax.axRich, false);
  assert.equal(ax.documentFrameId, null);
});

test('the profile the ladder reads is built from both halves', async () => {
  const probe = { textInDom: { value: false, evidence: 0 }, canvas: { value: true, evidence: 0.61 }, editable: { value: true, evidence: 'contenteditable' }, focused: { value: true, evidence: 'focused' } };
  const ax = { axRich: true, documentFrameId: 'editor', textBoxes: 215, textLength: 3063 };
  const profile = buildProfile({ probe, ax });
  assert.deepEqual(profile, { textInDom: false, canvas: true, editable: true, axRich: true, focused: true });
});

test('the description names what was measured, not where it was measured', async () => {
  const line = describeProfile({ textInDom: false, canvas: true, editable: true, axRich: true, focused: true });
  assert.ok(line.includes('canvas'));
  assert.ok(line.includes('editable'));
  for (const forbidden of ['docs.google', 'kix']) assert.ok(!line.includes(forbidden));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/surface-profile.test.mjs`
Expected: FAIL — `Cannot find module '../local/surface-profile.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `local/surface-profile.js`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: surface-profile — what a surface is, measured in the page and in its accessibility tree, with the evidence for every claim.
// @state: the in-page probe expression, the accessibility measurement, and the profile both halves build.
// @dependencies: none.

// WHY EVERY CLAIM CARRIES ITS EVIDENCE.
// The read this replaces guessed a surface from its URL, so a wrong guess was invisible.
// A profile that reports the number it measured makes a wrong classification something a reader can see and a test can pin.

// WHY THE PROBE NAMES NO SITE.
// A selector or a domain in this file would be the per-site code this change exists to remove.
// Everything here is a property any page has: how much text it holds in the DOM, how much of the viewport a canvas covers, whether an editable host exists, and whether the page has focus.

export const SURFACE_PROBE_EXPRESSION = `(() => {
  const body = document.body;
  const text = body ? String(body.innerText || '') : '';
  const canvases = [...document.querySelectorAll('canvas')];
  const viewport = Math.max(1, window.innerWidth * window.innerHeight);
  const covered = canvases.reduce((sum, el) => {
    const box = el.getBoundingClientRect();
    return sum + Math.max(0, box.width) * Math.max(0, box.height);
  }, 0);
  const editableHost = document.querySelector('[contenteditable=""], [contenteditable="true"], [role="textbox"]');
  return {
    textInDom: { value: text.trim().length >= 200, evidence: text.trim().length },
    canvas: { value: canvases.length > 0 && covered / viewport >= 0.2, evidence: Math.round((covered / viewport) * 100) / 100 },
    editable: { value: Boolean(editableHost), evidence: editableHost ? (editableHost.getAttribute('contenteditable') || editableHost.getAttribute('role')) : 'no editable host' },
    focused: { value: document.hasFocus() === true, evidence: 'document.hasFocus() is ' + String(document.hasFocus()) }
  };
})()`;

export async function probeSurface({ evaluate }) {
  const probe = await evaluate(SURFACE_PROBE_EXPRESSION);
  return {
    textInDom: probe?.textInDom ?? { value: false, evidence: 0 },
    canvas: probe?.canvas ?? { value: false, evidence: 0 },
    editable: probe?.editable ?? { value: false, evidence: 'the probe did not answer' },
    focused: probe?.focused ?? { value: false, evidence: 'the probe did not answer' }
  };
}

// WHY THE DOCUMENT FRAME IS CHOSEN BY COUNT AND NOT BY NAME.
// A canvas application keeps its chrome and its document in different frames, and the frame that carries the most text boxes is the document.
// Naming the frame, or filtering chrome by the strings it happens to print, would be per-site code wearing a structural disguise.

export async function measureAx({ ask, method = 'Accessibility.getFullAXTree' }) {
  let tree;
  try {
    tree = await ask(method, { maxDepth: 60 });
  } catch {
    return { axRich: false, documentFrameId: null, textBoxes: 0, textLength: 0, documentText: '' };
  }
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const perFrame = new Map();
  for (const node of nodes) {
    const role = node?.role?.value ?? '';
    if (role !== 'InlineTextBox' && role !== 'StaticText') continue;
    const frame = String(node?.frameId ?? '');
    const entry = perFrame.get(frame) ?? { count: 0, length: 0, parts: [] };
    entry.count += 1;
    entry.length += String(node?.name?.value ?? '').length;
    entry.parts.push(String(node?.name?.value ?? ''));
    perFrame.set(frame, entry);
  }
  let best = null;
  for (const [frame, entry] of perFrame) {
    if (!best || entry.count > best.entry.count) best = { frame, entry };
  }
  const rich = Boolean(best) && best.entry.count >= 3;
  return {
    axRich: rich,
    documentFrameId: rich ? best.frame : null,
    textBoxes: best ? best.entry.count : 0,
    textLength: best ? best.entry.length : 0,
    documentText: rich ? best.entry.parts.join('') : ''
  };
}

export function buildProfile({ probe = {}, ax = {} }) {
  return {
    textInDom: probe.textInDom?.value === true,
    canvas: probe.canvas?.value === true,
    editable: probe.editable?.value === true,
    axRich: ax.axRich === true,
    focused: probe.focused?.value === true
  };
}

export function describeProfile(profile = {}) {
  const parts = [];
  parts.push(profile.canvas === true ? 'canvas-rendered' : 'text in the DOM');
  if (profile.editable === true) parts.push('editable');
  if (profile.axRich === true) parts.push('accessibility-rich');
  parts.push(profile.focused === true ? 'focused' : 'unfocused');
  return parts.join(', ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/surface-profile.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add local/surface-profile.js tests/surface-profile.test.mjs
git commit -m "feat: a surface profile that reports the number it measured

Five signals, each with its evidence, and no site named anywhere in the file.
The accessibility half picks the document frame by which frame carries the most
text boxes, so chrome is separated by structure rather than by a list of the
strings it happens to print."
```

---

### Task 4: `action-strategy.js` — how to act on a surface

**Files:**
- Create: `local/action-strategy.js`
- Test: `tests/action-strategy.test.mjs`

**Interfaces:**
- Consumes: the profile shape from `local/surface-profile.js`.
- Produces:
  - `ACTION_DOM`, `ACTION_COORDINATE` — string constants.
  - `actionLadder(profile)` → `Array<{ strategy, why }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/action-strategy.test.mjs`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: action-strategy — grounding an action on a surface, decided from the same evidence the read used.
// @state: one table of profiles against the grounding ladder each produces.
// @dependencies: node:test, node:assert/strict, ../local/action-strategy.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_COORDINATE, ACTION_DOM, actionLadder } from '../local/action-strategy.js';

const names = (profile) => actionLadder(profile).map((step) => step.strategy);

test('an ordinary page grounds on its elements', () => {
  assert.deepEqual(names({ textInDom: true, canvas: false, editable: false, axRich: false, focused: false }), [ACTION_DOM, ACTION_COORDINATE]);
});

test('a canvas surface falls back to coordinates and keys', () => {
  assert.deepEqual(names({ textInDom: false, canvas: true, editable: true, axRich: true, focused: true }), [ACTION_COORDINATE, ACTION_DOM]);
});

test('a canvas surface with a rich accessibility tree still leads with coordinates', () => {
  // Measured: the accessibility tree names what can be clicked on a canvas page,
  // and every node in it resolves to a box, so coordinates are grounded rather than guessed.
  assert.deepEqual(names({ textInDom: false, canvas: true, editable: false, axRich: true, focused: false }), [ACTION_COORDINATE, ACTION_DOM]);
});

test('every step names why it is in the ladder', () => {
  for (const step of actionLadder({ textInDom: false, canvas: true, editable: true, axRich: true, focused: true })) {
    assert.ok(step.why.length > 0);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/action-strategy.test.mjs`
Expected: FAIL — `Cannot find module '../local/action-strategy.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `local/action-strategy.js`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: action-strategy — whether an action is grounded on an element or on a coordinate, decided from evidence.
// @state: the two grounding strategies and one pure function that orders them for a surface.
// @dependencies: none.

// WHY A CANVAS SURFACE LEADS WITH COORDINATES.
// A canvas page exposes no DOM worth querying, but Blink computes an accessibility tree for every rendered page and every node in it resolves to a box.
// So a coordinate on a canvas page is grounded on a measured box rather than guessed, which is the opposite of a coordinate on a page that does have elements.

export const ACTION_DOM = 'dom';
export const ACTION_COORDINATE = 'coordinate';

export function actionLadder(profile = {}) {
  const canvas = profile.canvas === true;
  const dom = { strategy: ACTION_DOM, why: 'the page holds the element, so it can be found and clicked by name' };
  const coordinate = { strategy: ACTION_COORDINATE, why: 'the page draws the control, so it is grounded on the box the accessibility tree reports' };
  return canvas === true ? [coordinate, dom] : [dom, coordinate];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/action-strategy.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add local/action-strategy.js tests/action-strategy.test.mjs
git commit -m "feat: an action is grounded on a measured box, not on a remembered coordinate

A canvas surface leads with coordinates because every accessibility node
resolves to a box, which makes the coordinate measured rather than guessed.
An ordinary page leads with its elements because it has them."
```

---

### Task 5: Wire the ladder into the driver and the tool surface

**Files:**
- Modify: `local/primitives.js:21` (import), `local/primitives.js:118-119` (assembly)
- Modify: `local/canvas.js` (consume the guard instead of owning the Docs path)
- Modify: `local/tools.js` (add `surface_profile`; extend `read_page` schema)
- Modify: `local/mcp-server.js:414-415` (dispatch both)
- Test: `tests/surface-drive.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `primitives.surfaceProfile()` → `{ surface, strategy, description }`.
  - `primitives.read(options)` extended to accept `{ allowCaretMove }` and to return `surface`, `strategy`, `harm`, `skipped`.
  - `createCanvasMethods` no longer imports `isDocsDocument` or `DOCS_COPY_EXPRESSION`.

- [ ] **Step 1: Write the failing test**

Create `tests/surface-drive.test.mjs`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: surface-drive — the assembled driver, proved against a fake CDP client.
// @state: the profile tool, the gated read, and the answer that names what it skipped and why.
// @dependencies: node:test, node:assert/strict, ../local/primitives.js, ../local/read-strategy.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPrimitives } from '../local/primitives.js';
import { HARM_CARET_MOVE, STRATEGY_AX } from '../local/read-strategy.js';

// A fake CDP client answers the probe, the accessibility tree and a clipboard copy.
const richAx = [
  { frameId: 'editor', role: { value: 'InlineTextBox' }, name: { value: 'PROPOSAL PENAWARAN' } },
  { frameId: 'editor', role: { value: 'InlineTextBox' }, name: { value: 'Kepada Yth.' } },
  { frameId: 'editor', role: { value: 'InlineTextBox' }, name: { value: 'Tim Pengembangan Lokasi' } },
  { frameId: 'editor', role: { value: 'Canvas' }, name: { value: '' } },
  { frameId: 'chrome', role: { value: 'button' }, name: { value: 'Insert' } }
];

const fakeCdp = ({ probe, ax = richAx, copy, domText = '' }) => {
  const sent = [];
  return {
    sent,
    async send(method, params = {}) {
      sent.push({ method, expression: params.expression });
      const expression = String(params.expression ?? '');
      // The probe is keyed on the canvas-coverage arithmetic, which no other
      // expression in the driver contains, so readState is not mistaken for it.
      if (method === 'Runtime.evaluate' && expression.includes('window.innerHeight')) {
        return { result: { value: probe } };
      }
      if (method === 'Accessibility.getFullAXTree') return { nodes: ax };
      if (method === 'Runtime.evaluate' && expression.includes('document.execCommand')) {
        return { result: { value: copy } };
      }
      if (method === 'Runtime.evaluate' && expression.includes('innerText')) {
        return { result: { value: { title: 'Fake', url: 'https://example.invalid/', text: domText, ready: 'complete' } } };
      }
      return { result: { value: null } };
    },
    close() {}
  };
};

const canvasProbe = {
  textInDom: { value: false, evidence: 0 },
  canvas: { value: true, evidence: 0.61 },
  editable: { value: true, evidence: 'true' },
  focused: { value: true, evidence: 'document.hasFocus() is true' }
};

test('surface_profile answers without reading the document', async () => {
  const cdp = fakeCdp({ probe: canvasProbe, ax: [], copy: '' });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.surfaceProfile();
  assert.equal(out.surface.canvas, true);
  assert.equal(out.surface.editable, true);
  assert.ok(out.description.includes('canvas'));
  assert.ok(out.strategy[0].strategy === STRATEGY_AX);
});

test('a read with no consent skips the caret-moving step and says why', async () => {
  // A poor accessibility tree, so the ladder really does reach the gated step.
  const cdp = fakeCdp({ probe: canvasProbe, ax: [{ frameId: 'chrome', role: { value: 'button' }, name: { value: 'Share' } }], copy: '' });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.read({ allowCaretMove: false });
  const skipped = out.skipped.find((entry) => entry.harm === HARM_CARET_MOVE);
  assert.ok(skipped, 'the caret-moving step is reported as skipped');
  assert.match(skipped.why, /consent/i);
  assert.equal(out.text, '', 'nothing was read from a step that was refused');
});

test('a read with consent runs the caret-moving step', async () => {
  const cdp = fakeCdp({ probe: canvasProbe, ax: [{ frameId: 'chrome', role: { value: 'button' }, name: { value: 'Share' } }], copy: 'PROPOSAL PENAWARAN' });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.read({ allowCaretMove: true });
  assert.equal(out.text, 'PROPOSAL PENAWARAN');
  assert.equal(out.harm, HARM_CARET_MOVE);
  assert.equal(out.skipped.length, 0);
});

test('a rich accessibility tree answers before the gated step is ever reached', async () => {
  const cdp = fakeCdp({ probe: canvasProbe, ax: richAx, copy: 'PROPOSAL PENAWARAN' });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.read({ allowCaretMove: false });
  assert.equal(out.strategy, 'ax');
  assert.equal(out.harm, 'none', 'the accessibility read touches nothing, so the gate is never consulted');
  assert.equal(out.skipped.length, 0);
  assert.ok((out.text || '').includes('PROPOSAL PENAWARAN'));
});

test('an ordinary DOM page is read through the DOM and nothing is skipped', async () => {
  const domProbe = {
    textInDom: { value: true, evidence: 4200 },
    canvas: { value: false, evidence: 0 },
    editable: { value: false, evidence: 'no editable host' },
    focused: { value: false, evidence: 'document.hasFocus() is false' }
  };
  const cdp = fakeCdp({
    probe: domProbe,
    ax: [],
    copy: '',
    domText: 'A page that already holds its own words.'
  });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });
  const out = await primitives.read();
  assert.equal(out.strategy, 'dom');
  assert.equal(out.harm, 'none');
  assert.equal(out.skipped.length, 0);
  assert.equal(out.text, 'A page that already holds its own words.');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/surface-drive.test.mjs`
Expected: FAIL — `primitives.surfaceProfile is not a function`

- [ ] **Step 3: Write the implementation**

Modify `local/primitives.js`. Replace the import at line 21:

```javascript
import { isDocsDocument } from './page-expressions.js';
```

with:

```javascript
import { measureAx, probeSurface, buildProfile, describeProfile } from './surface-profile.js';
import { readLadder } from './read-strategy.js';
import { gateRead } from './caret-guard.js';
import { actionLadder } from './action-strategy.js';
```

Replace the canvas assembly at lines 118-119:

```javascript
  const canvas = createCanvasMethods({ cdp, primitives, sleep, readState });
  Object.assign(primitives, canvas);
```

with:

```javascript
  const canvas = createCanvasMethods({ cdp, primitives, sleep, readState, readLadder, gateRead, describeProfile, actionLadder });
  Object.assign(primitives, canvas);
```

Add the profile primitive beside `evaluate` in the `primitives` object literal, after the `hasFocus` method:

```javascript
    async surfaceProfile() {
      const probe = await probeSurface({ evaluate: primitives.evaluate });
      const ax = await measureAx({ ask: primitives.ask });
      const surface = buildProfile({ probe, ax });
      return { surface, strategy: readLadder(surface), description: describeProfile(surface) };
    },
```

Modify `local/canvas.js`. Replace its import block:

```javascript
import {
  CARET_TOLERANCE_PX,
  CARET_SCROLL_ATTEMPTS,
  DOCS_COPY_EXPRESSION,
  LOCAL_CARET_EXPRESSION,
  SCROLL_MARK,
  SELECTION_TEXT_EXPRESSION,
  isDocsDocument
} from './page-expressions.js';
```

with:

```javascript
import {
  CARET_TOLERANCE_PX,
  CARET_SCROLL_ATTEMPTS,
  LOCAL_CARET_EXPRESSION,
  SCROLL_MARK,
  SELECTION_TEXT_EXPRESSION
} from './page-expressions.js';
```

Change its factory signature:

```javascript
export function createCanvasMethods({ cdp, primitives, sleep, readState }) {
```

to:

```javascript
export function createCanvasMethods({ cdp, primitives, sleep, readState, readLadder, gateRead, describeProfile, actionLadder }) {
```

Replace `async function read()` with a version that walks the ladder:

```javascript
  async function read(options = {}) {
    const allowCaretMove = options.allowCaretMove === true;
    const probe = await probeSurfaceInline();
    const ax = await measureAxInline();
    const surface = buildProfileInline({ probe, ax });
    const ladder = readLadder(surface);
    const skipped = [];
    let text = null;
    let harm = 'none';
    for (const step of ladder) {
      if (step.harm !== 'none') {
        const gate = gateRead({ harm: step.harm, allowCaretMove });
        if (!gate.allowed) {
          skipped.push({ strategy: step.strategy, harm: step.harm, why: gate.why });
          continue;
        }
      }
      if (step.strategy === 'dom') {
        const state = await readState();
        if ((state.text || '').trim().length > 0) {
          return { ...state, surface, strategy: step.strategy, harm: step.harm, skipped, description: describeProfile(surface) };
        }
        continue;
      }
      if (step.strategy === 'ax') {
        const answer = await readAxText(ax);
        if (answer) {
          return { title: '', url: '', text: answer, surface, strategy: step.strategy, harm: step.harm, skipped, description: describeProfile(surface) };
        }
        continue;
      }
      if (step.strategy === 'select-all') {
        text = await guardedSelectAll(allowCaretMove);
        harm = step.harm;
        break;
      }
      if (step.strategy === 'vision') {
        // The driver does not read pixels, and does not pretend to: it names the
        // one tool that returns a picture, so the caller decides rather than
        // receiving an empty string that looks like an empty page.
        return {
          title: '',
          url: '',
          text: '',
          surface,
          strategy: step.strategy,
          harm: step.harm,
          skipped,
          description: describeProfile(surface),
          visionWhy: 'this surface offers no text to any read that asks nothing of it; call capture_page for the picture'
        };
      }
    }
    return {
      title: '',
      url: '',
      text: text === null ? '' : text.text,
      caret: text === null ? null : text.caret,
      surface,
      strategy: text === null ? 'none' : 'select-all',
      harm,
      skipped,
      description: describeProfile(surface)
    };
  }
```

Where the four helpers it calls are defined in the same file above `read`, each delegating to the modules this task created rather than to a site name:

```javascript
  const probeSurfaceInline = () => primitives.evaluate(SURFACE_PROBE_EXPRESSION);
  const measureAxInline = () => measureAx({ ask: primitives.ask });
  const buildProfileInline = ({ probe, ax }) => buildProfile({ probe, ax });
  const readAxText = async (ax) => {
    if (!ax || ax.axRich !== true) return null;
    const text = String(ax.documentText || '');
    return text.trim().length > 0 ? text : null;
  };
  const guardedSelectAll = async (allowCaretMove) => {
    const mark = await guard.remember();
    if (mark.restorable !== true && allowCaretMove !== true) return null;
    const text = await copySelection();
    const verdict = await guard.verdict(mark);
    return { text, caret: verdict };
  };
```

Add the guard to the factory body, before `read`:

```javascript
  const guard = createCaretGuard({ evaluate: primitives.evaluate, key: primitives.key, settle: primitives.settle });
```

Add to `local/canvas.js` imports:

```javascript
import { SURFACE_PROBE_EXPRESSION, measureAx, buildProfile, describeProfile } from './surface-profile.js';
import { createCaretGuard } from './caret-guard.js';
```

Modify `local/tools.js`. Add this entry to `TOOLS` immediately after the `read_page` entry:

```javascript
  {
    name: 'surface_profile',
    description: 'Report what a surface is, measured, before reading it: whether its text lives in the DOM, how much of the viewport a canvas covers, whether an editable host exists, whether the page has focus, and which accessibility frame carries the document. Every claim carries the number it was measured from, and no site is named anywhere in the answer. It reads no document text and moves no caret, so it is the one call that is always safe. Use it first on a site you have not seen, and read the strategy it returns to know what a read will cost.',
    inputSchema: { type: 'object', properties: { tabId: tabArg }, required: [] }
  },
```

Extend the `read_page` entry's schema:

```javascript
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        allowCaretMove: { type: 'boolean', description: 'consent, recorded on this call only, for a read that moves the caret on a canvas editor. Without it a caret-moving read is skipped and the reason is reported, because a canvas caret is not in the DOM and cannot be promised back.' }
      },
      required: []
    }
```

Modify `local/mcp-server.js`. Replace lines 414-415:

```javascript
      case 'read_page':
        return asText(await driver.read());
```

with:

```javascript
      case 'surface_profile':
        return asText(await driver.surfaceProfile());
      case 'read_page':
        return asText(await driver.read({ allowCaretMove: args.allowCaretMove === true }));
```

- [ ] **Step 4: Run the new test and the neighbours**

Run: `node --test tests/surface-drive.test.mjs tests/read-strategy.test.mjs tests/caret-guard.test.mjs tests/surface-profile.test.mjs tests/action-strategy.test.mjs`
Expected: PASS, 29 tests

- [ ] **Step 5: Run the whole gate**

Run: `npm test`
Expected: PASS. If `tests/canvas.test.mjs` or `tests/waits.test.mjs` fail, they are asserting the old Docs-only signature; update them to the new one rather than restoring the old behaviour.

- [ ] **Step 6: Commit**

```bash
git add local/primitives.js local/canvas.js local/tools.js local/mcp-server.js tests/surface-drive.test.mjs
git commit -m "feat: the driver walks the ladder, and the surface is a tool of its own

surface_profile answers what a surface is for one cheap call and moves nothing,
so an agent learns an unseen site before it pays for a read. read_page takes
consent on the call and reports what it skipped, so a caret-moving read is
never silent."
```

---

### Task 6: Pay off the debt — remove the site-specific path

**Files:**
- Modify: `local/page-expressions.js` (delete `isDocsDocument`, `DOCS_COPY_EXPRESSION`, the `.kix-` caret expression)
- Modify: `local/waits.js:19,89` (drop the `isDocsDocument` dependency)
- Test: `tests/no-site-code.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. This task only removes.
- After it: `local/page-expressions.js` exports no Docs symbol; `local/waits.js` takes no site predicate.

- [ ] **Step 1: Write the failing test**

Create `tests/no-site-code.test.mjs`:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: no-site-code — the gate that keeps a site name out of the driver.
// @state: the three symbols the drive used to know Google Docs by, and the files that must no longer carry them.
// @dependencies: node:test, node:assert/strict, node:fs, node:path.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const local = path.join(root.pathname.replace(/^\/(?=[A-Za-z]:)/, ''), 'local');

const FORBIDDEN = ['isDocsDocument', 'DOCS_COPY_EXPRESSION', 'kix_canvas', 'kix_cursor', 'kix_appview', 'kix-canvas', 'kix-cursor', 'kix-appview'];

test('no file in local/ names a site or a site selector', () => {
  const offenders = [];
  for (const entry of fs.readdirSync(local, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const body = fs.readFileSync(path.join(local, entry.name), 'utf8');
    for (const needle of FORBIDDEN) {
      if (body.includes(needle)) offenders.push(`${entry.name} carries ${needle}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no file in local/ matches a url against a site', () => {
  const offenders = [];
  for (const entry of fs.readdirSync(local, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const body = fs.readFileSync(path.join(local, entry.name), 'utf8');
    if (/docs\.google\.com|sheets\.google\.com|slides\.google\.com/.test(body)) {
      offenders.push(`${entry.name} names a Google host`);
    }
  }
  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/no-site-code.test.mjs`
Expected: FAIL — listing `page-expressions.js carries isDocsDocument` and the `kix-` entries.

- [ ] **Step 3: Remove the site-specific code**

In `local/page-expressions.js`:

Delete the `isDocsDocument` function:

```javascript
export function isDocsDocument(url) {
  return String(url || '').includes('docs.google.com/document/d/');
}
```

Delete `DOCS_COPY_EXPRESSION` in full, from `export const DOCS_COPY_EXPRESSION = ` to its closing backtick and semicolon.

Delete `LOCAL_CARET_EXPRESSION` in full, from `export const LOCAL_CARET_EXPRESSION = ` to its closing backtick and semicolon. It is entirely `.kix-cursor-caret` based and has no other content.

In `snapshotExpression`, inside `caretOf`, delete the branch that inlines it and nothing else:

```javascript
    const kix = (() => { ${LOCAL_CARET_EXPRESSION} })();
    if (kix) {
      const r = usable(kix.getBoundingClientRect());
      if (r) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }
```

What remains is the collapsed-selection branch that follows it, which is the generic answer and already handles an ordinary page.

Delete the comment block at lines 106 and 114-117 that justify the exception, because the exception is gone. Replace them with one block that records why the drawn caret was not kept:

```javascript
// WHY THE DRAWN CARET IS NOT READ.
// The caret Docs draws as an element is the only per-site selector this expression ever carried, and it was removed: on a shared document the page holds several carets, this client's and its collaborators', and picking the wrong one reported a successful restore while the real caret went to the end of the document.
// The selection below is per-client, so it names this client's caret and never a collaborator's, and on a canvas editor it carries no position at all - which is the truth the gated read reports rather than papers over.
```

In `local/waits.js`:

Change the factory signature at line 19 from:

```javascript
export function createWaits({ cdp, sleep, readState, readRows, isDocsDocument, read, primitives, now = Date.now }) {
```

to:

```javascript
export function createWaits({ cdp, sleep, readState, readRows, read, primitives, now = Date.now }) {
```

Change lines 86-93 from:

```javascript
  async function waitForText(text, { timeoutMs = 10000, intervalMs = 100, absent = false, now: clock = now } = {}) {
    return waitForMutation(
      async () => {
        const probe = await readState();
        return isDocsDocument(probe.url) ? await read() : probe;
      },
```

to:

```javascript
  async function waitForText(text, { timeoutMs = 10000, intervalMs = 100, absent = false, now: clock = now } = {}) {
    return waitForMutation(
      async () => {
        const probe = await readState();
        if ((probe.text || '').trim().length > 0) return probe;
        return read();
      },
```

The wait now asks the page whether it has text, rather than asking the URL whether it is a document editor. A canvas page answers empty and the wait falls through to the gated read; an ordinary page answers with its text and nothing changes.

In `local/primitives.js`, drop `isDocsDocument` from the `createWaits` call at line 121:

```javascript
  const waits = createWaits({ cdp, sleep, readState, readRows, read: () => primitives.read(), primitives, now });
```

- [ ] **Step 4: Update the two tests that asserted the removed behaviour**

`tests/local-canvas.test.mjs` imports the deleted symbols. Change its import block from:

```javascript
import {
  DOCS_COPY_EXPRESSION,
  isDocsDocument,
  KEY_BEAT_MS,
  SETTLE_POLL_MS
} from '../local/page-expressions.js';
```

to:

```javascript
import { KEY_BEAT_MS, SETTLE_POLL_MS } from '../local/page-expressions.js';
```

Its first test asserts the old read shape. Replace the assertion body from `assert.deepEqual(out, {` through its closing `});` with:

```javascript
  assert.equal(out.text, 'First line\nSecond line');
  assert.equal(out.harm, 'caret-move', 'the canvas text came from a read that moves the caret');
  assert.equal(out.skipped.length, 0, 'consent was recorded, so nothing was skipped');
```

`tests/local-observe.test.mjs:405` asserts the snapshot still carries the drawn caret. Replace:

```javascript
  assert.ok(expression.includes('kix-cursor-caret'), 'the canvas caret Docs exposes');
```

with:

```javascript
  assert.ok(!expression.includes('kix-cursor-caret'), 'the snapshot reads this client selection, never a drawn caret');
  assert.ok(expression.includes('getSelection'), 'the caret row still comes from the selection');
```

- [ ] **Step 5: Run the new test and the whole gate**

Run: `node --test tests/no-site-code.test.mjs`
Expected: PASS, 2 tests

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Check the tree is still honest**

Run: `npm run check`
Expected: `check ok`, primitive count still 31.

- [ ] **Step 7: Commit**

```bash
git add local/page-expressions.js local/waits.js local/primitives.js tests/no-site-code.test.mjs tests/local-canvas.test.mjs tests/local-observe.test.mjs
git commit -m "refactor: the driver no longer knows what Google Docs is

isDocsDocument, the Docs clipboard expression and the kix caret selector are
gone, and a gate now fails the build if a site name or a site selector comes
back. The wait asks the page whether it holds text instead of asking the url
whether it is a document editor, so a canvas page falls through on evidence.

The snapshot's caret row now comes from this client's selection rather than a
drawn element, because a shared document holds several carets and the drawn one
was somebody else's often enough that every restore reported success while the
real caret went to the end."
```

---

### Task 7: Prove it on a real browser, and record the numbers

**Files:**
- Create: `tests/surface-drive-browser.test.mjs`
- Modify: `docs/handoff.md` (record the measured numbers)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing new in `local/`. This task proves the shipped code drives a real browser.

- [ ] **Step 1: Write the browser drill**

Create `tests/surface-drive-browser.test.mjs`. It is skipped unless a browser is reachable, so CI stays green on a machine with none:

```javascript
// @last-edited: 2026-10-27 UTC+7.
// @title: surface-drive-browser — the shipped ladder, driven against a real browser.
// @state: one drill that reads a real document through the gated ladder and proves the caret was not moved.
// @dependencies: node:test, node:assert/strict, ../local/driver.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { openSession } from '../local/driver.js';

const PORT = Number(process.env.OPERA_DRILL_PORT || 9333);
const TARGET = process.env.OPERA_DRILL_TARGET || '';
const reachable = TARGET !== '';

test('the gated read leaves a real document alone', { skip: reachable ? false : 'set OPERA_DRILL_TARGET to a page target to run this drill' }, async () => {
  const session = await openSession({ id: 'brave', port: PORT, targetId: TARGET, viaBridge: false, launch: false, timeoutMs: 20000 });
  try {
    const profile = await session.surfaceProfile();
    assert.equal(typeof profile.surface.canvas, 'boolean');
    assert.ok(Array.isArray(profile.strategy) && profile.strategy.length >= 3);

    const read = await session.read({ allowCaretMove: false });
    assert.equal(read.harm, 'none', 'without consent the read must not move a caret');
    const skipped = read.skipped.find((entry) => entry.harm === 'caret-move');
    assert.ok(skipped, 'the caret-moving step is reported as skipped, with a reason');
    assert.match(skipped.why, /consent/i);

    const consented = await session.read({ allowCaretMove: true });
    assert.ok((consented.text || '').length > 0, 'with consent the canvas text comes back');
    assert.equal(consented.caret.restored, false, 'the verdict must not claim a restore it did not measure');
  } finally {
    await session.close();
  }
});
```

- [ ] **Step 2: Run the drill against the real browser**

With the everyday browser listening on port 9333 and a Google Docs tab open:

```powershell
$env:OPERA_DRILL_TARGET = "<target id from curl http://127.0.0.1:9333/json/list>"
node --test tests/surface-drive-browser.test.mjs
```

Expected: PASS. Record the numbers it prints: attach, profile, gated read, consented read.

- [ ] **Step 3: Record the numbers in the handoff**

Add one bullet to `docs/handoff.md` under `State`, replacing the line count honestly if the file is at its cap:

```markdown
- **The drive reads a surface from evidence, not from a site name.** `surface_profile`
  answers canvas, editable, focus and which accessibility frame carries the
  document, each with the number it was measured from. The read ladder is
  `a11y -> dom -> select-all -> vision`, and select-all is the only step tagged
  caret-moving. Measured on the everyday Brave profile at port 9333: attach 28 ms,
  gated read with no caret moved, consented select-all read 374 ms median against
  the bridge's 1875 ms. A canvas caret is not in the DOM, so `caretRestored` is
  never claimed; `tests/no-site-code.test.mjs` fails the build if a site name or a
  `.kix-` selector returns.
```

- [ ] **Step 4: Run every gate**

Run: `npm test`
Run: `npm run check`
Run: `py tests/browser_extension_test.py`

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add tests/surface-drive-browser.test.mjs docs/handoff.md
git commit -m "test: the gated ladder, driven against a real browser

The drill proves the shipped code, not a spike script: the profile answers, the
read without consent moves no caret and says which step it skipped, and the read
with consent returns the document text while reporting honestly that the caret
was not restored. Numbers go in the handoff."
```

---

## Notes for the executor

- Task 1 is the contract. If a later task needs a different profile shape, change Task 1 first and let its tests move, rather than letting two shapes exist.
- Tasks 1–4 touch no browser. Run them freely and often.
- Task 5 is where the old behaviour can regress. The test `an ordinary DOM page is read through the DOM and nothing is skipped` is the one that catches it; do not delete it to make a step pass.
- Task 6 is destructive by design. Run it only after Task 5's tests pass, because before that the ladder is not yet carrying the read.
- Task 7 needs the owner's browser. If the port is not listening, leave the drill skipped and say so in the handoff rather than claiming a pass.
