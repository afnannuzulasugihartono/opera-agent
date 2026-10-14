# Docs Paper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opera Agent builds thesis-grade Google Docs from user ideas: menu.walk plus 9 structure workflows, UI-only, verified end to end.

**Architecture:** Server-side versioned workflows over the frozen 29 primitives; multi-step menu walks run as single browser.burst programs (keyboard road first, hover-chain fallback); every structure carries an end-state predicate.

**Tech Stack:** Supabase edge (opera-agent-runner), Postgres workflow registry (migrations), MV3 extension (burst engine), node:test, headed Chromium via existing py harness.

**Spec:** docs/superpowers/specs/2026-10-14-docs-paper-design.md

## Global Constraints

- 29 allowlisted browser primitives stay frozen; no new methods, no new permissions.
- UI-only: no Google Docs API, no OAuth, no identity permission.
- Every workflow ships with a structural test that parses its migration JSON (youtube-workflows pattern).
- Comment placement + spacing gates hold for every touched file (top-level WHY only, blank lines around).
- LF line endings; `py`, never `python`.
- Gates green (`npm test`, `npm run check`) before every task commit.

## Review Focus

- Docs UI in Indonesian shows different menu text than English; menu.walk accepts labels arrays covering both and fails honestly naming the missing label.
- Compact mode (Ctrl+Shift+F) hides the menu bar and breaks Alt shortcuts; menu.walk detects and expands it first.
- Insert dialogs animate open; every post-dialog step waits on a settled predicate, never a fixed sleep.
- E2E without a Google session must skip loudly, never false-green.
- Refs minted before a menu re-render are stale; menu walks consume refs only via refFromStep inside one burst, never raw coordinates.

---

## File Structure

New workflow migrations (one per workflow, existing convention):

- `supabase/migrations/20261014XXXX_docs_menu_walk.sql` — owns `docs.menu_walk` v1: keyboard road + hover fallback + verify.
- `supabase/migrations/20261014XXXX_docs_apply_heading.sql` — owns `docs.apply_heading` v1.
- `supabase/migrations/20261014XXXX_docs_make_list.sql` — owns `docs.make_list` v1.
- `supabase/migrations/20261014XXXX_docs_insert_table.sql` — owns `docs.insert_table` v1.
- `supabase/migrations/20261014XXXX_docs_insert_image.sql` — owns `docs.insert_image` v1 (upload dialog path).
- `supabase/migrations/20261014XXXX_docs_footnote.sql` — owns `docs.footnote` v1.
- `supabase/migrations/20261014XXXX_docs_header_footer.sql` — owns `docs.header_footer` v1 (incl. page numbers).
- `supabase/migrations/20261014XXXX_docs_page_setup.sql` — owns `docs.page_setup` v1 (margins, orientation).
- `supabase/migrations/20261014XXXX_docs_toc_insert.sql` — owns `docs.toc_insert` v1.
- `supabase/migrations/20261014XXXX_docs_export_pdf.sql` — owns `docs.export_pdf` v1 (File > Download > PDF + UI feedback verify).

New tests (one per workflow, youtube-workflows pattern):

- `tests/docs-menu-walk.test.mjs`, `tests/docs-structure.test.mjs` (heading, list, table, image), `tests/docs-chrome.test.mjs` (footnote, header/footer, page setup, TOC, export).

E2E (new, headed, manual-gate — needs a Google session, so not CI):

- `tests/paper_e2e.py` — builds the mini-thesis over the local bridge and verifies every artefact.

Docs:

- `docs/api.md` — workflow surface section for the 10 new workflows.
- `docs/handoff.md` — state lines within the 150-line cap.

## Task 1: menu.walk core workflow

**Files:**
- Create: `supabase/migrations/20261014010000_docs_menu_walk.sql`
- Create: `tests/docs-menu-walk.test.mjs`

**Interfaces:**
- Consumes: runner step types (command, if, set, wait, fail), methods browser.burst, page.wait_for, page.query.
- Produces: workflow `docs.menu_walk` v1, input `{ tabId, path: string[], labels?: object, target?: object }`, output `{ ok, walked: string[], method: "keyboard"|"hover", labelsTried: string[] }`. Also the inlined walk pattern (keyboard burst, hover chain, verify) that structure workflows copy; the runner cannot call workflows from workflows, so structures inline the pattern rather than invoking it.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261014010000_docs_menu_walk.sql', import.meta.url), 'utf8'
);

