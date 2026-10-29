// @last-edited: 2026-10-21 UTC+7.
// @title: role-reconcile.test — a control role is read from the page, and a missing one says so.
// @state: the roles it reconciles, the empty role it returns, and the shape the page sees.
// @dependencies: node:test, strict, promises, extension-source.

// Role reconciliation contracts.

// Root cause under test: `serialize()` reported `role: clean(el.getAttribute ('role'), 80)`, so any control without an explicit role attribute reported `role: ''` and was invisible to a role-filtered find_elements.
// These tests lock the repair: implicit roles from markup, AX fallback for custom widgets, and the safety properties that keep reconciliation read-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extensionSource } from './helpers/extension-source.mjs';
import { contentSource } from './helpers/content-source.mjs';

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

test('ordinary markup now yields the role the platform reports', () => {
  assert.equal(implicitRole({ tag: 'button' }), 'button');
  assert.equal(implicitRole({ tag: 'textarea' }), 'textbox');
  assert.equal(implicitRole({ tag: 'select' }), 'combobox');
  assert.equal(implicitRole({ tag: 'progress' }), 'progressbar');
  assert.equal(implicitRole({ tag: 'h3' }), 'heading level-3');
  assert.equal(implicitRole({ tag: 'img' }), 'img');
  assert.equal(implicitRole({ tag: 'li' }), 'listitem');
  assert.equal(implicitRole({
    tag: 'a',
    href: 'https://example.com/x'
  }), 'link');
  assert.equal(implicitRole({
    tag: 'div',
    contenteditable: true
  }), 'textbox');
});

test('input types map to their control roles and a missing type is a textbox', () => {
  assert.equal(implicitRole({
    tag: 'input',
    type: 'checkbox'
  }), 'checkbox');
  assert.equal(implicitRole({
    tag: 'input',
    type: 'radio'
  }), 'radio');
  assert.equal(implicitRole({
    tag: 'input',
    type: 'range'
  }), 'slider');
  assert.equal(implicitRole({
    tag: 'input',
    type: 'number'
  }), 'spinbutton');
  assert.equal(implicitRole({
    tag: 'input',
    type: 'submit'
  }), 'button');
  assert.equal(implicitRole({
    tag: 'input',
    type: 'search'
  }), 'searchbox');
  assert.equal(implicitRole({ tag: 'input' }), 'textbox');
  assert.equal(implicitRole({
    tag: 'input',
    type: 'hidden'
  }), 'textbox');
});

test('an anchor without an href is not a link, and unknown tags stay empty', () => {
  assert.equal(implicitRole({ tag: 'a' }), '');
  assert.equal(implicitRole({
    tag: 'a',
    href: ''
  }), '');
  assert.equal(implicitRole({ tag: 'span' }), '');
  assert.equal(implicitRole({ tag: 'some-custom-widget' }), '');
  assert.equal(implicitRole({}), '');
});

test('a custom widget is reconciled from the accessibility role', () => {
  const index = axRoleIndex([
    {
      role: 'RadioButton',
      name: 'Header'
    },
    {
      role: 'RadioButton',
      name: 'Footer'
    },
    {
      role: 'CheckBox',
      name: 'Show on first page'
    },
    {
      role: 'StaticText',
      name: 'Position'
    },
    {
      role: 'Button',
      name: 'Apply'
    }
  ]);
  const footer = reconcileElementRole({
    ref: 'oa-9',
    role: '',
    label: 'Footer',
    tag: 'div'
  }, index);
  assert.equal(footer.role, 'radiobutton');
  assert.equal(footer.roleSource, 'ax-reconciled');
  assert.equal(footer.ref, 'oa-9');
  assert.equal(reconcileElementRole({
    role: '',
    label: 'Show on first page'
  }, index).role, 'checkbox');
  assert.equal(reconcileElementRole({
    role: '',
    text: 'Apply'
  }, index).role, 'button');
});

test('a real DOM role is never downgraded or overwritten by the AX tree', () => {
  const index = axRoleIndex([{
    role: 'CheckBox',
    name: 'Send'
  }]);
  const explicit = reconcileElementRole({
    role: 'button',
    label: 'Send',
    ref: 'oa-1'
  }, index);
  assert.equal(explicit.role, 'button');
  assert.equal(explicit.roleSource, undefined);

  assert.equal(reconcileElementRole({
    role: 'generic',
    label: 'Send'
  }, index).role, 'checkbox');
  assert.equal(reconcileElementRole({
    role: 'presentation',
    label: 'Send'
  }, index).role, 'checkbox');
});

