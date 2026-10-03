// U-P1 Layer B (research P1, 2026-09-20): bounded, value-free accessibility
// tree summary for semantically poor surfaces (canvas applications, hidden
// DOM mirrors). The raw CDP Accessibility.getFullAXTree output is filtered by
// this pure module before it is attached to a page.read result as
// `page.axSummary`. Entries are read-only {role, name} facts: they are not
// element refs and cannot be clicked directly.
//
// Safety invariants (regression-locked in tests/ax-observation.test.mjs):
// - AX node `value` fields are dropped unconditionally: CDP exposes input
//   values (including unmasked non-password field content), and model-facing
//   observations must never carry field values.
// - Editable roles and their descendants are excluded entirely: CDP repeats
//   editable values as descendant StaticText names, so exclusion must close
//   over the parentId chain.
// - Pseudo-nodes (InlineTextBox), ignored nodes, and the RootWebArea page
//   title are dropped; the result is deduped and capped.

export const AX_SUMMARY_LIMITS = Object.freeze({
  maxEntries: 60,
  maxNameChars: 200
});

// WHY 'generic' is not skipped outright: canvas and SPA surfaces label their
// controls as generic, so dropping every generic node threw away the only named
// thing such a page exposes. A generic node WITH a name is still information; an
// unnamed one is noise and is dropped below by the empty-name check, which is
// also where RootWebArea-only noise ends up.
const SKIP_ROLES = new Set(['RootWebArea', 'InlineTextBox', 'none', 'presentation']);
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox', 'entry']);

function roleOf(node) {
  return String(node?.role?.value ?? '').trim();
}

function nameOf(node) {
  return String(node?.name?.value ?? '').trim().slice(0, AX_SUMMARY_LIMITS.maxNameChars);
}

function hasValue(node) {
  const value = node?.value?.value;
  return value !== undefined && value !== null && String(value).length > 0;
}

export function buildAxSummary(nodes, options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : AX_SUMMARY_LIMITS.maxEntries;
  const list = Array.isArray(nodes) ? nodes : [];
  const byId = new Map();
  for (const node of list) {
    if (node && node.nodeId != null) byId.set(String(node.nodeId), node);
  }

  // Memoized closure over parentId chains: an editable node excludes itself
  // and every descendant (CDP mirrors editable values as child StaticText).
  const exclusionMemo = new Map();
  const isExcluded = (id) => {
    if (exclusionMemo.has(id)) return exclusionMemo.get(id);
    exclusionMemo.set(id, false);
    const node = byId.get(id);
    if (!node) return false;
    let excluded = hasValue(node) || EDITABLE_ROLES.has(roleOf(node));
    if (!excluded && node.parentId != null) excluded = isExcluded(String(node.parentId));
    exclusionMemo.set(id, excluded);
    return excluded;
  };

  const items = [];
  const seen = new Set();
  for (const node of list) {
    if (!node || node.ignored) continue;
    if (node.nodeId != null && isExcluded(String(node.nodeId))) continue;
    const role = roleOf(node);
    if (SKIP_ROLES.has(role)) continue;
    // Only DOM-backed nodes carry backendDOMNodeId; pseudo-nodes duplicate
    // text already represented by their StaticText parent.
    if (node.backendDOMNodeId == null) continue;
    const name = nameOf(node);
    if (!name) continue;
    const key = `${role}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ role, name });
    if (items.length >= maxEntries) break;
  }

  return {
    source: 'cdp-ax',
    note: 'Read-only accessibility snapshot for a semantically poor surface. Entries are not element refs and cannot be clicked directly.',
    items
  };
}
