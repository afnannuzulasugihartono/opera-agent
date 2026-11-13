// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: ax-summary — the bounded accessibility-tree filter behind page.axSummary.
// @state: exports AX_SUMMARY_LIMITS and buildAxSummary; drops value fields and whole editable subtrees so results carry only read-only role/name facts.
// @dependencies: none.

// Bounded, value-free accessibility tree summary for semantically poor surfaces (canvas applications, hidden DOM mirrors).
// The raw CDP Accessibility.getFullAXTree output is filtered by this pure module before it is attached to a page.read result as `page.axSummary`.
// Entries are read-only {role, name} facts: they are not element refs and cannot be clicked directly.

// Safety invariants (regression-locked in tests/extension/ax-observation.test.mjs):
// - AX node `value` fields are dropped unconditionally: CDP exposes input values (including unmasked non-password field content), and model-facing observations must never carry field values.
// - Editable roles and their descendants are excluded entirely: CDP repeats editable values as descendant StaticText names, so exclusion must close over the parentId chain.
// - Pseudo-nodes (InlineTextBox), ignored nodes, and the RootWebArea page title are dropped; the result is deduped and capped.

export const AX_SUMMARY_LIMITS = Object.freeze({
  maxEntries: 60,
  maxNameChars: 200
});

const SKIP_ROLES = new Set(['RootWebArea', 'InlineTextBox', 'none', 'presentation']);
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox', 'entry']);

interface AxNode {
  nodeId?: unknown;
  ignored?: boolean | undefined;
  role?: { value?: unknown } | undefined;
  name?: { value?: unknown } | undefined;
  value?: { value?: unknown } | undefined;
  parentId?: unknown;
  backendDOMNodeId?: unknown;
}

function roleOf(node: AxNode | undefined) {
  return String(node?.role?.value ?? '').trim();
}

function nameOf(node: AxNode | undefined) {
  return String(node?.name?.value ?? '').trim().slice(0, AX_SUMMARY_LIMITS.maxNameChars);
}

function hasValue(node: AxNode | undefined) {
  const value = node?.value?.value;
  return value !== undefined && value !== null && String(value).length > 0;
}

export function buildAxSummary(nodes: AxNode[] | undefined, options: { maxEntries?: number } = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) && typeof options.maxEntries === 'number' && options.maxEntries > 0
    ? options.maxEntries
    : AX_SUMMARY_LIMITS.maxEntries;
  const list = Array.isArray(nodes) ? nodes : [];
  const byId = new Map<string, AxNode | undefined>();
  for (const node of list) {
    if (node && node.nodeId != null) byId.set(String(node.nodeId), node);
  }

  const exclusionMemo = new Map<string, boolean | undefined>();
  const isExcluded = (id: string): boolean => {
    if (exclusionMemo.has(id)) return exclusionMemo.get(id) ?? false;
    exclusionMemo.set(id, false);
    const node = byId.get(id);
    if (!node) return false;
    let excluded = hasValue(node) || EDITABLE_ROLES.has(roleOf(node));
    if (!excluded && node.parentId != null) excluded = isExcluded(String(node.parentId));
    exclusionMemo.set(id, excluded);
    return excluded;
  };

  const items: Array<{ role: string; name: string }> = [];
  const seen = new Set<string>();
  for (const node of list) {
    if (!node || node.ignored) continue;
    if (node.nodeId != null && isExcluded(String(node.nodeId))) continue;
    const role = roleOf(node);
    if (SKIP_ROLES.has(role)) continue;

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
    note: 'Read-only accessibility snapshot for a semantically poor surface. Entries are not element refs and cannot be clicked directly. This page has almost no named controls, so use page.capture and act with page.pointer coordinates instead of looking for refs.',
    items
  };
}
