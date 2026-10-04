// @last-edited: 2026-10-04 11:10 UTC.
// @title: reactive-vm-7d — vm-7d — Shared pure module.
// @context: Shared pure module, server and extension.
// @state: remove five dead exports and generalize the dead-export guard.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: goal-ledger, proof-engine, reactive-vm, reactive-vm-7c.

import { canonicalJson, digestCanonical } from './goal-ledger.js';
import { createEvidence } from './proof-engine.js';
import {
  ReactiveVmError,
  evaluateReactiveExpression,
  validateReactiveProgram,
} from './reactive-vm.js';
import {
  advanceReactiveVm7C,
  createReactiveVm7C,
  validateReactiveProgram7C,
} from './reactive-vm-7c.js';

const STATE_VERSION_7C = 'OA_REACTIVE_VM_STATE_7C_V1';
const STATE_VERSION = 'OA_REACTIVE_VM_STATE_7D_V1';
const COLLECTION_VERSION = 'OA_VM_COLLECTION_V1';
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const TERMINAL_STATUSES = new Set(['RETURNED', 'SUSPENDED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const EXECUTABLE_7D_NODES = new Set([
  'SEQUENCE', 'IF', 'LOOP', 'UNTIL', 'WAIT_EVENT', 'ASSERT', 'COLLECT', 'DEDUP', 'RETRY', 'RETURN', 'COMMAND', 'SUSPEND',
]);
const SCOPE_KINDS = new Set(['LOADED_DOM', 'VISIBLE_VIEWPORT', 'DECLARED_BOUNDED_FEED', 'OBSERVED_STATE', 'SCREENSHOT']);
const OBSERVATION_KINDS = new Set(['DIRECT_OBSERVATION', 'SCREENSHOT', 'BOUNDARY_OBSERVATION']);
const DEPENDENCY_KINDS = new Set(['ENTITY_SET', 'SCROLL', 'VIEWPORT', 'ZOOM', 'DOCUMENT']);
const CANONICAL_KEY_FIELDS = new Set(['logicalId', 'canonicalId']);
const FINGERPRINT_FIELDS = new Set(['semanticFingerprint', 'identityFingerprint', 'bindingHash']);
const WEAK_KEY_FIELDS = new Set([
  'name', 'label', 'text', 'x', 'y', 'width', 'height', 'rect', 'inViewport',
  'geometryRevision', 'index', 'position',
]);
const SECRET_FIELD = /(?:password|passcode|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|payment.?data|pairing.?code|signing.?key)/i;
const SECRET_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,})/;

export { ReactiveVmError };

function fail(code, message, details) {
  throw new ReactiveVmError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlainObject(value, path, code = 'INVALID_SEMANTICS') {
  if (!isPlainObject(value)) fail(code, `${path} must be a plain object.`);
}

function assertExactKeys(value, required, optional, path, code = 'INVALID_SEMANTICS') {
  assertPlainObject(value, path, code);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${path}.${key} is not allowed.`);
  }
  for (const key of required) {
    if (!(key in value)) fail(code, `${path}.${key} is required.`);
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function assertSafeInteger(value, path, min, max, code = 'INVALID_SEMANTICS') {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code, `${path} is outside its bounds.`);
}

function cloneJson(value, path = '$') {
  try {
    return JSON.parse(canonicalJson(value));
  } catch {
    fail('INVALID_SEMANTICS', `${path} must be acyclic canonical JSON data.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertNoSensitive(value, path = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail('SENSITIVE_VALUE', `${path} contains a secret-like value.`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('INVALID_SEMANTICS', `${path} contains a cycle.`);
  seen.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [key, child] of entries) {
    if (!Array.isArray(value) && SECRET_FIELD.test(key)) fail('SENSITIVE_VALUE', `${path}.${key} is a forbidden sensitive field.`);
    assertNoSensitive(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function assertSafeBindingName(value, path) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value) || FORBIDDEN_PATH_SEGMENTS.has(value)) {
    fail('INVALID_SEMANTICS', `${path} is not a safe binding name.`);
  }
}

function nodeAtPath(program, path) {
  if (!Array.isArray(path) || path.length < 1 || path[0] !== 'root') fail('INVALID_SEMANTICS', 'VM cursor path is invalid.');
  let current = program;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || !Number.isSafeInteger(segment) || segment < 0 || segment >= current.length) {
        fail('INVALID_SEMANTICS', 'VM cursor index is invalid.');
      }
      current = current[segment];
      continue;
    }
    if (typeof segment !== 'string' || FORBIDDEN_PATH_SEGMENTS.has(segment)
        || !Object.prototype.hasOwnProperty.call(current, segment)) {
      fail('INVALID_SEMANTICS', 'VM cursor segment is invalid.');
    }
    current = current[segment];
  }
  if (!isPlainObject(current) || typeof current.type !== 'string') fail('INVALID_SEMANTICS', 'VM cursor does not reference an instruction.');
  return current;
}

