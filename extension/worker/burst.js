// @last-edited: 2026-10-09 UTC+7.
// @title: burst — run a burst of actions against a tab, bounded by time and result size.
// @state: owns MAX_BURST_RESULT_BYTES; background.js reads runBurst through this export.
// @dependencies: action-focus, tab-content, background, log, protocol, debugger-session.

import { log } from '../lib/log.js';
import {
  BURST_ACTION_METHODS,
  BURST_MAX_TIMEOUT_MS,
  burstCrossTabRef,
  burstStaleRef,
  normalizeError,
} from '../lib/protocol.js';
import { releaseDebuggerSession } from '../lib/debugger-session.js';
import { resolveTabId } from './tab-content.js';
import { executionMode, burstStepParams, notReadyError } from './action-focus.js';
import { dispatch } from '../background.js';

const MAX_BURST_RESULT_BYTES = 256 * 1024;

function burstResultSize(results) {
  try { return new TextEncoder().encode(JSON.stringify(results)).byteLength; } catch (error) { log.debug('BURST_RESULT_SIZE_FAILED', error?.message || String(error)); return Number.POSITIVE_INFINITY; }
}

export async function runBurst(params, outerContext = {}) {
  const tabId = await resolveTabId(params);
  const mode = executionMode(params);
  const startedAt = performance.now();
  const deadline = Math.min(outerContext.deadline || Date.now() + BURST_MAX_TIMEOUT_MS, Date.now() + BURST_MAX_TIMEOUT_MS);
  const context = { ...outerContext, deadline, debuggerSession: { tabId, attached: false } };
  const results = [];

  // The three step failures below differ only in their error. The envelope
  // around them was written out three times, so a field added to a burst
  // failure had to be remembered in three places.
  const stepFailure = (index, step, error) => ({
    ok: false,
    tabId,
    completedSteps: index,
    failedAt: index,
    failedAction: step.action,
    executionMode: mode,
    error,
    results,
    timingMs: Math.round((performance.now() - startedAt) * 100) / 100
  });

  // Phase D: the tab the current step runs against. It starts at the burst tab
  // and only moves when a step names its own tabId, so every existing caller
  // behaves exactly as before.
  let activeTabId = tabId;

  try {
    for (let index = 0; index < params.steps.length; index += 1) {
      const step = params.steps[index];
      const stepTabId = step.tabId === undefined || step.tabId === null ? activeTabId : step.tabId;
      const switched = stepTabId !== activeTabId;
      if (switched) activeTabId = stepTabId;
      const remainingMs = deadline - Date.now();

      // A burst timeout is an unknown outcome, not a failure: steps that already
      // ran may have taken effect, so their evidence must reach the caller.
      if (remainingMs < 50) {
        return {
          ok: false,
          tabId,
          timedOut: true,
          completedSteps: results.length,
          failedAt: index,
          executionMode: mode,
          error: { code: 'BURST_TIMEOUT', message: 'Burst timeout before this step; completed steps may have taken effect.' },
          results,
          timingMs: Math.round((performance.now() - startedAt) * 100) / 100
        };
      }
      const method = BURST_ACTION_METHODS[step.action];
      const stepStartedAt = performance.now();

      // A refFromStep binding may only be consumed on the tab that minted it. A
      // ref is a live handle into one document, so reusing one across tabs is
      // exactly the stale-reference failure the ref-recovery work exists to
      // prevent. The comparison is against the source step's recorded tab, not
      // the switch flag: a step that stays on the already-active tab must also
      // refuse a ref minted elsewhere.
      if (step.refFromStep !== undefined && step.refFromStep !== null && burstCrossTabRef(results, step.refFromStep, stepTabId)) {
        return stepFailure(index, step, {
          code: 'BURST_CROSS_TAB_REF',
          message: `Step ${index} switches tab and cannot consume a ref minted by step ${step.refFromStep} on another tab. Re-find on the target tab.`
        });
      }
      if (step.refFromStep !== undefined && step.refFromStep !== null && burstStaleRef(results, step.refFromStep, stepTabId)) {
        return stepFailure(index, step, {
          code: 'BURST_STALE_REF',
          message: `Step ${index} cannot consume a ref minted by step ${step.refFromStep} before a navigation on this tab replaced the document. Re-find after the navigation.`
        });
      }
      try {
        const result = await dispatch(method, burstStepParams(step, stepTabId, remainingMs, mode, results), context);
        if ((step.action === 'click' || step.action === 'fill') && step.refFromStep !== undefined && step.refFromStep !== null
          && result && typeof result === 'object' && result.ok === true) {
          result.resolvedFrom = `step:${step.refFromStep}`;
        }
        if (step.action === 'wait' && result?.ok === false) throw new Error(String(result.error || 'wait_for timeout'));
        const entry = { index, action: step.action, tabId: stepTabId, ok: true, timingMs: Math.round((performance.now() - stepStartedAt) * 100) / 100, result };
        if (entry.tabId !== tabId) entry.switchedTab = true;
        if (burstResultSize([...results, entry]) > MAX_BURST_RESULT_BYTES) throw new Error(`Burst result exceeds ${MAX_BURST_RESULT_BYTES} bytes.`);
        results.push(entry);
      } catch (error) {
        let burstError = normalizeError(error);
        if (error && error.code === 'TARGET_NOT_READY') {
          burstError = notReadyError(error);
        }
        return stepFailure(index, step, burstError);
      }
    }
    return {
      ok: true,
      tabId,
      executionMode: mode,
      completedSteps: results.length,
      results,
      timingMs: Math.round((performance.now() - startedAt) * 100) / 100
    };
  } finally {
    await releaseDebuggerSession(context.debuggerSession, log);
  }
}