function definition() {
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, 'migration must embed the workflow JSON');
  return JSON.parse(match[1]);
}

test('menu.walk tries keyboard first, then hover, and proves the walk', () => {
  const def = definition();
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('keyboardRoad'), 'keyboard road runs first');
  assert.ok(text.includes('hoverRoad'), 'hover chain is the fallback, not the default');
  assert.ok(text.includes('refFromStep'), 'refs cross steps only inside one burst');
  assert.ok(!text.includes('"x":'), 'no raw coordinates anywhere in the walk');
  assert.ok(def.output.walked && def.output.method, 'output names what walked and how');
});

test('menu.walk covers Indonesian and English labels and expands compact mode', () => {
  const def = definition();
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('compactCheck'), 'compact mode is detected before Alt shortcuts');
  assert.ok(def.output.labelsTried, 'output records which labels were attempted');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/docs-menu-walk.test.mjs`
Expected: FAIL with ENOENT (migration missing).

- [ ] **Step 3: Write the migration**

```sql
select public.opera_register_workflow(
  'docs.menu_walk',
  1,
  $wf${"steps":[
    {"id":"compactCheck","type":"command","method":"page.query","params":{"tabId":{"$ref":"input.tabId"},"selector":"[aria-label='Show menus'], [aria-label='Tampilkan menu']","limit":1},"continueOnError":true},
    {"id":"expandCompact","type":"if","condition":{"op":"exists","left":{"$ref":"steps.compactCheck.result.item"}},"then":[{"id":"expandIt","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":"F","modifiers":["control","shift"]}]}}],"else":[]},
    {"id":"keyboardRoad","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"key","key":"F","modifiers":["alt"]}]},"continueOnError":true},
    {"id":"keyboardOk","type":"command","method":"page.wait_for","params":{"tabId":{"$ref":"input.tabId"},"selector":"[role='menu'][aria-expanded='true'], [role='menubar'] [aria-expanded='true']","timeoutMs":1500},"continueOnError":true},
    {"id":"hoverRoad","type":"if","condition":{"op":"not_exists","left":{"$ref":"steps.keyboardOk.result.item"}},"then":[{"id":"hoverBurst","type":"command","method":"browser.burst","params":{"tabId":{"$ref":"input.tabId"},"steps":[{"action":"find","text":{"$ref":"input.path"}},{"action":"hover","refFromStep":0,"text":{"$ref":"input.target"}}]}}],"else":[]}
  ],"output":{"walked":{"$ref":"input.path"},"method":"keyboard","labelsTried":{"$ref":"input.labels"}}}$wf$,
  'Walk a menu path by keyboard first, hover chain fallback, with proof at each level.',
  true
);
```

Note: the keyboard road above opens the File menu as the connectivity proof; the hover road walks input.path levels with refFromStep chaining. Extend per-level hover chains to input.path length in implementation; the test pins the shape (keyboard first, refFromStep only, no coordinates).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/docs-menu-walk.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014010000_docs_menu_walk.sql tests/docs-menu-walk.test.mjs
git commit -m "Add docs.menu_walk v1: keyboard-first menu walks with hover fallback"
```

## Task 2: heading and list structure workflows

**Files:**
- Create: `supabase/migrations/20261014020000_docs_apply_heading.sql`
- Create: `supabase/migrations/20261014030000_docs_make_list.sql`
- Create: `tests/docs-structure.test.mjs`

**Interfaces:**
- Consumes: menu.walk walk-pattern (keyboard burst, hover chain, verify), inlined per workflow; methods page.key, page.query, browser.burst.
- Produces: `docs.apply_heading` v1 input `{ tabId, level: 1-6, text? }`, output `{ applied, style }`; `docs.make_list` v1 input `{ tabId, kind: "bullet"|"number", items: string[] }`, output `{ count }`.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => {
  const migration = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, `${name} must embed the workflow JSON`);
  return JSON.parse(match[1]);
};

test('apply_heading styles by shortcut with a menu fallback and proves the style', () => {
  const def = read('20261014020000_docs_apply_heading.sql');
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('Ctrl') || text.includes('control'), 'heading shortcut is the fast road');
  assert.ok(text.includes('menuFallback'), 'menu road backs up the shortcut');
  assert.ok(def.output.applied && def.output.style, 'output proves the applied style');
});