test('an ambiguous name is never adopted, because that would be a guess', () => {
  const index = axRoleIndex([
    {
      role: 'RadioButton',
      name: 'Header'
    },
    {
      role: 'CheckBox',
      name: 'Header'
    }
  ]);
  assert.equal(index.has('header'), false);
  assert.equal(reconcileElementRole({
    role: '',
    label: 'Header'
  }, index).role, '');

  const agreed = axRoleIndex([
    {
      role: 'RadioButton',
      name: 'Footer'
    },
    {
      role: 'RadioButton',
      name: 'Footer'
    }
  ]);
  assert.equal(reconcileElementRole({
    role: '',
    label: 'Footer'
  }, agreed).role, 'radiobutton');
});

test('reconciliation is read-only and grants no action authority', () => {
  const index = axRoleIndex([{
    role: 'Button',
    name: 'Apply'
  }]);
  const before = {
    ref: 'oa-5',
    role: '',
    label: 'Apply',
    actionable: false,
    sensitive: false,
    stableKey: 'k'
  };
  const after = reconcileElementRole(before, index);
  assert.notEqual(after, before, 'must return a new object');
  assert.deepEqual(before, {
    ref: 'oa-5',
    role: '',
    label: 'Apply',
    actionable: false,
    sensitive: false,
    stableKey: 'k'
  });

  assert.equal(after.ref, 'oa-5');
  assert.equal(after.actionable, false);
  assert.equal(after.stableKey, 'k');
  assert.equal(reconcileElements([{
    ref: 'oa-5',
    role: '',
    label: 'Apply'
  }], index)[0].ref, 'oa-5');
});

test('a sensitive element is never annotated', () => {
  const index = axRoleIndex([{
    role: 'TextField',
    name: 'Card number'
  }]);
  const sensitive = reconcileElementRole({
    role: '',
    label: 'Card number',
    sensitive: true
  }, index);
  assert.equal(sensitive.role, '');
  assert.equal(sensitive.roleSource, undefined);
});

test('AX roles normalize to the lowercase ARIA vocabulary', () => {
  assert.equal(normalizeAxRole('RadioButton'), 'radiobutton');
  assert.equal(normalizeAxRole('CheckBox'), 'checkbox');
  assert.equal(normalizeAxRole('MenuItem'), 'menuitem');
  assert.equal(normalizeAxRole('StaticText'), 'statictext');
  assert.equal(normalizeAxRole(''), '');
  assert.equal(normalizeAxRole(null), '');

  assert.equal(normalizeAxRole('SomeFutureThing'), 'somefuturething');
  assert.equal(isGenericRole('statictext'), true);
  assert.equal(isGenericRole('radiobutton'), false);
  assert.ok(GENERIC_ROLES.includes('generic'));
});

test('the join uses the best available name and survives junk input', () => {
  const index = axRoleIndex([{
    role: 'Button',
    name: 'Apply'
  }]);
  assert.equal(reconcileElementRole({
    role: '',
    accessibleName: 'Apply'
  }, index).role, 'button');
  assert.equal(reconcileElementRole({
    role: '',
    text: 'Apply'
  }, index).role, 'button');
  assert.equal(reconcileElementRole({
    role: '',
    label: '  APPLY  '
  }, index).role, 'button');

  assert.equal(reconcileElementRole({
    role: '',
    label: '   '
  }, index).role, '');
  assert.equal(reconcileElementRole(null, index), null);
  assert.equal(reconcileElementRole({ role: '' }, null).role, '');
  assert.deepEqual(reconcileElements(null, index), null);
  assert.deepEqual(reconcileElements([{ role: '' }], null), [{ role: '' }]);
});

