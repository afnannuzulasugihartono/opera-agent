import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reconcileVmEffectObservation7E } from '../lib/reactive-vm-host-7e.js';

function baseIdentity(overrides = {}) {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001',
    deviceId: 'device_p6_live',
    tabId: 101,
    documentGeneration: 1,
    runtimeEpoch: 'epoch_p6_live',
    ...overrides,
  };
}

function baseObservation(overrides = {}) {
  const isReset = overrides.semanticDelta?.classification === 'RESET';
  const rev = overrides.semanticDelta?.resultingRevision ?? (isReset ? 1 : 2);
  const elemRev = overrides.elementRevision ?? rev;
  return {
    page: {
      title: 'Live P6 VM Page',
      url: 'https://example.com/live_p6',
      text: 'Full document text preserved for VM evaluation and snapshot recovery.',
    },
    elements: [
      { logicalId: 'elem_1', semanticRevision: elemRev, text: 'Live Button', role: 'button', tag: 'button' },
    ],
    semanticViews: {
      provenance: { category: 'AUTOMATION', sensor: 'PAGE_READ' },
      regions: [
        { regionId: 'rg_main', kind: 'landmark', role: 'main' },
      ],
      changedRegionIds: [],
      removedRegionIds: [],
    },
    semanticDelta: {
      sourceRevision: 1,
      resultingRevision: 2,
      classification: 'UPDATE',
      completeSnapshotRequired: isReset,
      changes: [{ type: 'UPDATE', logicalId: 'elem_1', revision: elemRev }],
      ...overrides.semanticDelta,
    },
    semanticState: {
      documentGeneration: overrides.documentGeneration || 1,
      observationRevision: rev,
      ambiguityCount: 0,
      entities: [
        { logicalId: 'elem_1', semanticRevision: elemRev, text: 'Live Button', role: 'button', tag: 'button' },
      ],
      views: [
        { regionId: 'rg_main', kind: 'landmark', role: 'main' },
      ],
      ...overrides.semanticState,
    },
    ...overrides,
  };
}

function acceptedProgramContext(overrides = {}) {
  return {
    goalId: 'goal_p6_live',
    goalRevision: 1,
    taskDependencies: {
      source: 'ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES',
      goalId: 'goal_p6_live',
      ledgerRevision: 1,
      ledgerDigest: 'sha256:' + 'a'.repeat(64),
      reasonDependencies: { entityIds: ['elem_critical'], viewIds: [], waitConditionIds: [], signalTypes: [] },
      continueDependencies: { entityIds: ['elem_1'], viewIds: ['rg_main'], waitConditionIds: [], signalTypes: [] },
    },
    ...overrides,
  };
}

test('Live VM host imports and uses reconcileVmEffectObservation7E from lib/reactive-vm-host-7e.js', async () => {
  const vmSource = await readFile(new URL('../supabase/functions/opera-agent-vm/index.ts', import.meta.url), 'utf8');
  assert.match(vmSource, /import\s*\{[^}]*reconcileVmEffectObservation7E[^}]*\}\s*from\s*"[\.\/]*lib\/reactive-vm-host-7e\.js"/);
  assert.match(vmSource, /reconcileVmEffectObservation7E\(/);
});

