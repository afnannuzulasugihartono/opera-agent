// R9-C (2026-09-30): role reconciliation contracts.
//
// Root cause under test: `serialize()` reported `role: clean(el.getAttribute
// ('role'), 80)`, so any control without an explicit role attribute reported
// `role: ''` and was invisible to a role-filtered find_elements. These tests
// lock the repair: implicit roles from markup, AX fallback for custom widgets,
// and the safety properties that keep reconciliation read-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// extension/role-reconcile.js is a classic content script with no export
// statements, so it is imported here for its side effect and read off
// globalThis — the same pattern the semantic engines use.
await import('../extension/role-reconcile.js');
const {
  GENERIC_ROLES,
  axRoleIndex,
  implicitRole,
  isGenericRole,
  normalizeAxRole,
  reconcileElementRole,
  reconcileElements
} = globalThis.OperaAgentRoleReconcile;

test('R9-C: ordinary markup now yields the role the platform reports', () => {
  assert.equal(implicitRole({ tag: 'button' }), 'button');
  assert.equal(implicitRole({ tag: 'textarea' }), 'textbox');
  assert.equal(implicitRole({ tag: 'select' }), 'combobox');
  assert.equal(implicitRole({ tag: 'progress' }), 'progressbar');
  assert.equal(implicitRole({ tag: 'h3' }), 'heading level-3');
  assert.equal(implicitRole({ tag: 'img' }), 'img');
  assert.equal(implicitRole({ tag: 'li' }), 'listitem');
  assert.equal(implicitRole({ tag: 'a', href: 'https://example.com/x' }), 'link');
  assert.equal(implicitRole({ tag: 'div', contenteditable: true }), 'textbox');
});

test('R9-C: input types map to their control roles and a missing type is a textbox', () => {
  assert.equal(implicitRole({ tag: 'input', type: 'checkbox' }), 'checkbox');
  assert.equal(implicitRole({ tag: 'input', type: 'radio' }), 'radio');
  assert.equal(implicitRole({ tag: 'input', type: 'range' }), 'slider');
  assert.equal(implicitRole({ tag: 'input', type: 'number' }), 'spinbutton');
  assert.equal(implicitRole({ tag: 'input', type: 'submit' }), 'button');
  assert.equal(implicitRole({ tag: 'input', type: 'search' }), 'searchbox');
  assert.equal(implicitRole({ tag: 'input' }), 'textbox');
  assert.equal(implicitRole({ tag: 'input', type: 'hidden' }), 'textbox');
});

test('R9-C: an anchor without an href is not a link, and unknown tags stay empty', () => {
  assert.equal(implicitRole({ tag: 'a' }), '');
  assert.equal(implicitRole({ tag: 'a', href: '' }), '');
  assert.equal(implicitRole({ tag: 'span' }), '');
  assert.equal(implicitRole({ tag: 'some-custom-widget' }), '');
  assert.equal(implicitRole({}), '');
});

test('R9-C: a custom widget is reconciled from the accessibility role', () => {
  // The reported case: the Page numbers dialog labels were readable as text,
  // but find_elements never returned them with a radio or checkbox role.
  const index = axRoleIndex([
    { role: 'RadioButton', name: 'Header' },
    { role: 'RadioButton', name: 'Footer' },
    { role: 'CheckBox', name: 'Show on first page' },
    { role: 'StaticText', name: 'Position' },
    { role: 'Button', name: 'Apply' }
  ]);
  const footer = reconcileElementRole({ ref: 'oa-9', role: '', label: 'Footer', tag: 'div' }, index);
  assert.equal(footer.role, 'radiobutton');
  assert.equal(footer.roleSource, 'ax-reconciled');
  assert.equal(footer.ref, 'oa-9');
  assert.equal(reconcileElementRole({ role: '', label: 'Show on first page' }, index).role, 'checkbox');
  assert.equal(reconcileElementRole({ role: '', text: 'Apply' }, index).role, 'button');
});

test('R9-C: a real DOM role is never downgraded or overwritten by the AX tree', () => {
  const index = axRoleIndex([{ role: 'CheckBox', name: 'Send' }]);
  const explicit = reconcileElementRole({ role: 'button', label: 'Send', ref: 'oa-1' }, index);
  assert.equal(explicit.role, 'button');
  assert.equal(explicit.roleSource, undefined);
  // A generic DOM role IS a gap, so it may be filled.
  assert.equal(reconcileElementRole({ role: 'generic', label: 'Send' }, index).role, 'checkbox');
  assert.equal(reconcileElementRole({ role: 'presentation', label: 'Send' }, index).role, 'checkbox');
});

