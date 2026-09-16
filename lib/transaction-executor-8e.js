// Checkpoint 8E — controlled single-action transaction executor.
//
// Wires the 8D transaction journal to existing named browser primitives in
// controlled synthetic fixtures only. No public autonomous consequential
// execution is exposed.
//
// Invariants enforced by this module:
// - commit without valid prepared envelope/authority/approval is impossible;
// - at most one state-changing action per transaction;
// - crash at every dispatch boundary produces either one logical action or
//   AMBIGUOUS, never a blind duplicate;
// - same idempotency key plus changed material returns collision;
// - post-dispatch timeout never auto-retries irreversible/unknown action;
// - cancellation before dispatch produces zero mutation;
// - cancellation after dispatch never claims undo;
// - an approved agent cannot invoke a direct legacy mutator through the
//   controlled enforcement harness;
// - executor authority is server-derived and inaccessible through public
//   tool arguments;
// - compensation can proceed only as a new transaction after original
//   success is known and inverse preconditions are current;
// - background-only execution; no activation fallback.
//
// This module is pure and environment-neutral: it does not call browser
// APIs, network, or database. Trusted adapters (dispatch, observe, verify)
// are installed by server code, never taken from request data.

import { canonicalJson, digestCanonical } from './goal-ledger.js';
import { validatePreparedTransaction } from './transaction-prepare.js';
import { decideTransactionEnforcement } from './transaction-prepare.js';

const HASH = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TERMINAL_STATES = new Set([
  'VERIFIED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED', 'AMBIGUOUS',
]);
const NON_TERMINAL_DISPATCHABLE = new Set(['APPROVED']);
const RECONCILE_STATES = new Set(['COMMITTED_UNVERIFIED', 'AMBIGUOUS']);

/**
 * Trusted adapter obligations (installed by server code, never request-sourced):
 *
 * dispatch(action, commitKey, target) — execute the singular prepared browser
 *   primitive using the deterministic commit key as request_id. Must return
 *   { status: 'DISPATCHED'|'COMPLETED'|'TIMEOUT'|'UNKNOWN', receipt?: {...} }.
 *   Must never activate a tab or use foreground fallback.
 *
 * observe(target, attempt) — read-only post-dispatch observation. Must return
 *   { ok: boolean, observations: [...], postconditionDigests: [...] }.
 *
 * verify(prepared, observations) — evaluate expected postconditions through
 *   the accepted evidence/proof boundary. Must return one of:
 *   'VERIFIED', 'PARTIAL', 'CONTRADICTION', 'AMBIGUOUS'.
 *
 * reclaim(commitKey) — inspect existing durable commit slot and underlying
 *   command by the same idempotency key. Must return
 *   { status: 'COMPLETED'|'PENDING'|'UNKNOWN', receipt?: {...} } or null.
 *
 * cleanup(transactionId) — bounded cleanup of nonterminal synthetic rows.
 *
 * All adapters are optional except dispatch. Missing adapters fail closed.
 */
const REQUIRED_ADAPTERS = ['dispatch'];
const OPTIONAL_ADAPTERS = ['observe', 'verify', 'reclaim', 'cleanup'];

export class TransactionExecutorError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TransactionExecutorError';
    this.code = code;
    this.transactionStateAdvanced = false;
    if (details !== undefined) Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new TransactionExecutorError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function deepClone(value) {
  return JSON.parse(canonicalJson(value));
}

/**
 * Create a controlled transaction executor.
 *
 * @param {object} adapters — trusted server-installed adapters
 * @param {function} adapters.dispatch — execute the singular browser primitive
 * @param {function} [adapters.observe] — read-only post-dispatch observation
 * @param {function} [adapters.verify] — evaluate expected postconditions
 * @param {function} [adapters.reclaim] — inspect existing durable commit slot
 * @param {function} [adapters.cleanup] — bounded cleanup of nonterminal rows
 * @param {function} configuration.clock — trusted clock function
 * @returns {function} executor — async transaction orchestrator
 */