function mapNodeFor7C(node) {
  if (node.type === 'COLLECT' || node.type === 'DEDUP') {
    return { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' };
  }
  if (node.type === 'SEQUENCE') return { ...node, children: node.children.map(mapNodeFor7C) };
  if (node.type === 'IF') {
    return {
      ...node,
      then: mapNodeFor7C(node.then),
      ...(node.else === undefined ? {} : { else: mapNodeFor7C(node.else) }),
    };
  }
  if (node.type === 'LOOP' || node.type === 'UNTIL' || node.type === 'RETRY') {
    return { ...node, body: mapNodeFor7C(node.body) };
  }
  return cloneJson(node);
}

async function shadowProgramFor7C(program) {
  const shadow = cloneJson(program);
  shadow.root = mapNodeFor7C(program.root);
  shadow.programDigest = '';
  const { programDigest: _ignored, ...body } = shadow;
  shadow.programDigest = await digestCanonical(body);
  return shadow;
}

function walk7DNode(node, budgets, path = 'program.root') {
  if (!EXECUTABLE_7D_NODES.has(node.type)) fail('INVALID_SEMANTICS', `${node.type} is not executable in Checkpoint 7D.`);
  if (node.type === 'COLLECT') {
    if (node.maxItems > budgets.collectionItemsPerBinding) {
      fail('BINDING_BUDGET_EXCEEDED', `${path}.maxItems exceeds the declared collection budget.`);
    }
    return;
  }
  if (node.type === 'SEQUENCE') {
    node.children.forEach((child, index) => walk7DNode(child, budgets, `${path}.children[${index}]`));
    return;
  }
  if (node.type === 'IF') {
    walk7DNode(node.then, budgets, `${path}.then`);
    if (node.else) walk7DNode(node.else, budgets, `${path}.else`);
    return;
  }
  if (node.type === 'LOOP' || node.type === 'UNTIL' || node.type === 'RETRY') {
    walk7DNode(node.body, budgets, `${path}.body`);
  }
}

export async function validateReactiveProgram7D(programInput) {
  const program = await validateReactiveProgram(programInput);
  walk7DNode(program.root, program.budgets);
  const shadow = await shadowProgramFor7C(program);
  await validateReactiveProgram7C(shadow);
  return program;
}

function minimalProvenance(input) {
  if (!isPlainObject(input)) return null;
  const output = {};
  for (const key of ['tenantId', 'deviceId', 'tabId', 'documentGeneration']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) output[key] = input[key];
  }
  return output;
}

function validateProvenance(provenance, program, path) {
  assertPlainObject(provenance, path);
  if (provenance.tenantId !== program.tenantId) fail('CROSS_TENANT', `${path} belongs to another tenant.`);
  if (provenance.deviceId !== program.target.deviceId) fail('CROSS_DEVICE', `${path} belongs to another device.`);
  if (provenance.tabId !== program.target.tabId) fail('CROSS_TAB', `${path} belongs to another tab.`);
  if (program.target.documentGeneration !== undefined
      && provenance.documentGeneration !== program.target.documentGeneration) {
    fail('STALE_DOCUMENT', `${path} belongs to another document generation.`);
  }
}

function validateObservationMetaEntry(meta, program, path) {
  assertExactKeys(
    meta,
    ['method', 'logicalNowMs', 'provenance', 'observationKind', 'scopeKind', 'boundaryStable', 'dependencyFingerprint', 'dependencyKinds'],
    [],
    path,
  );
  if (typeof meta.method !== 'string' || meta.method.length < 1 || byteLength(meta.method) > 128) fail('INVALID_SEMANTICS', `${path}.method is invalid.`);
  assertSafeInteger(meta.logicalNowMs, `${path}.logicalNowMs`, 0, Number.MAX_SAFE_INTEGER);
  validateProvenance(meta.provenance, program, `${path}.provenance`);
  if (!OBSERVATION_KINDS.has(meta.observationKind)) fail('INVALID_SEMANTICS', `${path}.observationKind is invalid.`);
  if (!SCOPE_KINDS.has(meta.scopeKind)) fail('INVALID_SEMANTICS', `${path}.scopeKind is invalid.`);
  if (typeof meta.boundaryStable !== 'boolean') fail('INVALID_SEMANTICS', `${path}.boundaryStable must be boolean.`);
  if (!DIGEST_RE.test(meta.dependencyFingerprint)) fail('INVALID_SEMANTICS', `${path}.dependencyFingerprint is invalid.`);
  if (!Array.isArray(meta.dependencyKinds) || meta.dependencyKinds.length > 5
      || meta.dependencyKinds.some((item) => !DEPENDENCY_KINDS.has(item))) {
    fail('INVALID_SEMANTICS', `${path}.dependencyKinds is invalid.`);
  }
  assertNoSensitive(meta, path);
}

function validateObservationMeta(meta, program, path = 'state.observationMeta') {
  assertPlainObject(meta, path);
  if (Object.keys(meta).length > program.budgets.bindings) fail('BINDING_BUDGET_EXCEEDED', `${path} exceeds the binding budget.`);
  for (const [binding, value] of Object.entries(meta)) {
    assertSafeBindingName(binding, `${path}.${binding}`);
    validateObservationMetaEntry(value, program, `${path}.${binding}`);
  }
}

function controlVector(frames) {
  return frames
    .filter((frame) => ['LOOP', 'UNTIL', 'RETRY'].includes(frame.kind))
    .map((frame) => ({
      kind: frame.kind,
      parentPath: frame.parentPath,
      ...(frame.iteration === undefined ? {} : { iteration: frame.iteration }),
      ...(frame.attempt === undefined ? {} : { attempt: frame.attempt }),
    }));
}