test('R9-C: an ambiguous name is never adopted, because that would be a guess', () => {
  const index = axRoleIndex([
    { role: 'RadioButton', name: 'Header' },
    { role: 'CheckBox', name: 'Header' }
  ]);
  assert.equal(index.has('header'), false);
  assert.equal(reconcileElementRole({ role: '', label: 'Header' }, index).role, '');
  // Agreement among several nodes on one role is still unambiguous.
  const agreed = axRoleIndex([
    { role: 'RadioButton', name: 'Footer' },
    { role: 'RadioButton', name: 'Footer' }
  ]);
  assert.equal(reconcileElementRole({ role: '', label: 'Footer' }, agreed).role, 'radiobutton');
});

test('R9-C: reconciliation is read-only and grants no action authority', () => {
  const index = axRoleIndex([{ role: 'Button', name: 'Apply' }]);
  const before = { ref: 'oa-5', role: '', label: 'Apply', actionable: false, sensitive: false, stableKey: 'k' };
  const after = reconcileElementRole(before, index);
  assert.notEqual(after, before, 'must return a new object');
  assert.deepEqual(before, { ref: 'oa-5', role: '', label: 'Apply', actionable: false, sensitive: false, stableKey: 'k' });
  // The only fields that may change are the role fact and its provenance.
  assert.equal(after.ref, 'oa-5');
  assert.equal(after.actionable, false);
  assert.equal(after.stableKey, 'k');
  assert.equal(reconcileElements([{ ref: 'oa-5', role: '', label: 'Apply' }], index)[0].ref, 'oa-5');
});

test('R9-C: a sensitive element is never annotated', () => {
  const index = axRoleIndex([{ role: 'TextField', name: 'Card number' }]);
  const sensitive = reconcileElementRole({ role: '', label: 'Card number', sensitive: true }, index);
  assert.equal(sensitive.role, '');
  assert.equal(sensitive.roleSource, undefined);
});

test('R9-C: AX roles normalize to the lowercase ARIA vocabulary', () => {
  assert.equal(normalizeAxRole('RadioButton'), 'radiobutton');
  assert.equal(normalizeAxRole('CheckBox'), 'checkbox');
  assert.equal(normalizeAxRole('MenuItem'), 'menuitem');
  assert.equal(normalizeAxRole('StaticText'), 'statictext');
  assert.equal(normalizeAxRole(''), '');
  assert.equal(normalizeAxRole(null), '');
  // Unknown platform roles survive rather than being dropped.
  assert.equal(normalizeAxRole('SomeFutureThing'), 'somefuturething');
  assert.equal(isGenericRole('statictext'), true);
  assert.equal(isGenericRole('radiobutton'), false);
  assert.ok(GENERIC_ROLES.includes('generic'));
});

test('R9-C: the join uses the best available name and survives junk input', () => {
  const index = axRoleIndex([{ role: 'Button', name: 'Apply' }]);
  assert.equal(reconcileElementRole({ role: '', accessibleName: 'Apply' }, index).role, 'button');
  assert.equal(reconcileElementRole({ role: '', text: 'Apply' }, index).role, 'button');
  assert.equal(reconcileElementRole({ role: '', label: '  APPLY  ' }, index).role, 'button');
  // No usable name means no join, never a positional guess.
  assert.equal(reconcileElementRole({ role: '', label: '   ' }, index).role, '');
  assert.equal(reconcileElementRole(null, index), null);
  assert.equal(reconcileElementRole({ role: '' }, null).role, '');
  assert.deepEqual(reconcileElements(null, index), null);
  assert.deepEqual(reconcileElements([{ role: '' }], null), [{ role: '' }]);
});