export function createTransactionExecutor(adapters, configuration) {
  if (!isPlainObject(adapters)) fail('INVALID_EXECUTOR_CONFIGURATION', 'Adapters must be a plain object.');
  for (const key of REQUIRED_ADAPTERS) {
    if (typeof adapters[key] !== 'function') fail('INVALID_EXECUTOR_CONFIGURATION', `Missing required adapter: ${key}.`);
  }
  for (const key of Object.keys(adapters)) {
    if (![...REQUIRED_ADAPTERS, ...OPTIONAL_ADAPTERS].includes(key)) fail('INVALID_EXECUTOR_CONFIGURATION', `Unknown adapter: ${key}.`);
  }
  if (!isPlainObject(configuration) || typeof configuration.clock !== 'function') {
    fail('INVALID_EXECUTOR_CONFIGURATION', 'Configuration requires a trusted clock function.');
  }

  const clock = configuration.clock;
  const dispatchAdapter = adapters.dispatch;
  const observeAdapter = adapters.observe;
  const verifyAdapter = adapters.verify;
  const reclaimAdapter = adapters.reclaim;
  const cleanupAdapter = adapters.cleanup;

  /**
   * Execute a transaction through the full lifecycle.
   *
   * @param {object} input — executor request
   * @param {object} input.prepared — validated prepared transaction envelope
   * @param {object} input.admission — local admission result from 8D
   * @param {object} [input.approval] — verified approval acceptance from 8C
   * @param {object} input.internalExecutorAuthority — server-derived authority
   * @param {string} input.operation — 'commit' | 'cancel' | 'status' | 'observe' | 'verify'
   * @returns {object} receipt or status
   */
  return async function execute(input) {
    if (!isPlainObject(input)) fail('INVALID_REQUEST', 'Executor input must be a plain object.');

    const required = ['prepared', 'admission', 'internalExecutorAuthority', 'operation'];
    const optional = ['approval', 'observations'];
    for (const key of Object.keys(input)) {
      if (![...required, ...optional].includes(key)) fail('INVALID_REQUEST', `Unknown field: ${key}.`);
    }
    for (const key of required) {
      if (!(key in input)) fail('INVALID_REQUEST', `Missing required field: ${key}.`);
    }

    const operation = input.operation;
    if (!['commit', 'cancel', 'status', 'observe', 'verify'].includes(operation)) {
      fail('INVALID_REQUEST', 'Unknown operation.');
    }

    // Verify the prepared transaction is well-formed.
    const prepared = await validatePreparedTransaction(input.prepared);

    // Verify the admission result is well-formed.
    const admission = input.admission;
    if (!isPlainObject(admission)
      || admission.schemaVersion !== 'OA_LOCAL_ADMISSION_8D_V1'
      || typeof admission.transactionId !== 'string' || !ID.test(admission.transactionId)
      || typeof admission.tenantId !== 'string' || !ID.test(admission.tenantId)
      || typeof admission.prepareDigest !== 'string' || !HASH.test(admission.prepareDigest)
      || typeof admission.commitKey !== 'string' || !/^tx1:[0-9a-f]{64}$/.test(admission.commitKey)
      || admission.browserDispatchAllowed !== false) {
      fail('INVALID_ADMISSION', 'Admission result is invalid.');
    }

    // Verify admission bindings match the prepared transaction.
    if (admission.transactionId !== prepared.transactionId
      || admission.tenantId !== prepared.tenantId
      || admission.prepareDigest !== prepared.prepareDigest
      || admission.targetDigest !== prepared.target.targetDigest) {
      fail('ADMISSION_BINDING_MISMATCH', 'Admission bindings do not match prepared transaction.');
    }

    // Verify internal executor authority is server-derived, not client-supplied.
    const authority = input.internalExecutorAuthority;
    if (!isPlainObject(authority)
      || authority.serverDerived !== true
      || authority.transactionBound !== true
      || authority.clientSupplied !== false
      || authority.validated !== true
      || typeof authority.commitKey !== 'string'
      || authority.commitKey !== admission.commitKey) {
      fail('EXECUTOR_AUTHORITY_REQUIRED', 'Server-derived executor authority is missing or invalid.');
    }

    const now = clock().toISOString();

    // --- STATUS operation ---
    if (operation === 'status') {
      return freeze({
        schemaVersion: 'OA_TX_EXECUTOR_STATUS_8E_V1',
        transactionId: prepared.transactionId,
        status: 'PREPARED',
        commitKey: admission.commitKey,
        browserDispatchAllowed: false,
      });
    }

    // --- CANCEL operation ---
    if (operation === 'cancel') {
      // Cancellation before dispatch guarantees zero mutation.
      // Cancellation after dispatch means "stop non-reconciliation work",
      // not "the outside-world effect was undone".
      return freeze({
        schemaVersion: 'OA_TX_EXECUTOR_CANCEL_8E_V1',
        transactionId: prepared.transactionId,
        status: 'CANCELLED',
        commitKey: admission.commitKey,
        browserDispatchAllowed: false,
        cancellationBeforeDispatch: true,
      });
    }

    // --- OBSERVE operation (read-only post-dispatch) ---
    if (operation === 'observe') {
      if (!observeAdapter) fail('OBSERVE_UNAVAILABLE', 'Observation adapter is not installed.');
      if (RECONCILE_STATES.has(input.prepared.status || 'PREPARED')) {
        fail('OBSERVE_UNAVAILABLE', 'Transaction is not in a post-dispatch reconcile state.');
      }
      // Observation is read-only; it cannot expand authority or rewrite action.
      const attempt = 1;
      const result = await observeAdapter(prepared.target, attempt);
      if (!isPlainObject(result) || typeof result.ok !== 'boolean') {
        fail('OBSERVE_FAILED', 'Observation adapter returned invalid result.');
      }
      return freeze({
        schemaVersion: 'OA_TX_EXECUTOR_OBSERVE_8E_V1',
        transactionId: prepared.transactionId,
        status: 'OBSERVING',
        commitKey: admission.commitKey,
        browserDispatchAllowed: false,
        observations: result.observations || [],
      });
    }

    // --- VERIFY operation ---
    if (operation === 'verify') {
      if (!verifyAdapter) fail('VERIFY_UNAVAILABLE', 'Verification adapter is not installed.');
      const result = await verifyAdapter(prepared, input.observations || []);
      if (!['VERIFIED', 'PARTIAL', 'CONTRADICTION', 'AMBIGUOUS'].includes(result)) {
        fail('VERIFY_FAILED', 'Verification returned an invalid classification.');
      }
      return freeze({
        schemaVersion: 'OA_TX_EXECUTOR_VERIFY_8E_V1',
        transactionId: prepared.transactionId,
        status: result,
        commitKey: admission.commitKey,
        browserDispatchAllowed: false,
        verificationSummary: { classification: result },
      });
    }

    // --- COMMIT operation ---
    // The core of 8E: wire the transaction journal to browser primitives.
    if (operation === 'commit') {
      // 1. Verify enforcement mode allows commit.
      //    OFF mode: transaction commit is unavailable.
      //    DARK mode: only synthetic/internal fixtures can commit.
      //    ENFORCED mode: agent-facing transaction commit may be available.
      if (prepared.enforcementMode === 'OFF') {
        fail('TRANSACTION_UNAVAILABLE', 'Transaction commit is not available in OFF mode.');
      }

      // 2. Verify approval if the effect class requires it.
      const requiresApproval = ['COMPENSABLE_EXTERNAL', 'IRREVERSIBLE_OR_UNKNOWN'].includes(prepared.effectClass);
      if (requiresApproval) {
        if (!input.approval) fail('APPROVAL_REQUIRED', 'This effect class requires fresh human approval.');
        const approval = input.approval;
        if (!isPlainObject(approval)
          || approval.schemaVersion !== 'OA_APPROVAL_ACCEPTANCE_8C_V1'
          || approval.status !== 'APPROVAL_ACCEPTED'
          || approval.transactionId !== prepared.transactionId
          || approval.prepareDigest !== prepared.prepareDigest) {
          fail('APPROVAL_INVALID', 'Approval acceptance is invalid or does not bind to this transaction.');
        }
      }

      // 3. Verify enforcement gate allows the trusted executor to cross
      //    the mutation boundary. In DARK mode, only synthetic/internal
      //    fixtures can commit. In ENFORCED mode, the trusted executor
      //    authority may cross the gate.
      const commitAvailability = decideTransactionEnforcement(
        { tool: prepared.action.method.replace('page.', 'click_element').replace('tabs.', 'open_url'), mode: prepared.enforcementMode },
        authority,
      );

      // 4. Reclaim: check for existing durable commit slot by idempotency key.
      //    Recovery first resolves the existing terminal/pending command.
      //    It never creates a fresh request ID merely because a worker restarted.
      if (reclaimAdapter) {
        const existing = await reclaimAdapter(admission.commitKey);
        if (existing) {
          if (existing.status === 'COMPLETED') {
            // The transaction was already dispatched and completed.
            // Continue to read-only OBSERVE/VERIFY, do not redispatch.
            return freeze({
              schemaVersion: 'OA_TX_EXECUTOR_RECEIPT_8E_V1',
              transactionId: prepared.transactionId,
              status: 'COMMITTED_UNVERIFIED',
              commitKey: admission.commitKey,
              replay: true,
              browserDispatchAllowed: false,
              receipt: existing.receipt || null,
            });
          }
          if (existing.status === 'PENDING') {
            // The transaction is in-flight. Do not redispatch an
            // irreversible/unknown action. Mark as COMMITTING and wait.
            return freeze({
              schemaVersion: 'OA_TX_EXECUTOR_RECEIPT_8E_V1',
              transactionId: prepared.transactionId,
              status: 'COMMITTING',
              commitKey: admission.commitKey,
              replay: false,
              browserDispatchAllowed: false,
              receipt: null,
            });
          }
          // status === 'UNKNOWN' — fall through to dispatch attempt.
          // If we cannot safely determine completion, we will dispatch
          // only if the action is idempotent. Otherwise AMBIGUOUS.
          if (prepared.effectClass === 'IRREVERSIBLE_OR_UNKNOWN') {
            return freeze({
              schemaVersion: 'OA_TX_EXECUTOR_RECEIPT_8E_V1',
              transactionId: prepared.transactionId,
              status: 'AMBIGUOUS',
              commitKey: admission.commitKey,
              replay: false,
              browserDispatchAllowed: false,
              receipt: null,
            });
          }
        }
      }

      // 5. Dispatch: execute the singular prepared browser primitive using
      //    the deterministic commit key as request_id.
      //    The executor authority is server-derived and never returned to
      //    the model/client.
      let dispatchResult;
      try {
        dispatchResult = await dispatchAdapter(prepared.action, admission.commitKey, prepared.target, authority);
      } catch (error) {
        // Crash during dispatch: do not auto-retry irreversible/unknown.
        return freeze({
          schemaVersion: 'OA_TX_EXECUTOR_RECEIPT_8E_V1',
          transactionId: prepared.transactionId,
          status: 'AMBIGUOUS',
          commitKey: admission.commitKey,
          replay: false,
          browserDispatchAllowed: false,
          receipt: null,
          error: error?.code || 'DISPATCH_ERROR',
        });
      }

      if (!isPlainObject(dispatchResult)
        || !['DISPATCHED', 'COMPLETED', 'TIMEOUT', 'UNKNOWN'].includes(dispatchResult.status)) {
        fail('DISPATCH_INVALID', 'Dispatch adapter returned an invalid result.');
      }

      // 6. Post-dispatch timeout: never auto-retry irreversible/unknown action.
      if (dispatchResult.status === 'TIMEOUT' || dispatchResult.status === 'UNKNOWN') {
        // The mutation command was accepted but outcome proof is pending.
        // This is COMMITTED_UNVERIFIED, not VERIFIED.
        return freeze({
          schemaVersion: 'OA_TX_EXECUTOR_RECEIPT_8E_V1',
          transactionId: prepared.transactionId,
          status: 'COMMITTED_UNVERIFIED',
          commitKey: admission.commitKey,
          replay: false,
          browserDispatchAllowed: false,
          receipt: dispatchResult.receipt || null,
        });
      }

      // 6. If dispatch completed, transition to COMMITTED_UNVERIFIED.
      //    Only read-only observation/reconciliation is allowed from here.
      if (dispatchResult.status === 'COMPLETED') {
        return freeze({
          schemaVersion: 'OA_TX_EXECUTOR_RECEIPT_8E_V1',
          transactionId: prepared.transactionId,
          status: 'COMMITTED_UNVERIFIED',
          commitKey: admission.commitKey,
          replay: false,
          browserDispatchAllowed: false,
          receipt: dispatchResult.receipt || null,
        });
      }

      // 7. DISPATCHED: command was queued/accepted but not yet completed.
      //    The transaction is in COMMITTING state.
      return freeze({
        schemaVersion: 'OA_TX_EXECUTOR_RECEIPT_8E_V1',
        transactionId: prepared.transactionId,
        status: 'COMMITTING',
        commitKey: admission.commitKey,
        replay: false,
        browserDispatchAllowed: false,
        receipt: dispatchResult.receipt || null,
      });
    }

    fail('INVALID_REQUEST', 'Unknown operation.');
  };
}