function effectDigestBody(programDigest, state, pending) {
  return {
    programDigest,
    runId: state.runId,
    nodePath: pending.nodePath,
    ordinal: pending.ordinal,
    purpose: pending.purpose,
    method: pending.method,
    arguments: pending.arguments,
    target: pending.target,
    controlVector: controlVector(state.frames),
  };
}

async function rewritePendingDigest(state, programDigest) {
  if (state.pendingEffect === null) return state;
  const next = cloneJson(state);
  next.pendingEffect.requestDigest = await digestCanonical(effectDigestBody(programDigest, next, next.pendingEffect));
  return next;
}

async function toInnerState(program, shadow, publicState) {
  assertPlainObject(publicState, 'state');
  if (publicState.schemaVersion !== STATE_VERSION) fail('INVALID_SEMANTICS', 'state.schemaVersion is unsupported for Checkpoint 7D.');
  if (publicState.programDigest !== program.programDigest) fail('PROGRAM_DIGEST_MISMATCH', 'State program digest differs from program.');
  validateObservationMeta(publicState.observationMeta, program);
  const inner = cloneJson(publicState);
  delete inner.observationMeta;
  inner.schemaVersion = STATE_VERSION_7C;
  inner.programDigest = shadow.programDigest;
  return rewritePendingDigest(inner, shadow.programDigest);
}

async function terminalDigest(state) {
  return digestCanonical({ status: state.status, result: state.result, suspension: state.suspension });
}

async function fromInnerState(program, innerState, observationMeta, previousPublicPending = null) {
  let state = cloneJson(innerState);
  state.schemaVersion = STATE_VERSION;
  state.programDigest = program.programDigest;
  state.observationMeta = cloneJson(observationMeta);
  if (state.pendingEffect !== null) state = await rewritePendingDigest(state, program.programDigest);
  if (TERMINAL_STATUSES.has(state.status)) {
    const context = state.suspension?.context;
    if (previousPublicPending && context?.requestDigest && context.requestDigest !== previousPublicPending.requestDigest) {
      context.requestDigest = previousPublicPending.requestDigest;
    }
    state.resultDigest = await terminalDigest(state);
  }
  assertNoSensitive(state.observationMeta, 'state.observationMeta');
  return deepFreeze(state);
}

async function externalizeTransition(program, innerTransition, publicState, previousPublicPending = null) {
  const transition = cloneJson(innerTransition);
  if (transition.kind === 'EFFECT_REQUEST' && publicState.pendingEffect) {
    transition.request.requestDigest = publicState.pendingEffect.requestDigest;
  }
  if (transition.kind === 'AWAITING_EFFECT' && publicState.pendingEffect) {
    transition.requestDigest = publicState.pendingEffect.requestDigest;
  }
  if (transition.kind === 'EFFECT_ACCEPTED' && previousPublicPending) {
    transition.requestDigest = previousPublicPending.requestDigest;
  }
  if (TERMINAL_STATUSES.has(publicState.status)) transition.resultDigest = publicState.resultDigest;
  return deepFreeze(transition);
}

function sourceBindingForExpression(expr) {
  if (!expr || expr.op !== 'PATH' || !Array.isArray(expr.path) || typeof expr.path[0] !== 'string') return null;
  return expr.path[0];
}

function normalizeSource(source, path = 'collection source') {
  if (Array.isArray(source)) return { items: source, inherited: null };
  if (isPlainObject(source) && source.schemaVersion === COLLECTION_VERSION && Array.isArray(source.items)) {
    return { items: source.items, inherited: source };
  }
  if (isPlainObject(source) && Array.isArray(source.items)) return { items: source.items, inherited: null };
  fail('INVALID_SEMANTICS', `${path} must resolve to an array or a bounded item envelope.`);
}

function projectedItem(item, projection) {
  assertPlainObject(item, 'collection item');
  const output = {};
  for (const field of projection) {
    if (Object.prototype.hasOwnProperty.call(item, field)) output[field] = cloneJson(item[field], `collection item.${field}`);
  }
  assertNoSensitive(output, 'projected collection item');
  return output;
}

function ambiguityFromItems(items) {
  const ambiguities = [];
  items.forEach((item, index) => {
    if (item.identityAmbiguous === true) ambiguities.push({ kind: 'SOURCE_IDENTITY_AMBIGUOUS', indexes: [index] });
  });
  return ambiguities;
}

function normalizeCollectionMeta(observationMeta, sourceBinding) {
  if (!observationMeta) {
    return {
      provenance: null,
      observationKind: 'DIRECT_OBSERVATION',
      scopeKind: 'OBSERVED_STATE',
      boundaryStable: false,
      dependencies: {
        sourceBinding: sourceBinding ?? null,
        fingerprint: null,
        kinds: [],
        documentGeneration: null,
      },
    };
  }
  return {
    provenance: cloneJson(observationMeta.provenance),
    observationKind: observationMeta.observationKind,
    scopeKind: observationMeta.scopeKind,
    boundaryStable: observationMeta.boundaryStable,
    dependencies: {
      sourceBinding: sourceBinding ?? null,
      fingerprint: observationMeta.dependencyFingerprint,
      kinds: [...observationMeta.dependencyKinds],
      documentGeneration: observationMeta.provenance.documentGeneration ?? null,
    },
  };
}

