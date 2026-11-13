// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: role-reconcile — role reconciliation, as a classic content script.
// @state: hygiene pass over this file.
// @dependencies: none.

// Role reconciliation, as a classic content script.

// This file is loaded by the manifest BEFORE content.js and publishes its pure helpers on globalThis, exactly like semantic-identity.js and semantic-views.js.
// Content scripts are classic scripts and cannot use ES imports, so the same pattern is used here rather than duplicating the logic inline or adding a second, drifting copy.
// It stays importable in Node for tests via import-for-side-effect, the same way the semantic engines are tested.

// Why this exists.
// `serialize()` read the role straight off the DOM attribute: `role: clean(el.getAttribute('role'), 80)`.
// A plain <button>Send</button> therefore reported `role: ''`, and any control the author did not annotate was invisible to a role-filtered find_elements.
// That is not a Google Docs quirk, it is most of the web — and it is why the Page numbers dialog reported `Footer` and `Show on first page` as text but never as a radio or a checkbox.

// Two layers, deliberately separated:

// 1. IMPLICIT ROLE.
//    Derive the role the platform would report from the element's own tag, type, href, and contenteditable state.
//    This needs no accessibility tree and fixes ordinary markup outright.

// 2. AX RECONCILIATION.
//    Where the DOM still says nothing, fall back to the accessibility role of a control that shares an unambiguous accessible name with an AX entry.
//    This handles custom widgets whose semantics live in the AX tree rather than in attributes.

// Safety invariants (regression-locked in tests/extension/role-reconcile.test.mjs):
// - A real, explicit DOM role is never downgraded or overwritten.
//   AX only ever fills a gap.
// - Reconciliation is read-only.
//   It never creates, moves, or invalidates a ref and never makes an element clickable; it only annotates a role fact.
// - An ambiguous name (two different AX roles share it) is never adopted.
// - A sensitive element is never annotated at all.

(() => {
  'use strict';
  if (globalThis.OperaAgentRoleReconcile) return;

  // WHY A LOCAL GUARD: this file ships as a classic content script the manifest loads directly; a static import would be a SyntaxError at load time.
  // Mirrors extension/lib/guards.ts.
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  interface RoleIndex {
    get(name: string): string | undefined;
  }

  function isRoleIndex(value: unknown): value is RoleIndex {
    return isRecord(value) && typeof value.get === 'function';
  }

  const ROLE_GAP_SAMPLE_SIZE = 3;

  const GENERIC_ROLES = new Set([
    '', 'generic', 'presentation', 'none', 'div', 'span', 'text', 'statictext',
    'paragraph', 'group', 'region', 'section', 'figure', 'blockquote', 'label',
    'list', 'listitem', 'emphasis', 'strong', 'insertion', 'deletion', 'time',
    'definition', 'term', 'caption', 'code', 'subscript', 'superscript', 'abbr'
  ]);

  const INPUT_TYPE_ROLES: Record<string, string> = {
    button: 'button', checkbox: 'checkbox', radio: 'radio', range: 'slider',
    number: 'spinbutton', search: 'searchbox', submit: 'button', reset: 'button',
    image: 'button', color: 'button', file: 'button'
  };

  const TAG_ROLES: Record<string, string> = {
    button: 'button', textarea: 'textbox', select: 'combobox', option: 'option',
    optgroup: 'group', progress: 'progressbar', meter: 'meter', summary: 'button',
    details: 'group', legend: 'legend', fieldset: 'group', form: 'form',
    img: 'img', table: 'table', ul: 'list', ol: 'list', li: 'listitem',
    dialog: 'dialog', menu: 'list', hr: 'separator'
  };

  function isGenericRole(role: unknown): boolean {
    return GENERIC_ROLES.has(String(role == null ? '' : role).trim().toLowerCase());
  }

  function headingRole(tag: string): string {
    const level = /^h([1-6])$/.exec(tag);
    return level ? `heading level-${level[1] ?? ''}` : 'heading';
  }

  function implicitRole(facts: unknown): string {
    const input = isRecord(facts) ? facts : {};
    const tag = String(input.tag == null ? '' : input.tag).trim().toLowerCase();
    const type = String(input.type == null ? '' : input.type).trim().toLowerCase();
    if (tag === 'a' || tag === 'area') {
      return String(input.href == null ? '' : input.href).trim() ? 'link' : '';
    }
    if (tag === 'input') {

      return INPUT_TYPE_ROLES[type] || 'textbox';
    }
    if (input.contenteditable === true) return 'textbox';
    if (/^h[1-6]$/.test(tag)) return headingRole(tag);
    return TAG_ROLES[tag] || '';
  }

  // The canonical role is ASCII words joined by single dashes; splitting cannot backtrack.
  function normalizeAxRole(role: unknown): string {
    const value = String(role == null ? '' : role).trim().toLowerCase();
    if (!value) return '';
    return value.split(/[^a-z0-9]+/).filter(Boolean).join('-');
  }

  function axRoleIndex(axItems: unknown): Map<string, string> {
    const list: unknown[] = Array.isArray(axItems) ? axItems : [];
    const candidates = new Map<string, Set<string>>();
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const record = isRecord(item) ? item : {};
      const name = String(record.name == null ? '' : record.name).trim().toLowerCase();
      const role = normalizeAxRole(record.role);
      if (!name || !role || isGenericRole(role)) continue;
      const seen = candidates.get(name) ?? new Set<string>();
      seen.add(role);
      candidates.set(name, seen);
    }
    const resolved = new Map<string, string>();
    candidates.forEach((roles, name) => {
      if (roles.size === 1) {
        const only = [...roles][0];
        if (only !== undefined) resolved.set(name, only);
      }
    });
    return resolved;
  }

  function nameForJoin(item: Record<string, unknown>): string {
    return String(item.accessibleName || item.label || item.text || '').trim().toLowerCase();
  }

  function reconcileElementRole(item: unknown, index: unknown): unknown {
    if (!isRecord(item)) return item;
    if (!isRoleIndex(index)) return item;
    if (item.sensitive === true) return item;
    if (!isGenericRole(item.role)) return item;
    const name = nameForJoin(item);
    if (!name) return item;
    const role = index.get(name);
    if (!role) return item;
    return { ...item, role, roleSource: 'ax-reconciled' };
  }

  function hasRoleGap(elements: unknown): boolean {
    if (!Array.isArray(elements) || elements.length === 0) return false;
    let gaps = 0;
    const list: unknown[] = elements;
    for (const item of list) {
      const candidate = item ? (isRecord(item) ? item.role : undefined) : item;

      if (isGenericRole(candidate)) {
        gaps += 1;

        if (gaps >= ROLE_GAP_SAMPLE_SIZE) return true;
      }
    }
    return false;
  }

  function reconcileElements(items: unknown, index: unknown): unknown {
    if (!Array.isArray(items) || !isRoleIndex(index)) return items;
    const list: unknown[] = items;
    return list.map((item) => reconcileElementRole(item, index));
  }

  globalThis.OperaAgentRoleReconcile = Object.freeze({

    GENERIC_ROLES: Object.freeze([...GENERIC_ROLES]),
    ROLE_GAP_SAMPLE_SIZE,
    isGenericRole,
    hasRoleGap,
    implicitRole,
    normalizeAxRole,
    axRoleIndex,
    reconcileElementRole,
    reconcileElements
  });
})();