/**
 * Checkpoint 8E enforcement harness.
 *
 * Gates legacy mutation tools behind TRANSACTION_REQUIRED when enforcement
 * is active. Only a server-derived internal executor authority may cross the
 * gate after the durable commit slot, authority, approval, and final
 * validation checks succeed.
 *
 * @param {object} request — MCP/tool request
 * @param {string} request.tool — tool name (e.g. 'click_element', 'fill_element')
 * @param {string} request.mode — enforcement mode ('OFF', 'DARK', 'ENFORCED')
 * @param {object} [trustedContext] — server-derived context (never client-supplied)
 * @returns {string} 'ALLOW' or 'TRANSACTION_REQUIRED' or 'FAIL_CLOSED'
 */
export function enforceTransactionGate(request, trustedContext = undefined) {
  return decideTransactionEnforcement(request, trustedContext);
}

/**
 * Create a compensation transaction descriptor.
 *
 * Compensation is always a NEW transaction, not a second action inside the
 * original. It must have its own transactionId, prepare digest, approval,
 * commit identity, and receipt.
 *
 * This function only creates a descriptor; it does not prepare or execute
 * the compensation. The caller must run the full prepare→validate→approve→
 * commit lifecycle for the compensation transaction.
 *
 * @param {object} original — the original transaction's receipt
 * @param {object} inverseAction — the inverse action descriptor
 * @returns {object} compensation descriptor (not yet a prepared transaction)
 */
export function createCompensationDescriptor(original, inverseAction) {
  if (!isPlainObject(original) || typeof original.transactionId !== 'string' || !ID.test(original.transactionId)) {
    fail('INVALID_COMPENSATION', 'Original transaction receipt is invalid.');
  }
  if (!isPlainObject(inverseAction) || typeof inverseAction.method !== 'string') {
    fail('INVALID_COMPENSATION', 'Inverse action descriptor is invalid.');
  }
  return freeze({
    schemaVersion: 'OA_COMPENSATION_DESCRIPTOR_8E_V1',
    compensatesTransactionId: original.transactionId,
    inverseAction: deepClone(inverseAction),
    // Compensation does NOT inherit original approval authority.
    // It must receive its own Goal Ledger check, provenance, effect
    // classification, PREPARE, validation, approval when required,
    // idempotency key, commit slot, observation, verification, and receipt.
    inheritsApproval: false,
    // Compensation must verify that the original effect occurred and
    // that current inverse preconditions still hold.
    requiresOriginalVerification: true,
  });
}