function completionFor({ truncated, ambiguityCount, boundaryStable, scopeKind, inheritedPartial = false }) {
  const unresolved = [];
  if (truncated) unresolved.push('COLLECTION_CAP_REACHED');
  if (ambiguityCount) unresolved.push(`IDENTITY_AMBIGUITIES:${ambiguityCount}`);
  if (!boundaryStable) unresolved.push('STABLE_BOUNDARY_NOT_OBSERVED');
  if (inheritedPartial) unresolved.push('SOURCE_COLLECTION_PARTIAL');
  const boundedScope = ['LOADED_DOM', 'DECLARED_BOUNDED_FEED'].includes(scopeKind);
  const completeWithinScope = !truncated && !ambiguityCount && boundaryStable && boundedScope && !inheritedPartial;
  return {
    status: completeWithinScope ? 'BOUNDED_COMPLETE' : 'PARTIAL',
    scopeKind,
    completeWithinScope,
    universal: false,
    unresolved,
    limits: ['OBSERVED_SCOPE_ONLY', 'NOT_UNIVERSAL_PROOF'],
  };
}

async function collectionDigest(collection) {
  const { collectionDigest: _ignored, ...body } = collection;
  return digestCanonical(body);
}

function collectionDigestSyncPlaceholder(collection) {
  const serialized = canonicalJson(collection);
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  const chunk = `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  return `local:${chunk}`;
}

function buildCollectionSync(payload) {
  const output = { ...payload, collectionDigest: '' };
  output.collectionDigest = collectionDigestSyncPlaceholder(payload);
  return deepFreeze(cloneJson(output));
}

export function invalidateCollectionForObservationChange7D(collectionInput, changeInput) {
  const collection = cloneJson(collectionInput);
  if (collection.schemaVersion !== COLLECTION_VERSION || !Array.isArray(collection.items)) {
    fail('INVALID_SEMANTICS', 'Collection dependency invalidation requires an OA_VM_COLLECTION_V1 value.');
  }
  assertExactKeys(changeInput, ['dependencyFingerprint', 'dependencyKinds', 'documentGeneration'], [], 'observation change');
  if (changeInput.dependencyFingerprint !== null && !DIGEST_RE.test(changeInput.dependencyFingerprint)) {
    fail('INVALID_SEMANTICS', 'observation change dependencyFingerprint is invalid.');
  }
  if (!Array.isArray(changeInput.dependencyKinds) || changeInput.dependencyKinds.some((item) => !DEPENDENCY_KINDS.has(item))) {
    fail('INVALID_SEMANTICS', 'observation change dependencyKinds are invalid.');
  }
  const prior = collection.dependencies || {};
  const documentChanged = prior.documentGeneration !== null && changeInput.documentGeneration !== null
    && prior.documentGeneration !== changeInput.documentGeneration;
  const fingerprintChanged = prior.fingerprint !== null && changeInput.dependencyFingerprint !== null
    && prior.fingerprint !== changeInput.dependencyFingerprint;
  const changedKinds = new Set(changeInput.dependencyKinds);
  const viewportDependent = collection.completion?.scopeKind === 'VISIBLE_VIEWPORT';
  const viewportChanged = fingerprintChanged && (changedKinds.has('VIEWPORT') || changedKinds.has('ZOOM'));
  const invalidated = documentChanged || (viewportDependent && viewportChanged);
  if (!invalidated) return deepFreeze({ invalidated: false, collection: deepFreeze(collection) });

  const reset = {
    ...collection,
    items: [],
    sourceCount: 0,
    itemCount: 0,
    truncated: false,
    remainingCount: 0,
    ambiguities: [],
    completion: {
      status: 'PARTIAL',
      scopeKind: collection.completion?.scopeKind ?? 'OBSERVED_STATE',
      completeWithinScope: false,
      universal: false,
      unresolved: ['DEPENDENT_COLLECTION_INVALIDATED'],
      limits: ['OBSERVED_SCOPE_ONLY', 'NOT_UNIVERSAL_PROOF'],
    },
    invalidation: {
      invalidated: true,
      causes: documentChanged ? ['DOCUMENT'] : [...changeInput.dependencyKinds],
    },
  };
  reset.collectionDigest = collectionDigestSyncPlaceholder(reset);
  return deepFreeze({ invalidated: true, collection: deepFreeze(cloneJson(reset)) });
}

export function collectSemanticRecords7D(sourceInput, projection, options = {}) {
  if (!Array.isArray(projection) || projection.length < 1 || projection.length > 32
      || projection.some((item) => typeof item !== 'string' || !SAFE_SEGMENT.test(item))) {
    fail('INVALID_SEMANTICS', 'COLLECT projection is invalid.');
  }
  assertPlainObject(options, 'collect options');
  const maxItems = options.maxItems;
  const collectionBudget = options.collectionBudget;
  assertSafeInteger(maxItems, 'collect options.maxItems', 1, 1000);
  assertSafeInteger(collectionBudget, 'collect options.collectionBudget', 1, 1000);
  if (options.destination !== undefined) assertSafeBindingName(options.destination, 'collect options.destination');
  if (options.sourceBinding !== undefined && options.sourceBinding !== null) assertSafeBindingName(options.sourceBinding, 'collect options.sourceBinding');

  const source = normalizeSource(sourceInput);
  const meta = normalizeCollectionMeta(options.observationMeta ?? null, options.sourceBinding ?? null);
  let existing = options.existing ?? null;
  let invalidation = null;
  if (existing !== null) {
    if (!isPlainObject(existing) || existing.schemaVersion !== COLLECTION_VERSION || !Array.isArray(existing.items)) {
      fail('INVALID_SEMANTICS', 'Existing collection is malformed.');
    }
    const changed = invalidateCollectionForObservationChange7D(existing, {
      dependencyFingerprint: meta.dependencies.fingerprint,
      dependencyKinds: meta.dependencies.kinds,
      documentGeneration: meta.dependencies.documentGeneration,
    });
    existing = changed.collection;
    invalidation = changed.invalidated ? existing.invalidation : null;
  }

  const priorItems = existing ? existing.items : [];
  const projected = source.items.map((item) => projectedItem(item, projection));
  const combined = [...priorItems, ...projected];
  const cap = Math.min(maxItems, collectionBudget);
  const truncated = Boolean(existing?.truncated) || combined.length > cap;
  const items = combined.slice(0, cap);
  const remainingCount = Math.max(existing?.remainingCount ?? 0, 0) + Math.max(0, combined.length - cap);
  const ambiguities = [
    ...(Array.isArray(existing?.ambiguities) ? existing.ambiguities : []),
    ...ambiguityFromItems(projected).map((entry) => ({ ...entry, indexes: entry.indexes.map((index) => priorItems.length + index) })),
  ];
  const inheritedPartial = source.inherited?.completion?.status === 'PARTIAL';
  const completion = completionFor({
    truncated,
    ambiguityCount: ambiguities.length,
    boundaryStable: meta.boundaryStable || existing?.completion?.completeWithinScope === true,
    scopeKind: meta.scopeKind === 'OBSERVED_STATE' && existing?.completion?.scopeKind ? existing.completion.scopeKind : meta.scopeKind,
    inheritedPartial,
  });
  const collection = {
    schemaVersion: COLLECTION_VERSION,
    destination: options.destination ?? existing?.destination ?? 'collection',
    items,
    sourceCount: (existing?.sourceCount ?? 0) + source.items.length,
    itemCount: items.length,
    truncated,
    remainingCount,
    ambiguities,
    provenance: meta.provenance ?? existing?.provenance ?? null,
    observationKind: meta.observationKind,
    dependencies: meta.dependencies,
    completion,
    invalidation,
    collectionDigest: '',
  };
  assertNoSensitive(collection, 'collection');
  collection.collectionDigest = collectionDigestSyncPlaceholder(collection);
  return deepFreeze(cloneJson(collection));
}

function usableString(value) {
  return typeof value === 'string' && value.length > 0 && byteLength(value) <= 512;
}

function canonicalIdentity(item, keySpec) {
  if (item.identityAmbiguous === true) return null;
  for (const field of keySpec) {
    if (CANONICAL_KEY_FIELDS.has(field) && usableString(item[field])) {
      return { tier: 'CANONICAL', field, key: `${field}:${item[field]}` };
    }
    if (field === 'stableKey' && usableString(item.stableKey)
        && ['id', 'href'].includes(String(item.stableKeySource || '').toLowerCase())) {
      return { tier: 'CANONICAL', field, key: `stableKey:${item.stableKeySource}:${item.stableKey}` };
    }
    if (field === 'href' && usableString(item.href)) return { tier: 'CANONICAL', field, key: `href:${item.href}` };
  }
  for (const field of keySpec) {
    if (FINGERPRINT_FIELDS.has(field) && usableString(item[field])) {
      return { tier: 'FINGERPRINT', field, key: `${field}:${item[field]}` };
    }
  }
  return null;
}

function conflictingCanonicalIdentity(left, right) {
  if (usableString(left.logicalId) && usableString(right.logicalId) && left.logicalId !== right.logicalId) return true;
  if (usableString(left.canonicalId) && usableString(right.canonicalId) && left.canonicalId !== right.canonicalId) return true;
  const leftStable = usableString(left.stableKey) && ['id', 'href'].includes(String(left.stableKeySource || '').toLowerCase());
  const rightStable = usableString(right.stableKey) && ['id', 'href'].includes(String(right.stableKeySource || '').toLowerCase());
  return leftStable && rightStable && left.stableKey !== right.stableKey;
}

function preferredDuplicate(left, right) {
  const leftRevision = Number.isSafeInteger(left.semanticRevision) ? left.semanticRevision : 0;
  const rightRevision = Number.isSafeInteger(right.semanticRevision) ? right.semanticRevision : 0;
  return rightRevision > leftRevision ? right : left;
}

function fingerprintCollisionKeys(items, keySpec) {
  const groups = new Map();
  for (const item of items) {
    if (item.identityAmbiguous === true) continue;
    const fingerprintField = keySpec.find((field) => FINGERPRINT_FIELDS.has(field) && usableString(item[field]));
    if (!fingerprintField) continue;
    const fingerprint = `${fingerprintField}:${item[fingerprintField]}`;
    if (!groups.has(fingerprint)) groups.set(fingerprint, new Set());
    if (usableString(item.logicalId)) groups.get(fingerprint).add(`logicalId:${item.logicalId}`);
    else if (usableString(item.canonicalId)) groups.get(fingerprint).add(`canonicalId:${item.canonicalId}`);
  }
  return new Set([...groups.entries()].filter(([, ids]) => ids.size > 1).map(([key]) => key));
}

export function dedupSemanticRecords7D(sourceInput, keySpec, options = {}) {
  if (!Array.isArray(keySpec) || keySpec.length < 1 || keySpec.length > 8
      || keySpec.some((field) => typeof field !== 'string' || !SAFE_SEGMENT.test(field))) {
    fail('INVALID_SEMANTICS', 'DEDUP keySpec is invalid.');
  }
  if (keySpec.every((field) => WEAK_KEY_FIELDS.has(field))) {
    // Weak fields are permitted by the frozen grammar but never grant merge authority.
  }
  assertPlainObject(options, 'dedup options');
  const collectionBudget = options.collectionBudget ?? 1000;
  assertSafeInteger(collectionBudget, 'dedup options.collectionBudget', 1, 1000);
  if (options.destination !== undefined) assertSafeBindingName(options.destination, 'dedup options.destination');

  const source = normalizeSource(sourceInput, 'DEDUP source');
  if (source.items.length > collectionBudget) fail('BINDING_BUDGET_EXCEEDED', 'DEDUP source exceeds the collection binding budget.');
  const items = source.items.map((item) => {
    assertPlainObject(item, 'DEDUP item');
    assertNoSensitive(item, 'DEDUP item');
    return cloneJson(item);
  });
  const secondaryCollisions = fingerprintCollisionKeys(items, keySpec);
  const output = [];
  const identities = new Map();
  const ambiguities = [];
  let duplicatesRemoved = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const identity = canonicalIdentity(item, keySpec);
    const fingerprintField = keySpec.find((field) => FINGERPRINT_FIELDS.has(field) && usableString(item[field]));
    const fingerprintKey = fingerprintField ? `${fingerprintField}:${item[fingerprintField]}` : null;
    if (fingerprintKey && secondaryCollisions.has(fingerprintKey)) {
      ambiguities.push({ kind: 'IDENTITY_COLLISION', indexes: [index], keyTier: 'FINGERPRINT' });
    }
    if (!identity) {
      output.push(item);
      ambiguities.push({ kind: 'MISSING_STRONG_IDENTITY', indexes: [index] });
      continue;
    }
    if (!identities.has(identity.key)) {
      identities.set(identity.key, { outputIndex: output.length, sourceIndexes: [index], identity });
      output.push(item);
      continue;
    }
    const prior = identities.get(identity.key);
    const existing = output[prior.outputIndex];
    if (conflictingCanonicalIdentity(existing, item)) {
      output.push(item);
      ambiguities.push({ kind: 'IDENTITY_COLLISION', indexes: [...prior.sourceIndexes, index], keyTier: identity.tier });
      continue;
    }
    output[prior.outputIndex] = preferredDuplicate(existing, item);
    prior.sourceIndexes.push(index);
    duplicatesRemoved += 1;
  }

  const inherited = source.inherited;
  const inheritedAmbiguities = Array.isArray(inherited?.ambiguities) ? inherited.ambiguities : [];
  const allAmbiguities = [...inheritedAmbiguities, ...ambiguities];
  const inheritedCompletion = inherited?.completion;
  const completion = completionFor({
    truncated: Boolean(inherited?.truncated),
    ambiguityCount: allAmbiguities.length,
    boundaryStable: inheritedCompletion?.completeWithinScope === true,
    scopeKind: inheritedCompletion?.scopeKind ?? 'OBSERVED_STATE',
    inheritedPartial: inheritedCompletion?.status === 'PARTIAL' && inheritedCompletion?.completeWithinScope !== true,
  });
  const result = {
    schemaVersion: COLLECTION_VERSION,
    destination: options.destination ?? inherited?.destination ?? 'deduped',
    items: output,
    sourceCount: inherited?.sourceCount ?? items.length,
    itemCount: output.length,
    truncated: Boolean(inherited?.truncated),
    remainingCount: inherited?.remainingCount ?? 0,
    ambiguities: allAmbiguities,
    provenance: inherited?.provenance ?? null,
    observationKind: inherited?.observationKind ?? 'DIRECT_OBSERVATION',
    dependencies: inherited?.dependencies ?? { sourceBinding: null, fingerprint: null, kinds: [], documentGeneration: null },
    completion,
    invalidation: inherited?.invalidation ?? null,
    dedup: {
      keySpec: [...keySpec],
      duplicatesRemoved,
      ambiguityCount: allAmbiguities.length,
      canonicalBeforeFingerprint: true,
    },
    collectionDigest: '',
  };
  assertNoSensitive(result, 'dedup collection');
  result.collectionDigest = collectionDigestSyncPlaceholder(result);
  return deepFreeze(cloneJson(result));
}

function deriveEffectObservationMeta(program, pending, effectResult, logicalNowMs) {
  const method = pending.method;
  let scopeKind = 'OBSERVED_STATE';
  let observationKind = 'DIRECT_OBSERVATION';
  let dependencyKinds = [];
  if (method === 'page.capture') {
    scopeKind = 'SCREENSHOT';
    observationKind = 'SCREENSHOT';
    dependencyKinds = ['VIEWPORT'];
  } else if (['page.read', 'page.query', 'page.find', 'page.collect_links'].includes(method)) {
    scopeKind = 'LOADED_DOM';
    dependencyKinds = ['ENTITY_SET'];
  }
  return {
    method,
    logicalNowMs,
    provenance: minimalProvenance(effectResult.provenance),
    observationKind,
    scopeKind,
    boundaryStable: false,
    dependencyFingerprint: `sha256:${'0'.repeat(64)}`,
    dependencyKinds,
  };
}

function observationMetaForSource(state, node) {
  const binding = sourceBindingForExpression(node.source);
  if (binding && state.observationMeta[binding]) return { binding, meta: state.observationMeta[binding] };
  const source = evaluateReactiveExpression(node.source, state.bindings);
  if (isPlainObject(source) && source.schemaVersion === COLLECTION_VERSION) {
    const provenance = source.provenance;
    if (provenance) {
      return {
        binding,
        meta: {
          method: 'collection',
          logicalNowMs: state.lastLogicalNowMs,
          provenance,
          observationKind: source.observationKind ?? 'DIRECT_OBSERVATION',
          scopeKind: source.completion?.scopeKind ?? 'OBSERVED_STATE',
          boundaryStable: source.completion?.completeWithinScope === true,
          dependencyFingerprint: source.dependencies?.fingerprint ?? `sha256:${'0'.repeat(64)}`,
          dependencyKinds: source.dependencies?.kinds ?? [],
        },
      };
    }
  }
  return { binding, meta: null };
}

async function terminalize7D(program, stateInput, limit, context = {}) {
  const state = cloneJson(stateInput);
  state.status = 'LIMIT_REACHED';
  state.cursorPath = null;
  state.frames = [];
  state.pendingEffect = null;
  state.waitState = null;
  state.result = null;
  state.suspension = { reason: 'LIMIT_REACHED', context: { limit, ...context } };
  state.resultDigest = await terminalDigest(state);
  return deepFreeze({
    state: deepFreeze(state),
    transition: deepFreeze({
      kind: 'TERMINAL', status: 'LIMIT_REACHED', resultDigest: state.resultDigest, transitionIndex: state.transitionIndex,
    }),
  });
}

function stateBytesWithinBudget(program, state) {
  return byteLength(canonicalJson(state)) <= program.budgets.persistedCheckpointBytes;
}

async function executeCollectionNode(program, shadow, state, input, node) {
  const inner = await toInnerState(program, shadow, state);
  const advanced = await advanceReactiveVm7C(shadow, inner, input);
  let publicState = await fromInnerState(program, advanced.state, state.observationMeta, state.pendingEffect);
  if (publicState.status === 'CANCELLED' || publicState.status === 'EXPIRED' || publicState.status === 'LIMIT_REACHED'
      || publicState.status === 'FAILED' || publicState.status === 'SUSPENDED') {
    return deepFreeze({ state: publicState, transition: await externalizeTransition(program, advanced.transition, publicState, state.pendingEffect) });
  }

  const next = cloneJson(publicState);
  if (!Object.prototype.hasOwnProperty.call(next.bindings, node.destination)
      && Object.keys(next.bindings).length >= program.budgets.bindings) {
    return terminalize7D(program, next, 'BINDINGS', { budget: program.budgets.bindings });
  }

  const source = evaluateReactiveExpression(node.source, state.bindings);
  if (node.type === 'COLLECT') {
    const sourceMeta = observationMetaForSource(state, node);
    next.bindings[node.destination] = collectSemanticRecords7D(source, node.projection, {
      existing: state.bindings[node.destination] ?? null,
      destination: node.destination,
      maxItems: node.maxItems,
      collectionBudget: program.budgets.collectionItemsPerBinding,
      sourceBinding: sourceMeta.binding,
      observationMeta: sourceMeta.meta,
    });
    if (sourceMeta.meta) next.observationMeta[node.destination] = cloneJson(sourceMeta.meta);
  } else {
    next.bindings[node.destination] = dedupSemanticRecords7D(source, node.keySpec, {
      destination: node.destination,
      collectionBudget: program.budgets.collectionItemsPerBinding,
    });
    const sourceBinding = sourceBindingForExpression(node.source);
    if (sourceBinding && state.observationMeta[sourceBinding]) next.observationMeta[node.destination] = cloneJson(state.observationMeta[sourceBinding]);
  }
  assertNoSensitive(next.bindings[node.destination], `state.bindings.${node.destination}`);
  if (!stateBytesWithinBudget(program, next)) {
    return terminalize7D(program, next, 'PERSISTED_CHECKPOINT_BYTES', { budgetBytes: program.budgets.persistedCheckpointBytes });
  }
  publicState = deepFreeze(next);
  const transition = cloneJson(await externalizeTransition(program, advanced.transition, publicState, state.pendingEffect));
  transition.instruction = node.type;
  transition.destination = node.destination;
  transition.itemCount = publicState.bindings[node.destination].itemCount;
  transition.completion = publicState.bindings[node.destination].completion.status;
  return deepFreeze({ state: publicState, transition: deepFreeze(transition) });
}

export async function createReactiveVm7D(programInput, options) {
  const program = await validateReactiveProgram7D(programInput);
  assertExactKeys(
    options,
    ['runId', 'tenantId', 'goalRevision', 'logicalNowMs'],
    ['deadlineAtMs', 'initialBindings', 'initialObservationMeta'],
    'options',
  );
  const shadow = await shadowProgramFor7C(program);
  const innerOptions = {
    runId: options.runId,
    tenantId: options.tenantId,
    goalRevision: options.goalRevision,
    logicalNowMs: options.logicalNowMs,
    ...(options.deadlineAtMs === undefined ? {} : { deadlineAtMs: options.deadlineAtMs }),
    ...(options.initialBindings === undefined ? {} : { initialBindings: options.initialBindings }),
  };
  const meta = cloneJson(options.initialObservationMeta ?? {});
  validateObservationMeta(meta, program, 'options.initialObservationMeta');
  const inner = await createReactiveVm7C(shadow, innerOptions);
  const state = await fromInnerState(program, inner, meta);
  if (!stateBytesWithinBudget(program, state)) fail('OUTPUT_TOO_LARGE', 'Initial 7D state exceeds the checkpoint byte budget.');
  return state;
}

export async function advanceReactiveVm7D(programInput, stateInput, input) {
  const program = await validateReactiveProgram7D(programInput);
  const shadow = await shadowProgramFor7C(program);
  const state = cloneJson(stateInput);
  if (state.schemaVersion !== STATE_VERSION || state.programDigest !== program.programDigest) {
    fail('PROGRAM_DIGEST_MISMATCH', '7D state does not belong to this program.');
  }
  validateObservationMeta(state.observationMeta, program);

  if (!TERMINAL_STATUSES.has(state.status) && state.pendingEffect === null && state.waitState === null) {
    const node = nodeAtPath(program, state.cursorPath);
    if (node.type === 'COLLECT' || node.type === 'DEDUP') {
      return executeCollectionNode(program, shadow, state, input, node);
    }
  }

  const previousPublicPending = state.pendingEffect ? cloneJson(state.pendingEffect) : null;
  const innerState = await toInnerState(program, shadow, state);
  let innerInput = cloneJson(input);
  if (previousPublicPending && input.effectResult !== undefined) {
    if (input.effectResult.requestDigest !== previousPublicPending.requestDigest) {
      fail('INVALID_SEMANTICS', 'Effect result does not match the pending 7D request.');
    }
    innerInput.effectResult.requestDigest = innerState.pendingEffect.requestDigest;
  }
  const pendingBinding = innerState.pendingEffect?.purpose === 'COMMAND' ? innerState.pendingEffect.resultBinding : null;
  const pendingMethod = innerState.pendingEffect?.purpose === 'COMMAND' ? innerState.pendingEffect.method : null;
  const advanced = await advanceReactiveVm7C(shadow, innerState, innerInput);
  const meta = cloneJson(state.observationMeta);
  if (pendingBinding && input.effectResult?.ok === true) {
    const pending = { method: pendingMethod };
    meta[pendingBinding] = deriveEffectObservationMeta(program, pending, input.effectResult, input.logicalNowMs);
  }
  const publicState = await fromInnerState(program, advanced.state, meta, previousPublicPending);
  if (!stateBytesWithinBudget(program, publicState)) {
    return terminalize7D(program, publicState, 'PERSISTED_CHECKPOINT_BYTES', { budgetBytes: program.budgets.persistedCheckpointBytes });
  }
  const transition = await externalizeTransition(program, advanced.transition, publicState, previousPublicPending);
  return deepFreeze({ state: publicState, transition });
}

export async function bindCollectionEvidence7D(collectionInput, context) {
  const collection = cloneJson(collectionInput);
  if (collection.schemaVersion !== COLLECTION_VERSION || !Array.isArray(collection.items)) {
    fail('INVALID_SEMANTICS', 'Only OA_VM_COLLECTION_V1 values may bind to proof evidence.');
  }
  if (!collection.provenance) fail('MISSING_PROVENANCE', 'Collection evidence requires verified observation provenance.');
  assertExactKeys(
    context,
    ['evidenceId', 'tenantId', 'goalId', 'goalRevision', 'ledgerDigest', 'claimId', 'scopeId', 'predicate', 'observedAt', 'supports'],
    ['forceDirect'],
    'evidence context',
  );
  if (collection.provenance.tenantId !== context.tenantId) fail('CROSS_TENANT', 'Collection provenance tenant differs from evidence tenant.');
  if (typeof context.supports !== 'boolean') fail('INVALID_SEMANTICS', 'evidence context.supports must be boolean.');
  if (context.forceDirect !== undefined && typeof context.forceDirect !== 'boolean') fail('INVALID_SEMANTICS', 'evidence context.forceDirect must be boolean.');
  assertNoSensitive(context, 'evidence context');

  const bounded = collection.completion?.status === 'BOUNDED_COMPLETE'
    && collection.completion?.completeWithinScope === true
    && collection.truncated !== true
    && collection.ambiguities?.length === 0;
  const category = bounded && context.forceDirect !== true ? 'BOUNDARY_OBSERVATION' : 'DIRECT_OBSERVATION';
  return createEvidence({
    schemaVersion: 1,
    evidenceId: context.evidenceId,
    category,
    tenantId: context.tenantId,
    goalId: context.goalId,
    goalRevision: context.goalRevision,
    ledgerDigest: context.ledgerDigest,
    claimId: context.claimId,
    scopeId: context.scopeId,
    observedAt: context.observedAt,
    trust: 'BROWSER_SENSOR',
    predicate: context.predicate,
    supports: context.supports,
    exhaustive: false,
    dependencies: [],
  });
}