test('a semantic gap justifies the accessibility walk even on a text-rich page', async () => {
  const {
    hasRoleGap,
    ROLE_GAP_SAMPLE_SIZE
  } = globalThis.OperaAgentRoleReconcile;
  assert.equal(ROLE_GAP_SAMPLE_SIZE, 3);

  const gapped = [
    { role: 'button' },
    { role: '' },
    { role: 'generic' },
    { role: 'presentation' },
    { role: 'textbox' }
  ];
  assert.equal(hasRoleGap(gapped), true);

  assert.equal(hasRoleGap([
    { role: 'button' },
    { role: 'link' },
    { role: 'textbox' }
  ]), false);
  assert.equal(hasRoleGap([]), false);
  assert.equal(hasRoleGap(null), false);

  assert.equal(hasRoleGap([
    { role: 'button' },
    { role: 'link' },
    { role: '' }
  ]), false);
  assert.equal(hasRoleGap([
    { role: 'button' },
    { role: '' },
    { role: 'presentation' }
  ]), false);
  assert.equal(hasRoleGap([
    { role: 'button' },
    { role: '' },
    { role: 'generic' },
    { role: 'textbox' }
  ]), false);
  assert.equal(hasRoleGap([
    { role: 'button' },
    { role: '' },
    { role: 'generic' },
    { role: 'textbox' },
    { role: 'presentation' }
  ]), true);

  const background = await extensionSource();
  const start = background.indexOf("case 'page.read': {");
  const end = background.indexOf("case 'page.query':", start);
  const block = background.slice(start, end);
  assert.match(block, /hasRoleGap\(result\?\.page\?\.elements\)/);
  assert.match(block, /AX_SUMMARY_TEXT_POVERTY_CHARS \|\| r9SemanticGap/);

  assert.equal((block.match(/collectAxSummary\(/g) || []).length, 1);
});

test('R9: an oversized read degrades instead of failing the whole call', async () => {
  const background = await extensionSource();
  const start = background.indexOf("case 'page.read': {");
  const end = background.indexOf("case 'page.query':", start);
  const block = background.slice(start, end);

  assert.match(block, /if \(result\?\.page && oversized\(result\)\)/);
  assert.match(block, /const \{\s*elements,\s*\.\.\.withoutElements\s*\} = result\.page/);
  assert.match(block, /truncated: true/);
  assert.match(block, /omittedElementCount/);
  assert.match(block, /includeElements disabled/);

  assert.match(background, /Result exceeds \$\{MAX_RESULT_BYTES\} bytes/);
});

test('serialize derives roles from markup instead of only the role attribute', async () => {
  const source = contentSource();

  assert.match(source, /const roleRuntime = globalThis\.OperaAgentRoleReconcile \|\| \{\}/,
    'the runtime is no longer read straight into a bare binding');
  assert.match(source, /typeof roleRuntime\.implicitRole === 'function'/,
    'implicitRole is not checked before it is used');
  assert.doesNotMatch(source, /^\s*import\s/m);

  const signature = /function serialize\(\s*el,\s*options = \{\}\s*\)/.exec(source);
  assert.ok(signature, 'serialize must be locatable');
  const block = source.slice(signature.index, source.indexOf('\n  function ', signature.index + 10));
  assert.match(block, /const explicitRole = clean\(el\.getAttribute\?\.\('role'\), 80\)/);
  assert.match(block, /const role = explicitRole \|\| implicitRole\(/);
  assert.doesNotMatch(block, /^\s*role: clean\(el\.getAttribute/m);
});

test('the role attribute stays authoritative where it defines identity, not action', async () => {
  const source = contentSource();

  const identityStart = source.indexOf('function stableElementIdentity(el) {');
  assert.ok(identityStart > 0, 'stableElementIdentity must be locatable');
  const identity = source.slice(identityStart, source.indexOf('\n  function ', identityStart + 10));
  assert.match(identity, /const role = clean\(el\.getAttribute\?\.\('role'\), 80\)/);
  assert.doesNotMatch(identity, /implicitRole/);

  assert.match(source, /const role = clean\(node\.getAttribute\?\.\('role'\), 80\)/);
});

test('the manifest loads the role runtime before the content script', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('role-reconcile.js'), 'the role runtime must be injected');
  assert.ok(
    scripts.indexOf('role-reconcile.js') < scripts.indexOf('content.js'),
    'the role runtime must load before content.js reads it'
  );
  assert.equal(manifest.version, '1.6.27');
});

test('background shares the one content-script copy instead of duplicating it', async () => {
  const source = await extensionSource();

  assert.match(source, /import '\.\/role-reconcile\.js'/);
  assert.match(source, /globalThis\.OperaAgentRoleReconcile/);
  assert.doesNotMatch(source, /function implicitRole\(/);
  assert.doesNotMatch(source, /const TAG_ROLES/);
});

test('background reconciliation runs only on the existing text-poor AX path', async () => {
  const source = await extensionSource();
  const start = source.indexOf("case 'page.read': {");
  const end = source.indexOf("case 'page.query':", start);
  assert.ok(start > 0 && end > start, 'the page.read branch must be locatable');
  const block = source.slice(start, end);

  assert.equal((block.match(/collectAxSummary\(/g) || []).length, 1);
  assert.match(block, /axRoleIndex/);
  assert.match(block, /reconcileElements/);

  assert.doesNotMatch(block, /trustedKey|trustedClick|trustedFill|trustedPointer|getRef\(/);
});