test('R9-C: a semantic gap justifies the accessibility walk even on a text-rich page', async () => {
  // The root cause of the reported "found the dialog controls by probing
  // coordinates": the AX walk was gated on text poverty alone, so a 70-page
  // Google Docs document never produced an axSummary and the reconciliation
  // never ran. Text richness must not disable it.
  const { hasRoleGap, ROLE_GAP_SAMPLE_SIZE } = globalThis.OperaAgentRoleReconcile;
  assert.equal(ROLE_GAP_SAMPLE_SIZE, 3);
  // Three unlabelled controls are enough to justify one bounded walk.
  const gapped = [
    { role: 'button' }, { role: '' }, { role: 'generic' }, { role: 'presentation' }, { role: 'textbox' }
  ];
  assert.equal(hasRoleGap(gapped), true);
  // A healthy page must not pay for it.
  assert.equal(hasRoleGap([{ role: 'button' }, { role: 'link' }, { role: 'textbox' }]), false);
  assert.equal(hasRoleGap([]), false);
  assert.equal(hasRoleGap(null), false);
  // One or two stray gaps in a mostly-labelled list are not enough; the sample
  // guards the cost of the walk.
  assert.equal(hasRoleGap([{ role: 'button' }, { role: 'link' }, { role: '' }]), false);
  assert.equal(hasRoleGap([{ role: 'button' }, { role: '' }, { role: 'presentation' }]), false);
  assert.equal(hasRoleGap([{ role: 'button' }, { role: '' }, { role: 'generic' }, { role: 'textbox' }]), false);
  assert.equal(hasRoleGap([{ role: 'button' }, { role: '' }, { role: 'generic' }, { role: 'textbox' }, { role: 'presentation' }]), true);

  const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const start = background.indexOf("case 'page.read': {");
  const end = background.indexOf("case 'page.query':", start);
  const block = background.slice(start, end);
  assert.match(block, /hasRoleGap\(result\?\.page\?\.elements\)/);
  assert.match(block, /AX_SUMMARY_TEXT_POVERTY_CHARS \|\| r9SemanticGap/);
  // Still exactly one accessibility walk, never a second one.
  assert.equal((block.match(/collectAxSummary\(/g) || []).length, 1);
});

test('R9: an oversized read degrades instead of failing the whole call', async () => {
  const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const start = background.indexOf("case 'page.read': {");
  const end = background.indexOf("case 'page.query':", start);
  const block = background.slice(start, end);
  // The text and the observation survive; only the element list is dropped.
  assert.match(block, /if \(result\?\.page && oversized\(result\)\)/);
  assert.match(block, /const \{ elements, \.\.\.withoutElements \} = result\.page/);
  assert.match(block, /truncated: true/);
  assert.match(block, /omittedElementCount/);
  assert.match(block, /includeElements disabled/);
  // The generic ceiling still throws for everything else: this is a page.read
  // degradation, not a blanket removal of the bound.
  assert.match(background, /Result exceeds \$\{MAX_RESULT_BYTES\} bytes/);
});

test('R9-C: serialize derives roles from markup instead of only the role attribute', async () => {
  const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
  // Content scripts are classic scripts: the shared helpers arrive on
  // globalThis from the manifest-loaded file, never via an ES import.
  assert.match(source, /const \{ implicitRole \} = globalThis\.OperaAgentRoleReconcile \|\| \{\}/);
  assert.doesNotMatch(source, /^\s*import\s/m);

  // The reported role comes from serialize(), so scope the check to it rather
  // than banning the attribute read everywhere: several other sites read the
  // raw role on purpose and are pinned separately below.
  const start = source.indexOf('function serialize(el, options = {}) {');
  assert.ok(start > 0, 'serialize must be locatable');
  const block = source.slice(start, source.indexOf('\n  function ', start + 10));
  assert.match(block, /const explicitRole = clean\(el\.getAttribute\?\.\('role'\), 80\)/);
  assert.match(block, /const role = explicitRole \|\| implicitRole\(/);
  assert.doesNotMatch(block, /^\s*role: clean\(el\.getAttribute/m);
});

test('R9-C: the role attribute stays authoritative where it defines identity, not action', async () => {
  const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
  // stableElementIdentity feeds the stableKey. Deriving an implicit role here
  // would silently change every stableKey in the product, so the raw attribute
  // is deliberate and must stay.
  const identityStart = source.indexOf('function stableElementIdentity(el) {');
  assert.ok(identityStart > 0, 'stableElementIdentity must be locatable');
  const identity = source.slice(identityStart, source.indexOf('\n  function ', identityStart + 10));
  assert.match(identity, /const role = clean\(el\.getAttribute\?\.\('role'\), 80\)/);
  assert.doesNotMatch(identity, /implicitRole/);
  // Region classification is structural, and scroll targets are a separate
  // contract; neither is an actionable role surface.
  assert.match(source, /const role = clean\(node\.getAttribute\?\.\('role'\), 80\)/);
});

test('R9-C: the manifest loads the role runtime before the content script', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('role-reconcile.js'), 'the role runtime must be injected');
  assert.ok(
    scripts.indexOf('role-reconcile.js') < scripts.indexOf('content.js'),
    'the role runtime must load before content.js reads it'
  );
  assert.equal(manifest.version, '1.6.14');
});

test('R9-C: background shares the one content-script copy instead of duplicating it', async () => {
  const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  // A side-effect import of an export-free file publishes the same global, so
  // the role table cannot drift between the two contexts.
  assert.match(source, /import '\.\/role-reconcile\.js'/);
  assert.match(source, /globalThis\.OperaAgentRoleReconcile/);
  assert.doesNotMatch(source, /function implicitRole\(/);
  assert.doesNotMatch(source, /const TAG_ROLES/);
});

test('R9-C: background reconciliation runs only on the existing text-poor AX path', async () => {
  const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const start = source.indexOf("case 'page.read': {");
  const end = source.indexOf("case 'page.query':", start);
  assert.ok(start > 0 && end > start, 'the page.read branch must be locatable');
  const block = source.slice(start, end);
  // Reuses the single bounded AX round trip that already exists for text-poor
  // surfaces; it must not add a second walk on every read.
  assert.equal((block.match(/collectAxSummary\(/g) || []).length, 1);
  assert.match(block, /axRoleIndex/);
  assert.match(block, /reconcileElements/);
  // It is a pure read path: no ref minting and no trusted input may appear.
  assert.doesNotMatch(block, /trustedKey|trustedClick|trustedFill|trustedPointer|getRef\(/);
});
