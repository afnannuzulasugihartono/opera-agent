// @last-edited: 2026-11-14 UTC+7.
// @title: global-contract - the type declarations and the classic scripts agree on every global, key for key.
// @state: one test per global the extension publishes; the key list mirrors extension/types/global.d.ts and changes in the same commit.
// @dependencies: node:test, node:assert/strict, the built .js publishers.

// WHY THIS GATE EXISTS.
// extension/types/global.d.ts names the shape of every classic-script global; tsc checks assignment at publish time and reads in modules.
// It cannot see a typed key the publisher never wrote, or a publisher that publishes under a different name: the classic script fails before anyone reads it, in a browser the test suite never drove.
// So this file imports the real publishers and reads back what they left on globalThis.

import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../extension/lib/agent-log.js');
await import('../../extension/hover-settle.js');
await import('../../extension/lib/statement-file.js');
await import('../../extension/semantic-identity.js');
await import('../../extension/semantic-views.js');
await import('../../extension/lib/page-map.js');
await import('../../extension/role-reconcile.js');

test('the log publishes exactly the declared members', () => {
  const log = globalThis.OperaAgentLog;
  assert.ok(log, 'OperaAgentLog published');
  const expected = ['configure', 'log', 'debug', 'warn', 'error', 'entries', 'clear', 'errors', 'clearErrors', 'errorCount'];
  assert.deepEqual(Object.keys(log).sort(), [...expected].sort());
  for (const member of expected) assert.equal(typeof log[member], 'function', `log.${member} is a function`);
});

test('the log names the browser before it is asked', () => {
  const id = globalThis.OperaAgentBrowserId;
  assert.ok(id && typeof id.browserName === 'string' && id.browserName.length > 0);
});

test('the log counts a fault it was asked to record', () => {
  const log = globalThis.OperaAgentLog;
  const before = log.errorCount();
  log.error('GLOBAL_CONTRACT_TEST_FAULT', 'recorded by the contract test');
  assert.equal(log.errorCount(), before + 1);
});

test('the hover settle plan terminates with a reason', () => {
  const hs = globalThis.OperaAgentHoverSettle;
  assert.ok(hs, 'OperaAgentHoverSettle published');
  assert.deepEqual(Object.keys(hs).sort(), ['DEFAULTS', 'normalize', 'plan']);
  assert.equal(typeof hs.DEFAULTS.stableRounds, 'number');
  assert.equal(hs.normalize({ timeoutMs: 'not a number' }).timeoutMs, 1500, 'an unreadable budget falls back to the default');
  const decision = hs.plan({ text: '', observedText: '', timeoutMs: 1500, elapsedMs: 10_000 });
  assert.equal(typeof decision.done, 'boolean');
  assert.equal(typeof decision.reason, 'string');
});

test('the statement file answers kind, pages and digits from the bytes', () => {
  const file = globalThis.OperaAgentStatementFile;
  assert.ok(file, 'OperaAgentStatementFile published');
  assert.deepEqual(Object.keys(file).sort(), ['balanceDigits', 'countPages', 'kindOf', 'pagesFrom']);
  const pdf = new TextEncoder().encode('%PDF-1.4 test /Type /Page /Type /Pages end');
  assert.equal(file.kindOf(pdf), 'pdf');
  assert.equal(file.countPages(pdf), 1, 'a compressed stream would read zero, a plain one reads its /Type /Page');
  assert.equal(file.pagesFrom('pdf', 1), 'counted from the file structure');
  assert.equal(file.balanceDigits('1.250.000,00'), '1250000');
});

test('the semantic identity engine is created per document and carries a stable hash', () => {
  const si = globalThis.OperaAgentSemanticIdentity;
  assert.ok(si, 'OperaAgentSemanticIdentity published');
  assert.deepEqual(Object.keys(si).sort(), ['createIdentityEngine', 'stableHash']);
  assert.equal(si.stableHash('same'), si.stableHash('same'));
  const engine = si.createIdentityEngine({ documentId: 'contract-test' });
  for (const member of ['reset', 'observe', 'inspect']) {
    assert.equal(typeof engine[member], 'function', `engine.${member} is a function`);
  }
});

test('the semantic views engine is created and classifies', () => {
  const sv = globalThis.OperaAgentSemanticViews;
  assert.ok(sv, 'OperaAgentSemanticViews published');
  assert.deepEqual(Object.keys(sv).sort(), ['COMPLETION_STATUSES', 'classifyCompletion', 'createViewEngine']);
  assert.ok(sv.COMPLETION_STATUSES.length >= 4);
  const engine = sv.createViewEngine();
  assert.equal(typeof engine.observe, 'function');
  assert.equal(typeof engine.reset, 'function');
  assert.equal(typeof sv.classifyCompletion({}).status, 'string');
});

test('the page map publishes the seventeen classes and a pull that pages', () => {
  const pm = globalThis.OperaAgentPageMap;
  assert.ok(pm, 'OperaAgentPageMap published');
  assert.equal(pm.PAGE_MAP_CLASSES.length, 17, 'the pull records exactly the seventeen classes');
  assert.equal(typeof pm.classify, 'function');
  assert.equal(typeof pm.isMapClass, 'function');
  assert.equal(typeof pm.isActionableClass, 'function');
  assert.equal(typeof pm.projectElement, 'function');
  assert.equal(typeof pm.unionBox, 'function');
  assert.equal(typeof pm.summarizeClass, 'function');
  const pull = pm.paginate([], 0, 10);
  assert.equal(pull.elements.length, 0);
  assert.equal(pull.hasMore, false);
  assert.equal(pull.total, 0);
});

test('the role reconcile publishes the gap detector and the reconcilers', () => {
  const rr = globalThis.OperaAgentRoleReconcile;
  assert.ok(rr, 'OperaAgentRoleReconcile published');
  assert.deepEqual(
    Object.keys(rr).sort(),
    ['GENERIC_ROLES', 'ROLE_GAP_SAMPLE_SIZE', 'axRoleIndex', 'hasRoleGap', 'implicitRole', 'isGenericRole', 'normalizeAxRole', 'reconcileElementRole', 'reconcileElements'],
  );
  assert.ok(rr.GENERIC_ROLES.length > 0);
  assert.equal(typeof rr.ROLE_GAP_SAMPLE_SIZE, 'number');
  assert.equal(rr.isGenericRole('generic'), true);
  assert.equal(rr.hasRoleGap([]), false);
  assert.equal(Array.isArray(rr.reconcileElements([], null)), true);
});
