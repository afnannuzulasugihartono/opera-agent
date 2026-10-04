// Last edited: 2026-10-04 17:52. Title: role-reconcile — R9-C : role reconciliation, as a classic content script. Now: fix(r9): hygiene pass on the R9 code itself.

// R9-C (2026-09-30): role reconciliation, as a classic content script.
//
// This file is loaded by the manifest BEFORE content.js and publishes its pure
// helpers on globalThis, exactly like semantic-identity.js and
// semantic-views.js. Content scripts are classic scripts and cannot use ES
// imports, so the same pattern is used here rather than duplicating the logic
// inline or adding a second, drifting copy. It stays importable in Node for
// tests via import-for-side-effect, the same way the semantic engines are
// tested.
//
// Why this exists. `serialize()` read the role straight off the DOM attribute:
// `role: clean(el.getAttribute('role'), 80)`. A plain <button>Send</button>
// therefore reported `role: ''`, and any control the author did not annotate
// was invisible to a role-filtered find_elements. That is not a Google Docs
// quirk, it is most of the web — and it is why the Page numbers dialog reported
// `Footer` and `Show on first page` as text but never as a radio or a checkbox.
//
// Two layers, deliberately separated:
//
//   1. IMPLICIT ROLE. Derive the role the platform would report from the
//      element's own tag, type, href, and contenteditable state. This needs no
//      accessibility tree and fixes ordinary markup outright.
//
//   2. AX RECONCILIATION. Where the DOM still says nothing, fall back to the
//      accessibility role of a control that shares an unambiguous accessible
//      name with an AX entry. This handles custom widgets whose semantics live
//      in the AX tree rather than in attributes.
//
// Safety invariants (regression-locked in tests/r9-role-reconcile.test.mjs):
// - A real, explicit DOM role is never downgraded or overwritten. AX only ever
//   fills a gap.
// - Reconciliation is read-only. It never creates, moves, or invalidates a ref
//   and never makes an element clickable; it only annotates a role fact.
// - An ambiguous name (two different AX roles share it) is never adopted.
// - A sensitive element is never annotated at all.
(() => {
  'use strict';
  if (globalThis.OperaAgentRoleReconcile) return;

  // A page needs enough unlabelled controls to be worth one bounded
  // accessibility walk. Small pages and healthy pages both stay off it.
  const ROLE_GAP_SAMPLE_SIZE = 3;

  // These are published on globalThis, where a sibling content script could
  // reach them. A mutable Set or object would let any of them silently change
  // role decisions for every later call, so they are frozen on the way out.
  // genericRoleSet is internal and never exported.
  const GENERIC_ROLES = new Set([
    '', 'generic', 'presentation', 'none', 'div', 'span', 'text', 'statictext',
    'paragraph', 'group', 'region', 'section', 'figure', 'blockquote', 'label',
    'list', 'listitem', 'emphasis', 'strong', 'insertion', 'deletion', 'time',
    'definition', 'term', 'caption', 'code', 'subscript', 'superscript', 'abbr'
  ]);

  const INPUT_TYPE_ROLES = {
    button: 'button', checkbox: 'checkbox', radio: 'radio', range: 'slider',
    number: 'spinbutton', search: 'searchbox', submit: 'button', reset: 'button',
    image: 'button', color: 'button', file: 'button'
  };

  const TAG_ROLES = {
    button: 'button', textarea: 'textbox', select: 'combobox', option: 'option',
    optgroup: 'group', progress: 'progressbar', meter: 'meter', summary: 'button',
    details: 'group', legend: 'legend', fieldset: 'group', form: 'form',
    img: 'img', table: 'table', ul: 'list', ol: 'list', li: 'listitem',
    dialog: 'dialog', menu: 'list', hr: 'separator'
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
      // A missing type attribute means text; a hidden input is still a textbox
      // to the platform, so it is not special-cased away here.
      return INPUT_TYPE_ROLES[type] || 'textbox';
    }
    if (input.contenteditable === true) return 'textbox';
    if (/^h[1-6]$/.test(tag)) return headingRole(tag);
    return TAG_ROLES[tag] || '';
  }

  // CDP reports AX roles in CamelCase; the model-facing vocabulary is lowercase
  // ARIA. Unknown roles pass through lowercased rather than being dropped, so an
  // unexpected platform role stays visible instead of silently disappearing.
  function normalizeAxRole(role) {
    const value = String(role == null ? '' : role).trim().toLowerCase();
    if (!value) return '';
    return value.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Only unambiguous names are indexed. If two different AX roles share one
  // name, adopting either would be a guess, so that name is left out entirely.
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
    candidates.forEach((roles, name) => {
      if (roles.size === 1) resolved.set(name, [...roles][0]);
    });
    return resolved;
  }

  function nameForJoin(item) {
    return String(item.accessibleName || item.label || item.text || '').trim().toLowerCase();
  }

  // Returns a NEW object; the input is never mutated, and ref, actionable, and
  // every other field carry through untouched, so reconciliation can never
  // grant or revoke action authority.
  function reconcileElementRole(item, index) {
    if (!item || typeof item !== 'object') return item;
    if (!index || typeof index.get !== 'function') return item;
    if (item.sensitive === true) return item;
    if (!isGenericRole(item.role)) return item;
    const name = nameForJoin(item);
    if (!name) return item;
    const role = index.get(name);
    if (!role) return item;
    return { ...item, role, roleSource: 'ax-reconciled' };
  }

  // R9-C follow-up: whether a read left a semantic gap worth paying a bounded
  // accessibility walk for.
  //
  // The accessibility walk used to be gated on text poverty alone, which meant
  // it never ran on the app that motivated R9-C: a Google Docs document with 70
  // pages is NOT text-poor, so its axSummary was never collected and the role
  // reconciliation below never fired. The Page numbers dialog radios and
  // checkboxes therefore stayed undiscoverable by role, which is why they had to
  // be found by pointer probing. A page whose elements still carry no real role
  // is a semantic gap whether or not it has plenty of text.
  function hasRoleGap(elements) {
    if (!Array.isArray(elements) || elements.length === 0) return false;
    let gaps = 0;
    for (const item of elements) {
      if (isGenericRole(item && item.role)) {
        gaps += 1;
        // A few clear gaps are enough to justify the walk; do not require every
        // element to be unlabelled, which would also fire on healthy pages.
        if (gaps >= ROLE_GAP_SAMPLE_SIZE) return true;
      }
    }
    return false;
  }

  function reconcileElements(items, index) {
    if (!Array.isArray(items) || !index || typeof index.get !== 'function') return items;
    return items.map((item) => reconcileElementRole(item, index));
  }

  globalThis.OperaAgentRoleReconcile = Object.freeze({
    // Published as a frozen ARRAY, not the Set. Object.freeze does NOT make a
    // Set immutable — .add() still works, because it mutates internal state
    // rather than a property — so handing out the Set would leave it writable
    // by any sibling content script. isGenericRole is the functional API.
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