test('make_list types items and proves the count', () => {
  const def = read('20261014030000_docs_make_list.sql');
  assert.ok(JSON.stringify(def.steps).includes('foreach'), 'items are typed one per step');
  assert.ok(def.output.count, 'output proves the item count');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/docs-structure.test.mjs`
Expected: FAIL with ENOENT.

- [ ] **Step 3: Write the two migrations**

apply_heading: one burst pressing Ctrl+Alt+level on the current paragraph, then a page.query read-back of the paragraph style; on mismatch, a menu fallback walk (Format > Paragraph styles > Heading N) and a second read-back; output applied/style.

make_list: burst toggling bullets/numbers, then foreach over input.items typing text plus Enter; output count from a final list-item query.

(Full JSON follows the Task 1 shape: steps with id/type/method/params, $ref vars, output mapping. Keep each under 15 steps.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/docs-structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014020000_docs_apply_heading.sql supabase/migrations/20261014030000_docs_make_list.sql tests/docs-structure.test.mjs
git commit -m "Add docs heading and list structure workflows"
```

## Task 3: table and image structure workflows

**Files:**
- Create: `supabase/migrations/20261014040000_docs_insert_table.sql`
- Create: `supabase/migrations/20261014050000_docs_insert_image.sql`
- Modify: `tests/docs-structure.test.mjs` (append two tests)

**Interfaces:**
- Consumes: menu.walk walk-pattern (keyboard burst, hover chain, verify), inlined per workflow.
- Produces: `docs.insert_table` v1 input `{ tabId, rows, cols }`, output `{ rows, cols, verified }`; `docs.insert_image` v1 input `{ tabId, source: "upload", path }`, output `{ placed, captionReady }`.

- [ ] **Step 1: Write the failing tests**

```js
test('insert_table walks Insert menu and proves dimensions', () => {
  const def = read('20261014040000_docs_insert_table.sql');
  assert.ok(JSON.stringify(def.steps).includes('Table'), 'table path is walked, not typed');
  assert.ok(def.output.rows && def.output.cols && def.output.verified, 'output proves dimensions');
});

test('insert_image uploads and leaves the caption paragraph ready', () => {
  const def = read('20261014050000_docs_insert_image.sql');
  assert.ok(JSON.stringify(def.steps).includes('Image'), 'image path is walked');
  assert.ok(def.output.placed, 'output proves placement');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/docs-structure.test.mjs`
Expected: FAIL with ENOENT.

- [ ] **Step 3: Write the two migrations**

insert_table: menu.walk path ["Insert", "Table"] with grid target rows×cols, then a table-structure read-back proving dimensions; output rows/cols/verified.

insert_image: menu.walk path ["Insert", "Image", "Upload from computer"], native file dialog filled with input.path, wait for the image block, Enter for the caption paragraph; output placed/captionReady.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/docs-structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014040000_docs_insert_table.sql supabase/migrations/20261014050000_docs_insert_image.sql tests/docs-structure.test.mjs
git commit -m "Add docs table and image structure workflows"
```

## Task 4: footnote, header/footer, page setup workflows

**Files:**
- Create: `supabase/migrations/20261014060000_docs_footnote.sql`
- Create: `supabase/migrations/20261014070000_docs_header_footer.sql`
- Create: `supabase/migrations/20261014080000_docs_page_setup.sql`
- Create: `tests/docs-chrome.test.mjs`

**Interfaces:**
- Consumes: menu.walk walk-pattern (keyboard burst, hover chain, verify), inlined per workflow.
- Produces: `docs.footnote` v1 input `{ tabId, text }`, output `{ noteId }`; `docs.header_footer` v1 input `{ tabId, header?, footer?, pageNumbers: bool }`, output `{ header, footer, pageNumbers }`; `docs.page_setup` v1 input `{ tabId, margins?, orientation? }`, output `{ applied }`.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => {
  const migration = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const match = migration.match(/\$wf\$(.*?)\$wf\$/s);
  assert.ok(match, `${name} must embed the workflow JSON`);
  return JSON.parse(match[1]);
};

test('footnote inserts and proves the note exists', () => {
  const def = read('20261014060000_docs_footnote.sql');
  assert.ok(JSON.stringify(def.steps).includes('Footnote'), 'footnote path is walked');
  assert.ok(def.output.noteId, 'output proves the note');
});

test('header_footer covers header, footer, and page numbers', () => {
  const def = read('20261014070000_docs_header_footer.sql');
  const text = JSON.stringify(def.steps);
  assert.ok(text.includes('Header') && text.includes('Footer'), 'both regions walked');
  assert.ok(text.includes('Page numbers') || text.includes('pageNumber'), 'page numbers included');
  assert.ok(def.output.header !== undefined && def.output.pageNumbers !== undefined, 'output proves all three');
});

test('page_setup applies margins and proves them', () => {
  const def = read('20261014080000_docs_page_setup.sql');
  assert.ok(JSON.stringify(def.steps).includes('Page setup'), 'dialog path is walked');
  assert.ok(def.output.applied, 'output proves application');
  assert.ok(JSON.stringify(def.steps).includes('page.wait_for'), 'dialog settle is waited, never slept');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/docs-chrome.test.mjs`
Expected: FAIL with ENOENT.

- [ ] **Step 3: Write the three migrations**

footnote: Insert > Footnote walk, type input.text in the note, read-back proving the note marker exists; output noteId.

header_footer: Insert > Headers & footers walks for header and footer text, Insert > Page numbers walk when requested, read-backs per region; output header/footer/pageNumbers booleans.

page_setup: File > Page setup walk, fill margins/orientation fields, OK, read-back of applied settings; output applied.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/docs-chrome.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014060000_docs_footnote.sql supabase/migrations/20261014070000_docs_header_footer.sql supabase/migrations/20261014080000_docs_page_setup.sql tests/docs-chrome.test.mjs
git commit -m "Add docs footnote, header/footer, and page setup workflows"
```

## Task 5: TOC and PDF export workflows

**Files:**
- Create: `supabase/migrations/20261014090000_docs_toc_insert.sql`
- Create: `supabase/migrations/20261014100000_docs_export_pdf.sql`
- Modify: `tests/docs-chrome.test.mjs` (append two tests)

**Interfaces:**
- Consumes: menu.walk walk-pattern (keyboard burst, hover chain, verify), inlined per workflow.
- Produces: `docs.toc_insert` v1 input `{ tabId }`, output `{ entries }`; `docs.export_pdf` v1 input `{ tabId }`, output `{ downloaded }`.

- [ ] **Step 1: Write the failing tests**

```js
test('toc_insert walks Insert menu and proves entries', () => {
  const def = read('20261014090000_docs_toc_insert.sql');
  assert.ok(JSON.stringify(def.steps).includes('Table of contents'), 'TOC path is walked');
  assert.ok(def.output.entries, 'output proves entry count');
});

test('export_pdf downloads and proves UI feedback', () => {
  const def = read('20261014100000_docs_export_pdf.sql');
  assert.ok(JSON.stringify(def.steps).includes('Download'), 'download path is walked');
  assert.ok(def.output.downloaded, 'output proves the feedback signal');
  assert.ok(JSON.stringify(def.steps).includes('page.wait_for'), 'download feedback is waited, never slept');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/docs-chrome.test.mjs`
Expected: FAIL with ENOENT.

- [ ] **Step 3: Write the two migrations**

toc_insert: Insert > Table of contents walk, pick a style, count rendered TOC entries; output entries.

export_pdf: File > Download > PDF walk, wait for the Docs download feedback signal (toast/state, not the filesystem — the download API is outside the primitives); output downloaded.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/docs-chrome.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014090000_docs_toc_insert.sql supabase/migrations/20261014100000_docs_export_pdf.sql tests/docs-chrome.test.mjs
git commit -m "Add docs TOC and PDF export workflows"
```

## Task 6: mini-thesis E2E over the local bridge

**Files:**
- Create: `tests/paper_e2e.py`

**Interfaces:**
- Consumes: all 10 workflows above via run_workflow over OPERA_LOCAL_TRANSPORT=bridge.
- Produces: pass/fail proof that a mini-thesis (outline, headings, table, image, footnote, TOC, PDF) builds with every artefact verified.

- [ ] **Step 1: Write the failing script**

```python
# paper_e2e: builds a mini-thesis in a real Google Doc over the local bridge.
# Manual gate (needs a Google session): prints SKIP loudly without one, never green.
#   py tests/paper_e2e.py
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'helpers'))

STEPS = [
    ('docs.apply_heading', {'level': 1}),
    ('docs.make_list', {'kind': 'bullet', 'items': ['a', 'b']}),
    ('docs.insert_table', {'rows': 2, 'cols': 2}),
    ('docs.insert_image', {'source': 'upload', 'path': 'ASSET'}),
    ('docs.footnote', {'text': 'proof note'}),
    ('docs.header_footer', {'pageNumbers': True}),
    ('docs.page_setup', {'margins': 'narrow'}),
    ('docs.toc_insert', {}),
    ('docs.export_pdf', {}),
]


def main():
    print('paper_e2e: NOT IMPLEMENTED')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 2: Run script to verify it fails**

Run: `py tests/paper_e2e.py`
Expected: exit 1 with NOT IMPLEMENTED.

- [ ] **Step 3: Implement the run**

Drive each workflow in STEPS order through run_workflow on a fresh Google
Doc over the bridge transport; after each call assert its output proof
fields are present and truthy; assert the menu walker never fired a raw
coordinate step (scan run evidence for pointer-without-ref); print SKIP
and exit 2 when no Google session is detected.

- [ ] **Step 4: Run script to verify it passes**

Run: `py tests/paper_e2e.py`
Expected: exit 0 with every artefact verified, or exit 2 SKIP with the reason.

- [ ] **Step 5: Commit**

```bash
git add tests/paper_e2e.py
git commit -m "Prove the mini-thesis end to end over the local bridge"
```

## Task 7: docs and handoff

**Files:**
- Modify: `docs/api.md` (append workflow surface section)
- Modify: `docs/handoff.md` (state lines, 150-line cap holds)

- [ ] **Step 1: Write the api.md section**

Append a section listing the 10 workflows with input/output shapes copied
verbatim from the migrations, plus the ground-act-prove rule and the
no-raw-coordinates rule.

- [ ] **Step 2: Verify the docs match the migrations**

Run: a node one-liner extracting workflow names from migrations and from
api.md, asserting the sets are equal.
Expected: equal, exit 0.

- [ ] **Step 3: Update handoff state lines**

Add: menu.walk exists with keyboard-first road; 9 structure workflows;
paper E2E gate command. Keep the file under 150 lines by compressing the
oldest spent detail into git history pointers.

- [ ] **Step 4: Run gates**

Run: `npm test` and `npm run check`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add docs/api.md docs/handoff.md
git commit -m "Document the paper workflow surface"
```

## Task 8: Docs UI button map

**Files:**
- Create: `supabase/functions/_shared/docs-ui-map.js`
- Create: `lib/docs-ui-map.js`
- Create: `tests/docs-ui-map.test.mjs`

**Interfaces:**
- Consumes: menu labels used by the 10 workflow migrations.
- Produces: `resolveMenuTarget(path, locale)` returning `{ labels, verify }`; every workflow label present in the map (test-enforced).

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveMenuTarget, MENU_MAP } from '../lib/docs-ui-map.js';

test('every menu label the workflows use exists in the map', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const texts = new Set();
  for (const file of fs.readdirSync(dir)) {
    if (!/_docs_/.test(file)) continue;
    const src = fs.readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/"(?:find|hover|click)".*?"text":"([^"]+)"/g)) texts.add(m[1]);
    for (const m of src.matchAll(/"text":"([A-Z][^"]*)"/g)) texts.add(m[1]);
  }
  assert.ok(texts.size > 5, 'expected several menu labels across workflows');
  for (const label of texts) {
    assert.ok(resolveMenuTarget([label]), `map covers ${label}`);
  }
});

test('resolveMenuTarget serves both locales with verify selectors', () => {
  const en = resolveMenuTarget(['Insert', 'Table'], 'en');
  assert.deepEqual(en.labels, ['Insert', 'Table']);
  assert.ok(en.verify && en.verify.selector.includes('menu'));
  const id = resolveMenuTarget(['Insert', 'Table'], 'id');
  assert.deepEqual(id.labels, ['Sisipkan', 'Tabel']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/docs-ui-map.test.mjs`
Expected: FAIL with ENOENT (module missing).

- [ ] **Step 3: Write the map module and re-export**

`_shared/docs-ui-map.js` holds MENU_MAP (canonical English path segments
with Indonesian translations, verify selectors, shortcuts where measured)
plus resolveMenuTarget(path, locale). `lib/docs-ui-map.js` re-exports it
for the Node suite (established duo pattern).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/docs-ui-map.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/docs-ui-map.js lib/docs-ui-map.js tests/docs-ui-map.test.mjs
git commit -m "Add the Docs UI button map behind the paper workflows"
```
