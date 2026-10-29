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

// Safety invariants (regression-locked in tests/role-reconcile.test.mjs):
// - A real, explicit DOM role is never downgraded or overwritten.
//   AX only ever fills a gap.
// - Reconciliation is read-only.
//   It never creates, moves, or invalidates a ref and never makes an element clickable; it only annotates a role fact.
// - An ambiguous name (two different AX roles share it) is never adopted.
// - A sensitive element is never annotated at all.

(() => {
  'use strict';
  if (globalThis.OperaAgentRoleReconcile) return;

  const ROLE_GAP_SAMPLE_SIZE = 3;

  const GENERIC_ROLES = new Set([
    '',
    'generic',
    'presentation',
    'none',
    'div',
    'span',
    'text',
    'statictext',
    'paragraph',
    'group',
    'region',
    'section',
    'figure',
    'blockquote',
    'label',
    'list',
    'listitem',
    'emphasis',
    'strong',
    'insertion',
    'deletion',
    'time',
    'definition',
    'term',
    'caption',
    'code',
    'subscript',
    'superscript',
    'abbr'
  ]);

  const INPUT_TYPE_ROLES = {
    button: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    number: 'spinbutton',
    search: 'searchbox',
    submit: 'button',
    reset: 'button',
    image: 'button',
    color: 'button',
    file: 'button'
  };

  const TAG_ROLES = {
    button: 'button',
    textarea: 'textbox',
    select: 'combobox',
    option: 'option',
    optgroup: 'group',
    progress: 'progressbar',
    meter: 'meter',
    summary: 'button',
    details: 'group',
    legend: 'legend',
    fieldset: 'group',
    form: 'form',
    img: 'img',
    table: 'table',
    ul: 'list',
    ol: 'list',
    li: 'listitem',
    dialog: 'dialog',
    menu: 'list',
    hr: 'separator'
  };

  function isGenericRole(role) {
    return GENERIC_ROLES.has(String(role == null ? '' : role).trim().toLowerCase());
  }

  function headingRole(tag) {
    const level = /^h([1-6])$/.exec(tag);
    return level ? `heading level-${level[1]}` : 'heading';
  }

  function implicitRole(facts) {
    const input = facts || {};
    const tag = String(input.tag || '').trim().toLowerCase();
    const type = String(input.type || '').trim().toLowerCase();
    if (tag === 'a' || tag === 'area') {
      return String(input.href || '').trim() ? 'link' : '';
    }
    if (tag === 'input') {
      return INPUT_TYPE_ROLES[type] || 'textbox';
    }
    if (input.contenteditable === true) return 'textbox';
    if (/^h[1-6]$/.test(tag)) return headingRole(tag);
    return TAG_ROLES[tag] || '';
  }

  function normalizeAxRole(role) {
    const value = String(role == null ? '' : role).trim().toLowerCase();
    if (!value) return '';
    return value.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function axRoleIndex(axItems) {
    const list = Array.isArray(axItems) ? axItems : [];
    const candidates = new Map();
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index] || {};
      const name = String(item.name == null ? '' : item.name).trim().toLowerCase();
      const role = normalizeAxRole(item.role);
      if (!name || !role || isGenericRole(role)) continue;
      const seen = candidates.get(name) || new Set();
      seen.add(role);
      candidates.set(name, seen);
    }
    const resolved = new Map();
    candidates.forEach((
      roles,
      name
    ) => {
      if (roles.size === 1) resolved.set(name, [...roles][0]);
    });
    return resolved;
  }

  function nameForJoin(item) {
    return String(item.accessibleName || item.label || item.text || '').trim().toLowerCase();
  }

  function reconcileElementRole(
    item,
    index
  ) {
    if (!item || typeof item !== 'object') return item;
    if (!index || typeof index.get !== 'function') return item;
    if (item.sensitive === true) return item;
    if (!isGenericRole(item.role)) return item;
    const name = nameForJoin(item);
    if (!name) return item;
    const role = index.get(name);
    if (!role) return item;
    return {
      ...item,
      role,
      roleSource: 'ax-reconciled'
    };
  }

  function hasRoleGap(elements) {
    if (!Array.isArray(elements) || elements.length === 0) return false;
    let gaps = 0;
    for (const item of elements) {
      if (isGenericRole(item && item.role)) {
        gaps += 1;

        if (gaps >= ROLE_GAP_SAMPLE_SIZE) return true;
      }
    }
    return false;
  }

  function reconcileElements(
    items,
    index
  ) {
    if (!Array.isArray(items) || !index || typeof index.get !== 'function') return items;
    return items.map((item) => reconcileElementRole(item, index));
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
