# Docs Paper Implementation Plan

> **State: eight of the nine tasks shipped. One remains, and it needs a live Google session.**

**Goal:** Opera Agent builds thesis-grade Google Docs from user ideas: menu.walk plus 9 structure workflows, UI-only, verified end to end.

**Architecture:** Server-side versioned workflows over the frozen primitives; multi-step menu walks run as single browser.burst programs (keyboard road first, hover-chain fallback); every structure carries an end-state predicate.

**Spec:** docs/superpowers/specs/2026-10-14-docs-paper-design.md

## What shipped

The ten workflow migrations, their tests, the E2E harness and the UI label map are in the tree.

- `supabase/migrations/20261014010000_docs_menu_walk.sql` — `docs.menu_walk` v1: keyboard road, hover fallback, verify at each level.
- `supabase/migrations/20261014020000_docs_apply_heading.sql` and `20261014030000_docs_make_list.sql` — heading and list.
- `supabase/migrations/20261014040000_docs_insert_table.sql` and `20261014050000_docs_insert_image.sql` — table and image.
- `supabase/migrations/20261014060000_docs_footnote.sql`, `20261014070000_docs_header_footer.sql` and `20261014080000_docs_page_setup.sql` — footnote, header/footer, page setup.
- `supabase/migrations/20261014090000_docs_toc_insert.sql` and `20261014100000_docs_export_pdf.sql` — table of contents and PDF export.
- `tests/docs-menu-walk.test.mjs`, `tests/docs-structure.test.mjs`, `tests/docs-chrome.test.mjs` — one structural test per workflow family, parsing the migration JSON.
- `tests/paper_e2e.py` — the mini-thesis E2E over the local bridge.
- `supabase/functions/_shared/docs-ui-map.js` with `lib/docs-ui-map.js` — the Docs menu labels in both locales.

## Global Constraints

- The allowlisted browser primitives stay frozen; no new methods, no new permissions.
- UI-only: no Google Docs API, no OAuth, no identity permission.
- Every workflow ships with a structural test that parses its migration JSON.
- Gates green (`npm test`, `npm run check`) before every commit.

## Review Focus

- Docs UI in Indonesian shows different menu text than English; menu.walk accepts labels arrays covering both and fails honestly naming the missing label.
- Compact mode (Ctrl+Shift+F) hides the menu bar and breaks Alt shortcuts; menu.walk detects and expands it first.
- Insert dialogs animate open; every post-dialog step waits on a settled predicate, never a fixed sleep.
- E2E without a Google session must skip loudly, never false-green.
- Refs minted before a menu re-render are stale; menu walks consume refs only via refFromStep inside one burst, never raw coordinates.

---

## Task 9: AX road integration and spec-driven E2E

**Files:**
- Modify: `tests/paper_e2e.py` (read a docplan spec, drive blocks through workflows)
- Modify: `tests/docs-ui-map.test.mjs` (ax-menu row names match map labels)
- Create: `tests/fixtures/mini-thesis.spec.json` (docplan-format mini thesis)

**Interfaces:**
- Consumes: docplan spec block kinds (title, subtitle, body, table, image); ax-menu row-name reads over bridge CDP.
- Produces: E2E input as data (not hardcoded STEPS); proof that live AX row names equal map labels.

**Why it is still open:** the comparison is a live read of a Google Docs menu against the label map, so it needs a signed-in session and a headed browser. Nothing else in the plan is blocked.

- [ ] **Step 1: Write the failing tests**

```js
test('live AX menu rows use the mapped English labels', async () => {
  // Manual gate: needs the bridge up with a Docs tab. Asserts the AX road
  // reads the same row names the map carries, so the two roads agree.
});
```

```python
# paper_e2e reads tests/fixtures/mini-thesis.spec.json (blocks) instead of
# hardcoded STEPS; unknown block kinds fail loudly naming the kind.
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/docs-ui-map.test.mjs` (new test fails: no AX comparison yet); `py tests/paper_e2e.py` (fails: no fixture).
Expected: FAIL, missing pieces named.

- [ ] **Step 3: Implement**

Add the mini-thesis fixture (one block per structure kind), teach
paper_e2e to map kinds to workflow calls, and assert live AX row names
against map labels for the walked menus.

- [ ] **Step 4: Run to verify**

Run: `node --test tests/docs-ui-map.test.mjs` and `py tests/paper_e2e.py`
Expected: PASS (or loud SKIP without a Google session).

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/mini-thesis.spec.json tests/paper_e2e.py tests/docs-ui-map.test.mjs
git commit -m "Drive E2E from a docplan spec and lock AX rows to the map"
```