test('reconcileVmEffectObservation7E fails closed to RESET_REQUIRED and FULL_SNAPSHOT on cold start / missing continuity', () => {
  const identity = baseIdentity({ runId: 'cold_start_run_999' });
  const obs = baseObservation({ semanticDelta: { sourceRevision: 5, resultingRevision: 6, classification: 'UPDATE' } });
  const programCtx = acceptedProgramContext();

  const reconciled = reconcileVmEffectObservation7E(identity, obs, programCtx);
  assert.equal(reconciled.relevance.decision, 'REASON_REQUIRED');
  assert.equal(reconciled.relevance.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(reconciled.relevance.reasoningObservation.resetRequired, true);
  assert.equal(reconciled.relevance.reasoningObservation.continuity.status, 'RESET_REQUIRED');
  assert.equal(reconciled.relevance.reasoningObservation.resetReason, 'MISSING_CONTINUITY');
  assert.equal(reconciled.observation.page.text, 'Full document text preserved for VM evaluation and snapshot recovery.');
});

test('reconcileVmEffectObservation7E bootstraps on RESET and emits COMPACT_PATCH on contiguous updates with accepted context', () => {
  const identity = baseIdentity({ runId: 'run_p6_contiguous_1' });
  const programCtx = acceptedProgramContext();

  // 1. Cold start bootstrap observation
  const obs1 = baseObservation({
    elementRevision: 1,
    semanticDelta: { sourceRevision: 0, resultingRevision: 1, classification: 'RESET', completeSnapshotRequired: true, resetReason: 'INITIAL_LOAD', changes: [] },
  });
  const res1 = reconcileVmEffectObservation7E(identity, obs1, programCtx);
  assert.equal(res1.relevance.decision, 'REASON_REQUIRED');
  assert.equal(res1.relevance.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(res1.relevance.reasoningObservation.continuity.status, 'BOOTSTRAP');

  // 2. Contiguous observation -> APPLY_AND_CONTINUE with COMPACT_PATCH
  const obs2 = baseObservation({
    elementRevision: 2,
    semanticDelta: { sourceRevision: 1, resultingRevision: 2, classification: 'UPDATE', changes: [{ type: 'UPDATE', logicalId: 'elem_1', revision: 2 }] },
  });
  const res2 = reconcileVmEffectObservation7E(identity, obs2, programCtx);
  assert.equal(res2.relevance.decision, 'APPLY_AND_CONTINUE');
  assert.ok(res2.canonicalState);
});

test('reconcileVmEffectObservation7E enforces accepted task context and never fabricates dependencies', () => {
  const identity = baseIdentity({ runId: 'run_p6_context_test' });

  // Bootstrap first
  const obs1 = baseObservation({ elementRevision: 1, semanticDelta: { sourceRevision: 0, resultingRevision: 1, classification: 'RESET', completeSnapshotRequired: true, changes: [] } });
  reconcileVmEffectObservation7E(identity, obs1, acceptedProgramContext());

  // Unaccepted or missing task context forces REASON_REQUIRED
  const obs2 = baseObservation({ elementRevision: 2, semanticDelta: { sourceRevision: 1, resultingRevision: 2, changes: [{ type: 'UPDATE', logicalId: 'elem_1', revision: 2 }] } });

  const resMissing = reconcileVmEffectObservation7E(identity, obs2, { goalId: 'g1', goalRevision: 1 });
  assert.equal(resMissing.relevance.decision, 'REASON_REQUIRED');
  assert.equal(resMissing.relevance.relevance.contextStatus, 'MISSING');

  const resFabricated = reconcileVmEffectObservation7E(identity, obs2, { goalId: 'g1', goalRevision: 1, taskDependencies: { source: 'FABRICATED' } });
  assert.equal(resFabricated.relevance.decision, 'REASON_REQUIRED');
  assert.equal(resFabricated.relevance.relevance.contextStatus, 'INVALID');
});

test('Live MCP function metadata exhibits updated 1.6.0 version string and preserves all 18 tools and caps', async () => {
  const mcpSource = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  assert.match(mcpSource, /version:\s*"1\.6\.0"/);

  const toolNames = [
    'browser_status', 'run_browser_burst', 'list_tabs', 'open_url', 'activate_tab',
    'navigate_tab', 'close_tab', 'read_page', 'capture_page', 'find_elements',
    'click_element', 'fill_element', 'press_key', 'scroll_page', 'move_pointer',
    'click_at', 'drag_pointer', 'wheel_at',
  ];
  for (const name of toolNames) {
    assert.match(mcpSource, new RegExp(`server\\.registerTool\\("${name}"`));
  }
});
