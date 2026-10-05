// @last-edited: 2026-10-04 18:58 UTC+7.
// @title: performance-runtime-cutover - fail-closed cutover continuation gate.
// @state: Local continuation needs accepted task context and never fabricates dependencies.
// @dependencies: node:test, strict, promises, reactive-vm-host, reactive-vm.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reconcileVmEffectObservation } from '../lib/reactive-vm-host.js';
import { advanceReactiveVm, createReactiveVm } from '../lib/reactive-vm.js';

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

test('Live VM host imports and uses reconcileVmEffectObservation from lib/reactive-vm-host.js', async () => {
  const vmSource = await readFile(new URL('../supabase/functions/opera-agent-vm/index.ts', import.meta.url), 'utf8');
  assert.match(vmSource, /import\s*\{[^}]*reconcileVmEffectObservation[^}]*\}\s*from\s*"[\.\/]*lib\/reactive-vm-host\.js"/);
  assert.match(vmSource, /reconcileVmEffectObservation\(/);
});

test('reconcileVmEffectObservation fails closed to RESET_REQUIRED and FULL_SNAPSHOT on cold start / missing continuity', () => {
  const identity = baseIdentity({ runId: 'cold_start_run_999' });
  const obs = baseObservation({ semanticDelta: { sourceRevision: 5, resultingRevision: 6, classification: 'UPDATE' } });
  const programCtx = acceptedProgramContext();

  const reconciled = reconcileVmEffectObservation(identity, obs, programCtx);
  assert.equal(reconciled.relevance.decision, 'REASON_REQUIRED');
  assert.equal(reconciled.relevance.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(reconciled.relevance.reasoningObservation.resetRequired, true);
  assert.equal(reconciled.relevance.reasoningObservation.continuity.status, 'RESET_REQUIRED');
  assert.equal(reconciled.relevance.reasoningObservation.resetReason, 'MISSING_CONTINUITY');
  assert.equal(reconciled.observation.page.text, 'Full document text preserved for VM evaluation and snapshot recovery.');
});

test('reconcileVmEffectObservation enforces accepted task context and never fabricates dependencies', () => {
  const identity = baseIdentity({ runId: 'run_p6_context_test' });

  // Bootstrap first
  const obs1 = baseObservation({ elementRevision: 1, semanticDelta: { sourceRevision: 0, resultingRevision: 1, classification: 'RESET', completeSnapshotRequired: true, changes: [] } });
  reconcileVmEffectObservation(identity, obs1, acceptedProgramContext());

  // Unaccepted or missing task context forces REASON_REQUIRED and MISSING contextStatus
  const obs2 = baseObservation({ elementRevision: 2, semanticDelta: { sourceRevision: 1, resultingRevision: 2, changes: [{ type: 'UPDATE', logicalId: 'elem_1', revision: 2 }] } });

  const resMissing = reconcileVmEffectObservation(identity, obs2, { goalId: 'g1', goalRevision: 1 });
  assert.equal(resMissing.relevance.decision, 'REASON_REQUIRED');
  assert.equal(resMissing.relevance.relevance.contextStatus, 'MISSING');

  const resFabricated = reconcileVmEffectObservation(identity, obs2, { goalId: 'g1', goalRevision: 1, taskDependencies: { source: 'FABRICATED' } });
  assert.equal(resFabricated.relevance.decision, 'REASON_REQUIRED');
  assert.equal(resFabricated.relevance.relevance.contextStatus, 'MISSING');
});

test('Adversarial: caller-crafted program with self-consistent programDigest and fake ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES is rejected and returns REASON_REQUIRED', () => {
  const identity = baseIdentity({ runId: 'run_p6_adversarial_1' });
  const programCtx = acceptedProgramContext({
    taskDependencies: {
      source: 'ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES',
      goalId: 'goal_p6_live',
      ledgerRevision: 1,
      ledgerDigest: 'sha256:' + 'a'.repeat(64),
      reasonDependencies: { entityIds: [], viewIds: [], waitConditionIds: [], signalTypes: [] },
      continueDependencies: { entityIds: ['elem_1'], viewIds: ['rg_main'], waitConditionIds: [], signalTypes: [] },
    },
  });

  // 1. Bootstrap
  const obs1 = baseObservation({
    elementRevision: 1,
    semanticDelta: { sourceRevision: 0, resultingRevision: 1, classification: 'RESET', completeSnapshotRequired: true, resetReason: 'INITIAL_LOAD', changes: [] },
  });
  reconcileVmEffectObservation(identity, obs1, programCtx);

  // 2. Caller attempts to obtain APPLY_AND_CONTINUE using caller-supplied taskDependencies
  const obs2 = baseObservation({
    elementRevision: 2,
    semanticDelta: { sourceRevision: 1, resultingRevision: 2, classification: 'UPDATE', changes: [{ type: 'UPDATE', logicalId: 'elem_1', revision: 2 }] },
  });

  const res2 = reconcileVmEffectObservation(identity, obs2, programCtx);
  // Must reject caller-asserted taskDependencies as unauthoritative (MISSING server context) and return REASON_REQUIRED
  assert.equal(res2.relevance.decision, 'REASON_REQUIRED');
  assert.equal(res2.relevance.relevance.contextStatus, 'MISSING');
  assert.notEqual(res2.relevance.decision, 'APPLY_AND_CONTINUE');
});


async function cutoverVmFixture(runId = 'p6-cutover-gate') {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/reactive-vm-programs-v1.json', import.meta.url), 'utf8'));
  const program = structuredClone(fixture.valid[0]);
  let state = await createReactiveVm(program, {
    runId,
    tenantId: 'tenant-test',
    goalRevision: 1,
    logicalNowMs: 1000,
    deadlineAtMs: 301000,
    initialBindings: {},
  });
  let step = await advanceReactiveVm(program, state, { logicalNowMs: 1001 });
  state = step.state;
  if (step.transition.kind !== 'EFFECT_REQUEST') {
    step = await advanceReactiveVm(program, state, { logicalNowMs: 1002 });
    state = step.state;
  }
  assert.equal(step.transition.kind, 'EFFECT_REQUEST');
  return { program, state, request: step.transition.request };
}

function cutoverEffect(request, performanceCutover) {
  return {
    requestDigest: request.requestDigest,
    method: request.method,
    ok: true,
    provenance: {
      tenantId: 'tenant-test',
      deviceId: 'device-test',
      tabId: 7,
      documentGeneration: 'doc-gen-1',
    },
    value: {
      tabId: 7,
      semanticRevision: 2,
      performanceCutover,
    },
  };
}

test('cutover permits local VM continuation only for a valid APPLY_AND_CONTINUE decision', async () => {
  const { program, state, request } = await cutoverVmFixture('p6-apply-only');
  const advanced = await advanceReactiveVm(program, state, {
    logicalNowMs: 1003,
    effectResult: cutoverEffect(request, {
      decision: 'APPLY_AND_CONTINUE',
      reasoningWakeRequired: false,
      reasoningObservation: null,
      contextStatus: 'ACCEPTED',
      canonicalRevision: 2,
    }),
  });
  assert.equal(advanced.transition.kind, 'EFFECT_ACCEPTED');
  assert.notEqual(advanced.state.status, 'SUSPENDED');
});

test('cutover fails closed for IGNORE, unknown, malformed, and inconsistent decisions', async () => {
  const cases = [
    ['IGNORE_FOR_TASK', { decision: 'IGNORE_FOR_TASK', reasoningWakeRequired: false, reasoningObservation: null }],
    ['UNKNOWN_DECISION', { decision: 'UNKNOWN_DECISION', reasoningWakeRequired: false, reasoningObservation: null }],
    ['MISSING_DECISION', { reasoningWakeRequired: false, reasoningObservation: null }],
    ['INCONSISTENT_APPLY_WAKE', { decision: 'APPLY_AND_CONTINUE', reasoningWakeRequired: true, reasoningObservation: null }],
    ['INCONSISTENT_APPLY_OBSERVATION', { decision: 'APPLY_AND_CONTINUE', reasoningWakeRequired: false, reasoningObservation: { kind: 'COMPACT_PATCH' } }],
    ['INCONSISTENT_REASON_FLAG', { decision: 'REASON_REQUIRED', reasoningWakeRequired: false, reasoningObservation: null }],
  ];

  for (const [label, performanceCutover] of cases) {
    const { program, state, request } = await cutoverVmFixture(`p6-deny-${label}`);
    const advanced = await advanceReactiveVm(program, state, {
      logicalNowMs: 1003,
      effectResult: cutoverEffect(request, performanceCutover),
    });
    assert.equal(advanced.state.status, 'SUSPENDED', label);
    assert.notEqual(advanced.transition.kind, 'EFFECT_ACCEPTED', label);
  }
});

test('cutover preserves explicit RESET_REQUIRED and REASON_REQUIRED fail-closed behavior', async () => {
  {
    const { program, state, request } = await cutoverVmFixture('p6-reset');
    const advanced = await advanceReactiveVm(program, state, {
      logicalNowMs: 1003,
      effectResult: cutoverEffect(request, {
        decision: 'REASON_REQUIRED',
        reasoningWakeRequired: true,
        reasoningObservation: { kind: 'FULL_SNAPSHOT', resetRequired: true, resetReason: 'MISSING_CONTINUITY' },
      }),
    });
    assert.equal(advanced.state.status, 'SUSPENDED');
    assert.equal(advanced.state.suspension.reason, 'STALE_TARGET');
  }
  {
    const { program, state, request } = await cutoverVmFixture('p6-reason');
    const advanced = await advanceReactiveVm(program, state, {
      logicalNowMs: 1003,
      effectResult: cutoverEffect(request, {
        decision: 'REASON_REQUIRED',
        reasoningWakeRequired: true,
        reasoningObservation: { kind: 'COMPACT_PATCH', resetRequired: false },
      }),
    });
    assert.equal(advanced.state.status, 'SUSPENDED');
    assert.equal(advanced.state.suspension.reason, 'NEEDS_MODEL');
  }
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
