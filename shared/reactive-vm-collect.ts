// @last-edited: 2026-10-21 UTC+7.
// @title: reactive-vm-collect — the collector that turns a run of a program into the evidence it leaves.
// @state: the collection state, the evidence it builds, and the bounds every collection holds.
// @dependencies: digest, proof-engine, reactive-vm, reactive-vm-control-flow.

import { canonicalJson, digestCanonical } from './digest.js';
import {
  evaluateReactiveExpression,
  validateReactiveProgram,
} from './reactive-vm.js';
import {
  advanceControlFlowVm,
  createControlFlowVm,
  validateControlFlowProgram,
} from './reactive-vm-control-flow.js';
import { makeGuards, type Guards } from './reactive-vm-core.js';

// WHY A GUARD FACTORY AND NOT A LIBRARY OF NINETY EXPORTS.
// The collect, control-flow and host modules used to carry these helpers verbatim; the factory hands each module the exact same guards with its own default code, and the semantics stay byte-identical.

// WHY THE GUARDS ARE RE-TYPED HERE.
// The factory hands back untyped helpers, and this module is where a JSON value becomes a checked shape: `fail` is declared never-returning so the compiler trusts that a guarded branch does not continue, and the object checks are declared as assertion functions so a checked value narrows.
// Each adapter forwards to the shared guard, so the runtime is unchanged.

const guards: Guards = makeGuards('INVALID_SEMANTICS');

const fail: (code: string, message: string, details?: unknown) => never = (code, message, details) => {
  guards.fail(code, message, details);
  throw new Error('unreachable: the guard factory always throws');
};

function isPlainObject<T>(value: T): value is T & Record<string, unknown> {
  return guards.isPlainObject(value);
}

function assertPlainObject<T>(value: T, path: string): asserts value is T & Record<string, unknown> {
  guards.assertPlainObject(value, path);
}

function assertExactKeys<T>(value: T, required: readonly string[], optional: readonly string[], path: string): asserts value is T & Record<string, unknown> {
  guards.assertExactKeys(value, [...required], [...optional], path);
}

function assertSafeInteger<T>(value: T, path: string, min: number, max: number): asserts value is T & number {
  guards.assertSafeInteger(value, path, min, max);
}

const byteLength: (value: string) => number = (value) => guards.byteLength(value);

// The factory's cloneJson returns unknown by design; the JSON it produced is by construction the same value T was before serialization.

function cloneJson<T>(value: unknown, path?: string): T {
  return guards.cloneJson(value, path) as T;
}
const deepFreeze: <T>(value: T) => T = (value) => guards.deepFreeze(value);
const assertNoSensitive: (value: unknown, path?: string) => void = (value, path) => guards.assertNoSensitive(value, path);

// WHY THE SHAPES ARE STRUCTURAL.
// Every value here arrives as JSON that this module checks with the guards above, so the types name the checked shape, `unknown` marks the true edge, and the checks themselves stay the runtime truth.

type JsonObject = Record<string, unknown>;
type VmPathSegment = string | number;

type ReactiveProgram = {
  schemaVersion: string;
  programId: string;
  tenantId: string;
  goalId: string;
  goalRevision: number;
  target: ProgramTarget;
  budgets: ProgramBudgets;
  root: ReactiveNode;
  programDigest: string;
};

interface ProgramTarget {
  deviceId: string;
  tabId: number;
  documentGeneration?: string;
}

interface ProgramBudgets {
  collectionItemsPerBinding: number;
  bindings: number;
  persistedCheckpointBytes: number;
}

interface VmExpression {
  op: string;
  value?: unknown;
  path?: unknown;
  args?: VmExpression[];
  arg?: VmExpression;
}

type SequenceNode = { type: 'SEQUENCE'; children: ReactiveNode[] };
type IfNode = { type: 'IF'; predicate: VmExpression; then: ReactiveNode; else?: ReactiveNode };
type LoopNode = { type: 'LOOP'; body: ReactiveNode; maxIterations: number };
type UntilNode = { type: 'UNTIL'; predicate: VmExpression; body: ReactiveNode; maxIterations: number };
type WaitEventNode = { type: 'WAIT_EVENT'; observation: { method: string; arguments: JsonObject }; predicate: VmExpression; intervalMs: number; timeoutMs: number };
type AssertNode = { type: 'ASSERT'; predicate: VmExpression; onFailure: string };
type CollectNode = { type: 'COLLECT'; source: VmExpression; projection: string[]; destination: string; maxItems: number };
type DedupNode = { type: 'DEDUP'; source: VmExpression; keySpec: string[]; destination: string };
type RetryNode = { type: 'RETRY'; body: ReactiveNode; policy: { attempts: number; delayMs: number } };
type ReturnNode = { type: 'RETURN'; valueSpec: VmExpression };
type CommandNode = { type: 'COMMAND'; method: string; arguments: JsonObject; resultBinding: string };
type SuspendNode = { type: 'SUSPEND'; reason: string; contextSpec: JsonObject };

type ReactiveNode =
  | SequenceNode
  | IfNode
  | LoopNode
  | UntilNode
  | WaitEventNode
  | AssertNode
  | CollectNode
  | DedupNode
  | RetryNode
  | ReturnNode
  | CommandNode
  | SuspendNode;

interface ControlFrame {
  kind: string;
  parentPath: VmPathSegment[];
  iteration?: number;
  attempt?: number;
  nextIndex?: number;
  notBeforeMs?: number | null;
}

interface PendingEffect {
  requestDigest: string;
  purpose: string;
  method: string;
  arguments: JsonObject;
  target: ProgramTarget;
  resultBinding: string | null;
  nodePath: VmPathSegment[];
  ordinal: number;
}

interface PendingDigestHost {
  runId: string;
  frames: ControlFrame[];
  pendingEffect: PendingEffect | null;
}

interface EffectResult {
  requestDigest: string;
  method: string;
  ok: boolean;
  provenance: unknown;
  value: unknown;
  errorCode?: string;
}

interface AdvanceCollectInput {
  logicalNowMs: number;
  cancelled?: boolean;
  effectResult?: EffectResult;
}

interface CreateCollectOptions {
  runId: string;
  tenantId: string;
  goalRevision: number;
  logicalNowMs: number;
  deadlineAtMs?: number;
  initialBindings?: JsonObject | null;
  initialObservationMeta?: unknown;
}

interface ObservationMetaEntry {
  method: string;
  logicalNowMs: number;
  provenance: JsonObject | null;
  observationKind: string;
  scopeKind: string;
  boundaryStable: boolean;
  dependencyFingerprint: string;
  dependencyKinds: string[];
}

interface CollectionDependencies {
  sourceBinding: string | null;
  fingerprint: string | null;
  kinds: string[];
  documentGeneration: unknown;
}

interface CollectionCompletion {
  status: string;
  scopeKind: string;
  completeWithinScope: boolean;
  universal: boolean;
  unresolved: string[];
  limits: string[];
}

interface Invalidation {
  invalidated: boolean;
  causes: string[];
}

interface Ambiguity {
  kind: string;
  indexes: number[];
  keyTier?: string;
}

interface DedupSummary {
  keySpec: string[];
  duplicatesRemoved: number;
  ambiguityCount: number;
  canonicalBeforeFingerprint: boolean;
}

type Collection = {
  schemaVersion: string;
  destination: string;
  items: JsonObject[];
  sourceCount: number;
  itemCount: number;
  truncated: boolean;
  remainingCount: number;
  ambiguities: Ambiguity[];
  provenance: JsonObject | null;
  observationKind: string;
  dependencies: CollectionDependencies;
  completion: CollectionCompletion;
  invalidation: Invalidation | null;
  dedup?: DedupSummary;
  collectionDigest: string;
};

interface CollectionChange {
  invalidated: boolean;
  collection: Collection;
}

interface CanonicalIdentity {
  tier: string;
  field: string;
  key: string;
}

interface CollectionMeta {
  provenance: JsonObject | null;
  observationKind: string;
  scopeKind: string;
  boundaryStable: boolean;
  dependencies: CollectionDependencies;
}

interface CollectOptions {
  maxItems?: number;
  collectionBudget?: number;
  destination?: string;
  sourceBinding?: string | null;
  observationMeta?: ObservationMetaEntry | null | undefined;
  existing?: Collection | null;
}

interface DedupOptions {
  collectionBudget?: number;
  destination?: string;
}

interface ObservationChange {
  dependencyFingerprint: string | null;
  dependencyKinds: string[];
  documentGeneration: unknown;
}

interface CompletionInput {
  truncated: boolean;
  ambiguityCount: number;
  boundaryStable: boolean;
  scopeKind: string;
  inheritedPartial?: boolean;
}

interface CollectCounters {
  executedNodes: number;
  commandLeaves: number;
  totalIterations: number;
  cumulativeWaitMs: number;
  retryAttempts: number;
}

interface Suspension {
  reason: string;
  context: JsonObject;
}

export interface VmTransition {
  kind: string;
  request?: { requestDigest: string };
  requestDigest?: string | null;
  resultDigest?: string | null;
  [key: string]: unknown;
}

export interface CollectState {
  schemaVersion: string;
  runId: string;
  programDigest: string;
  tenantId: string;
  goalId: string;
  goalRevision: number;
  target: ProgramTarget;
  status: string;
  cursorPath: VmPathSegment[] | null;
  frames: ControlFrame[];
  bindings: Record<string, unknown>;
  counters: CollectCounters;
  pendingEffect: PendingEffect | null;
  waitState: unknown;
  result: unknown;
  suspension: Suspension | null;
  resultDigest: string | null;
  deadlineAtMs: number;
  lastLogicalNowMs: number;
  transitionIndex: number;
  observationMeta: Record<string, ObservationMetaEntry>;
}

type CollectInnerState = Omit<CollectState, 'observationMeta'> & { observationMeta?: unknown };

export interface CollectStep {
  state: CollectState;
  transition: VmTransition;
}

const CONTROL_FLOW_STATE_VERSION = 'OA_REACTIVE_VM_CONTROL_FLOW_STATE_V1';
const STATE_VERSION = 'OA_REACTIVE_VM_COLLECT_STATE_V1';
const COLLECTION_VERSION = 'OA_VM_COLLECTION_V1';
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const TERMINAL_STATUSES = new Set(['RETURNED', 'SUSPENDED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const EXECUTABLE_NODES = new Set([
  'SEQUENCE', 'IF', 'LOOP', 'UNTIL', 'WAIT_EVENT', 'ASSERT', 'COLLECT', 'DEDUP', 'RETRY', 'RETURN', 'COMMAND', 'SUSPEND',
]);
const SCOPE_KINDS: ReadonlySet<unknown> = new Set(['LOADED_DOM', 'VISIBLE_VIEWPORT', 'DECLARED_BOUNDED_FEED', 'OBSERVED_STATE', 'SCREENSHOT']);
const OBSERVATION_KINDS: ReadonlySet<unknown> = new Set(['DIRECT_OBSERVATION', 'SCREENSHOT', 'BOUNDARY_OBSERVATION']);
const DEPENDENCY_KINDS = new Set(['ENTITY_SET', 'SCROLL', 'VIEWPORT', 'ZOOM', 'DOCUMENT']);
const CANONICAL_KEY_FIELDS = new Set(['logicalId', 'canonicalId']);
const FINGERPRINT_FIELDS = new Set(['semanticFingerprint', 'identityFingerprint', 'bindingHash']);
const WEAK_KEY_FIELDS = new Set([
  'name', 'label', 'text', 'x', 'y', 'width', 'height', 'rect', 'inViewport',
  'geometryRevision', 'index', 'position',
]);
function assertSafeBindingName(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value) || FORBIDDEN_PATH_SEGMENTS.has(value)) {
    fail('INVALID_SEMANTICS', `${path} is not a safe binding name.`);
  }
}

// The cursor walks plain JSON whose segments are each checked to exist before the step, so the two casts here name verified facts: the segment lookup, and the instruction type the plain-object check demanded.

function nodeAtPath(program: ReactiveProgram, path: readonly VmPathSegment[] | null): ReactiveNode {
  if (!Array.isArray(path) || path.length < 1 || path[0] !== 'root') fail('INVALID_SEMANTICS', 'VM cursor path is invalid.');
  let current: JsonObject = program;
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
    current = current[segment] as JsonObject;
  }
  if (!isPlainObject(current) || typeof current.type !== 'string') fail('INVALID_SEMANTICS', 'VM cursor does not reference an instruction.');
  return current as ReactiveNode;
}

function mapControlFlowNode(node: ReactiveNode): ReactiveNode {
  if (node.type === 'COLLECT' || node.type === 'DEDUP') {
    return { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' };
  }
  if (node.type === 'SEQUENCE') return { ...node, children: node.children.map(mapControlFlowNode) };
  if (node.type === 'IF') {
    // WHY the THEN branch is written exactly as the schema pins it.
    // The V1 VM schema carries the THEN branch under the literal key 'then'; every digest and VM test pins those bytes, so the key is not negotiable.
    const thenKey = 'then';
    return {
      ...node,
      [thenKey]: mapControlFlowNode(node.then),
      ...(node.else === undefined ? {} : { else: mapControlFlowNode(node.else) }),
    };
  }
  if (node.type === 'LOOP' || node.type === 'UNTIL' || node.type === 'RETRY') {
    return { ...node, body: mapControlFlowNode(node.body) };
  }
  return cloneJson<ReactiveNode>(node);
}

async function shadowControlFlowProgram(program: ReactiveProgram): Promise<ReactiveProgram> {
  const shadow = cloneJson<ReactiveProgram>(program);
  shadow.root = mapControlFlowNode(program.root);
  shadow.programDigest = '';
  const { programDigest: _ignored, ...body } = shadow;
  shadow.programDigest = await digestCanonical(body);
  return shadow;
}

function walk7DNode(node: ReactiveNode, budgets: ProgramBudgets, path = 'program.root'): void {
  if (!EXECUTABLE_NODES.has(node.type)) fail('INVALID_SEMANTICS', `${node.type} is not executable in Checkpoint 7D.`);
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

export async function validateCollectProgram(programInput: unknown): Promise<ReactiveProgram> {
  // validateReactiveProgram returns the program it produced; this cast names that.
  const program = (await validateReactiveProgram(programInput)) as ReactiveProgram;
  walk7DNode(program.root, program.budgets);
  const shadow = await shadowControlFlowProgram(program);
  await validateControlFlowProgram(shadow);
  return program;
}

function minimalProvenance(input: unknown): JsonObject | null {
  if (!isPlainObject(input)) return null;
  const output: JsonObject = {};
  for (const key of ['tenantId', 'deviceId', 'tabId', 'documentGeneration']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) output[key] = input[key];
  }
  return output;
}

function validateProvenance(provenance: unknown, program: ReactiveProgram, path: string): void {
  assertPlainObject(provenance, path);
  if (provenance.tenantId !== program.tenantId) fail('CROSS_TENANT', `${path} belongs to another tenant.`);
  if (provenance.deviceId !== program.target.deviceId) fail('CROSS_DEVICE', `${path} belongs to another device.`);
  if (provenance.tabId !== program.target.tabId) fail('CROSS_TAB', `${path} belongs to another tab.`);
  if (program.target.documentGeneration !== undefined
      && provenance.documentGeneration !== program.target.documentGeneration) {
    fail('STALE_DOCUMENT', `${path} belongs to another document generation.`);
  }
}

function validateObservationMetaEntry(meta: unknown, program: ReactiveProgram, path: string): void {
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
  if (!DIGEST_RE.test(String(meta.dependencyFingerprint))) fail('INVALID_SEMANTICS', `${path}.dependencyFingerprint is invalid.`);
  if (!Array.isArray(meta.dependencyKinds) || meta.dependencyKinds.length > 5
      || meta.dependencyKinds.some((item) => !DEPENDENCY_KINDS.has(item))) {
    fail('INVALID_SEMANTICS', `${path}.dependencyKinds is invalid.`);
  }
  assertNoSensitive(meta, path);
}

function validateObservationMeta(meta: unknown, program: ReactiveProgram, path = 'state.observationMeta'): void {
  assertPlainObject(meta, path);
  if (Object.keys(meta).length > program.budgets.bindings) fail('BINDING_BUDGET_EXCEEDED', `${path} exceeds the binding budget.`);
  for (const [binding, value] of Object.entries(meta)) {
    assertSafeBindingName(binding, `${path}.${binding}`);
    validateObservationMetaEntry(value, program, `${path}.${binding}`);
  }
}

function assertUnifiedBindingBudget(bindings: JsonObject | null | undefined, meta: JsonObject | null | undefined, program: ReactiveProgram, path: string): void {
  const keys = new Set([...Object.keys(bindings ?? {}), ...Object.keys(meta ?? {})]);
  if (keys.size > program.budgets.bindings) fail('BINDING_BUDGET_EXCEEDED', `${path} bindings and observation metadata exceed the binding budget.`);
}

function controlVector(frames: ControlFrame[]): JsonObject[] {
  return frames
    .filter((frame) => ['LOOP', 'UNTIL', 'RETRY'].includes(frame.kind))
    .map((frame) => ({
      kind: frame.kind,
      parentPath: frame.parentPath,
      ...(frame.iteration === undefined ? {} : { iteration: frame.iteration }),
      ...(frame.attempt === undefined ? {} : { attempt: frame.attempt }),
    }));
}

function effectDigestBody(programDigest: string, state: { runId: string; frames: ControlFrame[] }, pending: PendingEffect): JsonObject {
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

async function rewritePendingDigest<T extends PendingDigestHost>(state: T, programDigest: string): Promise<T> {
  if (state.pendingEffect === null) return state;
  const next = cloneJson<T>(state);
  const nextPending = next.pendingEffect;
  if (nextPending === null) return next;
  nextPending.requestDigest = await digestCanonical(effectDigestBody(programDigest, next, nextPending));
  return next;
}

async function toInnerState(program: ReactiveProgram, shadow: ReactiveProgram, publicState: unknown): Promise<CollectInnerState> {
  assertPlainObject(publicState, 'state');
  if (publicState.schemaVersion !== STATE_VERSION) fail('INVALID_SEMANTICS', 'state.schemaVersion is unsupported for Checkpoint 7D.');
  if (publicState.programDigest !== program.programDigest) fail('PROGRAM_DIGEST_MISMATCH', 'State program digest differs from program.');
  validateObservationMeta(publicState.observationMeta, program);
  const inner = cloneJson<CollectInnerState>(publicState);
  delete inner.observationMeta;
  inner.schemaVersion = CONTROL_FLOW_STATE_VERSION;
  inner.programDigest = shadow.programDigest;
  return rewritePendingDigest(inner, shadow.programDigest);
}

async function terminalDigest(state: CollectState): Promise<string> {
  return digestCanonical({ status: state.status, result: state.result, suspension: state.suspension });
}

async function fromInnerState(program: ReactiveProgram, innerState: unknown, observationMeta: Record<string, ObservationMetaEntry>, previousPublicPending: PendingEffect | null = null): Promise<CollectState> {
  let state = cloneJson<CollectState>(innerState);
  state.schemaVersion = STATE_VERSION;
  state.programDigest = program.programDigest;
  state.observationMeta = cloneJson<Record<string, ObservationMetaEntry>>(observationMeta);
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

// externalizeTransition replays a transition whose request digest is rewritten from the public state when pending; an EFFECT_REQUEST always carries the request it was cloned from.

async function externalizeTransition(_program: ReactiveProgram, innerTransition: unknown, publicState: CollectState, previousPublicPending: PendingEffect | null = null): Promise<VmTransition> {
  const transition = cloneJson<VmTransition>(innerTransition);
  if (transition.kind === 'EFFECT_REQUEST' && publicState.pendingEffect) {
    if (transition.request !== undefined) transition.request.requestDigest = publicState.pendingEffect.requestDigest;
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

function sourceBindingForExpression(expr: VmExpression): string | null {
  if (!expr || expr.op !== 'PATH' || !Array.isArray(expr.path) || typeof expr.path[0] !== 'string') return null;
  return expr.path[0];
}

// normalizeSource accepts a raw array or a checked collection envelope; when the version and item array are both checked, the envelope is a collection.

function normalizeSource(source: unknown, path = 'collection source'): { items: JsonObject[]; inherited: Collection | null } {
  if (Array.isArray(source)) return { items: source, inherited: null };
  if (isPlainObject(source) && source.schemaVersion === COLLECTION_VERSION && Array.isArray(source.items)) {
    return { items: source.items, inherited: source as Collection };
  }
  if (isPlainObject(source) && Array.isArray(source.items)) return { items: source.items, inherited: null };
  fail('INVALID_SEMANTICS', `${path} must resolve to an array or a bounded item envelope.`);
}

function projectedItem(item: unknown, projection: string[]): JsonObject {
  assertPlainObject(item, 'collection item');
  const output: JsonObject = {};
  for (const field of projection) {
    if (Object.prototype.hasOwnProperty.call(item, field)) output[field] = cloneJson(item[field], `collection item.${field}`);
  }
  assertNoSensitive(output, 'projected collection item');
  return output;
}

function ambiguityFromItems(items: JsonObject[]): Ambiguity[] {
  const ambiguities: Ambiguity[] = [];
  items.forEach((item, index) => {
    if (item.identityAmbiguous === true) ambiguities.push({ kind: 'SOURCE_IDENTITY_AMBIGUOUS', indexes: [index] });
  });
  return ambiguities;
}

// Observation metadata reaches this function only through validateObservationMetaEntry, which asserts a non-null plain provenance before storing it — the provenance bang and its documentGeneration read rest on that fact.

function normalizeCollectionMeta(observationMeta: ObservationMetaEntry | null | undefined, sourceBinding: string | null): CollectionMeta {
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
      documentGeneration: (() => {
      const provenance = observationMeta.provenance;
      if (provenance === null) fail('INVALID_SEMANTICS', 'observation meta provenance required.');
      return provenance.documentGeneration;
    })() ?? null,
    },
  };
}

function completionFor({ truncated, ambiguityCount, boundaryStable, scopeKind, inheritedPartial = false }: CompletionInput): CollectionCompletion {
  const unresolved: string[] = [];
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

function collectionDigestSyncPlaceholder(collection: unknown): string {
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

function invalidateCollectionForObservationChange(collectionInput: unknown, changeInput: ObservationChange): CollectionChange {
  const collection = cloneJson<Collection>(collectionInput);
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

  const reset: Collection = {
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
  return deepFreeze({ invalidated: true, collection: deepFreeze(cloneJson<Collection>(reset)) });
}

function collectSemanticRecords(sourceInput: unknown, projection: string[], options: CollectOptions = {}): Collection {
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
  let invalidation: Invalidation | null = null;
  if (existing !== null) {
    if (!isPlainObject(existing) || existing.schemaVersion !== COLLECTION_VERSION || !Array.isArray(existing.items)) {
      fail('INVALID_SEMANTICS', 'Existing collection is malformed.');
    }
    const changed = invalidateCollectionForObservationChange(existing, {
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
  const collection: Collection = {
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
  return deepFreeze(cloneJson<Collection>(collection));
}

function usableString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && byteLength(value) <= 512;
}

function canonicalIdentity(item: JsonObject, keySpec: string[]): CanonicalIdentity | null {
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

function conflictingCanonicalIdentity(left: JsonObject, right: JsonObject): boolean {
  if (usableString(left.logicalId) && usableString(right.logicalId) && left.logicalId !== right.logicalId) return true;
  if (usableString(left.canonicalId) && usableString(right.canonicalId) && left.canonicalId !== right.canonicalId) return true;
  const leftStable = usableString(left.stableKey) && ['id', 'href'].includes(String(left.stableKeySource || '').toLowerCase());
  const rightStable = usableString(right.stableKey) && ['id', 'href'].includes(String(right.stableKeySource || '').toLowerCase());
  return leftStable && rightStable && left.stableKey !== right.stableKey;
}

function preferredDuplicate(left: JsonObject, right: JsonObject): JsonObject {
  const leftRevision = Number.isSafeInteger(left.semanticRevision) ? Number(left.semanticRevision) : 0;
  const rightRevision = Number.isSafeInteger(right.semanticRevision) ? Number(right.semanticRevision) : 0;
  return rightRevision > leftRevision ? right : left;
}

function fingerprintCollisionKeys(items: JsonObject[], keySpec: string[]): Set<string> {
  const groups = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.identityAmbiguous === true) continue;
    const fingerprintField = keySpec.find((field) => FINGERPRINT_FIELDS.has(field) && usableString(item[field]));
    if (!fingerprintField) continue;
    const fingerprint = `${fingerprintField}:${item[fingerprintField]}`;
    let group = groups.get(fingerprint);
    if (!group) {
      group = new Set();
      groups.set(fingerprint, group);
    }
    if (usableString(item.logicalId)) group.add(`logicalId:${item.logicalId}`);
    else if (usableString(item.canonicalId)) group.add(`canonicalId:${item.canonicalId}`);
  }
  return new Set([...groups.entries()].filter(([, ids]) => ids.size > 1).map(([key]) => key));
}

function dedupSemanticRecords(sourceInput: unknown, keySpec: string[], options: DedupOptions = {}): Collection {
  if (!Array.isArray(keySpec) || keySpec.length < 1 || keySpec.length > 8
      || keySpec.some((field) => typeof field !== 'string' || !SAFE_SEGMENT.test(field))) {
    fail('INVALID_SEMANTICS', 'DEDUP keySpec is invalid.');
  }
  if (keySpec.every((field) => WEAK_KEY_FIELDS.has(field))) {

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
    return cloneJson<JsonObject>(item);
  });
  const secondaryCollisions = fingerprintCollisionKeys(items, keySpec);
  const output: JsonObject[] = [];
  const identities = new Map<string, { outputIndex: number; sourceIndexes: number[]; identity: CanonicalIdentity }>();
  const ambiguities: Ambiguity[] = [];
  let duplicatesRemoved = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
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
    // The identity map only holds keys it was given, so the entry and its output slot are both present.
    const prior = identities.get(identity.key);
    if (prior === undefined) continue;
    const existing = output[prior.outputIndex];
    if (existing === undefined) continue;
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
  const result: Collection = {
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
  return deepFreeze(cloneJson<Collection>(result));
}

// The COMMAND pending effect always carries a string method; null is only the WAIT_EVENT placeholder, and observation metadata is never derived for that case.

function deriveEffectObservationMeta(_program: ReactiveProgram, pending: { method: string | null }, effectResult: EffectResult, logicalNowMs: number): ObservationMetaEntry {
  const method = pending.method;
  let scopeKind = 'OBSERVED_STATE';
  let observationKind = 'DIRECT_OBSERVATION';
  let dependencyKinds: string[] = [];
  if (method === 'page.capture') {
    scopeKind = 'SCREENSHOT';
    observationKind = 'SCREENSHOT';
    dependencyKinds = ['VIEWPORT'];
  } else if (['page.read', 'page.query', 'page.find', 'page.collect_links'].includes(String(method))) {
    scopeKind = 'LOADED_DOM';
    dependencyKinds = ['ENTITY_SET'];
  }
  return {
    method: method as string,
    logicalNowMs,
    provenance: minimalProvenance(effectResult.provenance),
    observationKind,
    scopeKind,
    boundaryStable: false,
    dependencyFingerprint: `sha256:${'0'.repeat(64)}`,
    dependencyKinds,
  };
}

function observationMetaForSource(state: CollectState, node: CollectNode): { binding: string | null; meta: ObservationMetaEntry | null | undefined } {
  const binding = sourceBindingForExpression(node.source);
  if (binding && state.observationMeta[binding]) return { binding, meta: state.observationMeta[binding] };
  const source = evaluateReactiveExpression(node.source, state.bindings);
  if (isPlainObject(source) && source.schemaVersion === COLLECTION_VERSION) {
    // isPlainObject plus the schemaVersion check above is the runtime truth for this shape; the cast narrows the read-only view of it.
    const bag = source as Record<string, unknown> & {
      provenance?: JsonObject;
      observationKind?: string;
      completion?: { scopeKind?: string; completeWithinScope?: boolean };
      dependencies?: { fingerprint?: string; kinds?: string[] };
    };
    const provenance = bag.provenance;
    if (provenance) {
      return {
        binding,
        meta: {
          method: 'collection',
          logicalNowMs: state.lastLogicalNowMs,
          provenance,
          observationKind: bag.observationKind ?? 'DIRECT_OBSERVATION',
          scopeKind: bag.completion?.scopeKind ?? 'OBSERVED_STATE',
          boundaryStable: bag.completion?.completeWithinScope === true,
          dependencyFingerprint: bag.dependencies?.fingerprint ?? `sha256:${'0'.repeat(64)}`,
          dependencyKinds: bag.dependencies?.kinds ?? [],
        },
      };
    }
  }
  return { binding, meta: null };
}

async function terminalizeCollect(_program: ReactiveProgram, stateInput: CollectState, limit: string, context: JsonObject = {}): Promise<CollectStep> {
  const state = cloneJson<CollectState>(stateInput);
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

function stateBytesWithinBudget(program: ReactiveProgram, state: CollectInnerState | CollectState): boolean {
  return byteLength(canonicalJson(state)) <= program.budgets.persistedCheckpointBytes;
}

// Both COLLECT branches write through the checked collectors, so the binding just written is a Collection: a pre-existing value on the destination was itself written by an earlier COLLECT, and the receipt reads the item count and the completion summary straight off it.

async function executeCollectionNode(program: ReactiveProgram, shadow: ReactiveProgram, state: CollectState, input: AdvanceCollectInput, node: CollectNode | DedupNode): Promise<CollectStep> {
  const inner = await toInnerState(program, shadow, state);
  const advanced = await advanceControlFlowVm(shadow, inner, input);
  let publicState = await fromInnerState(program, advanced.state, state.observationMeta, state.pendingEffect);
  if (publicState.status === 'CANCELLED' || publicState.status === 'EXPIRED' || publicState.status === 'LIMIT_REACHED'
      || publicState.status === 'FAILED' || publicState.status === 'SUSPENDED') {
    return deepFreeze({ state: publicState, transition: await externalizeTransition(program, advanced.transition, publicState, state.pendingEffect) });
  }

  const next = cloneJson<CollectState>(publicState);
  if (!Object.prototype.hasOwnProperty.call(next.bindings, node.destination)
      && Object.keys(next.bindings).length >= program.budgets.bindings) {
    return terminalizeCollect(program, next, 'BINDINGS', { budget: program.budgets.bindings });
  }

  const source: unknown = evaluateReactiveExpression(node.source, state.bindings);
  if (node.type === 'COLLECT') {
    const sourceMeta = observationMetaForSource(state, node);
    next.bindings[node.destination] = collectSemanticRecords(source, node.projection, {
      existing: (state.bindings[node.destination] ?? null) as Collection | null,
      destination: node.destination,
      maxItems: node.maxItems,
      collectionBudget: program.budgets.collectionItemsPerBinding,
      sourceBinding: sourceMeta.binding,
      observationMeta: sourceMeta.meta,
    });
    if (sourceMeta.meta) next.observationMeta[node.destination] = cloneJson<ObservationMetaEntry>(sourceMeta.meta);
  } else {
    next.bindings[node.destination] = dedupSemanticRecords(source, node.keySpec, {
      destination: node.destination,
      collectionBudget: program.budgets.collectionItemsPerBinding,
    });
    const sourceBinding = sourceBindingForExpression(node.source);
    if (sourceBinding && state.observationMeta[sourceBinding]) next.observationMeta[node.destination] = cloneJson<ObservationMetaEntry>(state.observationMeta[sourceBinding]);
  }
  assertNoSensitive(next.bindings[node.destination], `state.bindings.${node.destination}`);
  if (!stateBytesWithinBudget(program, next)) {
    return terminalizeCollect(program, next, 'PERSISTED_CHECKPOINT_BYTES', { budgetBytes: program.budgets.persistedCheckpointBytes });
  }
  publicState = deepFreeze(next);
  const transition = cloneJson<VmTransition>(await externalizeTransition(program, advanced.transition, publicState, state.pendingEffect));
  transition.instruction = node.type;
  transition.destination = node.destination;
  transition.itemCount = (publicState.bindings[node.destination] as Collection).itemCount;
  transition.completion = (publicState.bindings[node.destination] as Collection).completion.status;
  return deepFreeze({ state: publicState, transition: deepFreeze(transition) });
}

export async function createCollectVm(programInput: unknown, options: CreateCollectOptions): Promise<CollectState> {
  const program = await validateCollectProgram(programInput);
  assertExactKeys(
    options,
    ['runId', 'tenantId', 'goalRevision', 'logicalNowMs'],
    ['deadlineAtMs', 'initialBindings', 'initialObservationMeta'],
    'options',
  );
  const shadow = await shadowControlFlowProgram(program);
  const innerOptions = {
    runId: options.runId,
    tenantId: options.tenantId,
    goalRevision: options.goalRevision,
    logicalNowMs: options.logicalNowMs,
    ...(options.deadlineAtMs === undefined ? {} : { deadlineAtMs: options.deadlineAtMs }),
    ...(options.initialBindings === undefined ? {} : { initialBindings: options.initialBindings }),
  };
  const meta = cloneJson<Record<string, ObservationMetaEntry>>(options.initialObservationMeta ?? {});
  validateObservationMeta(meta, program, 'options.initialObservationMeta');
  assertUnifiedBindingBudget(options.initialBindings, meta, program, 'options');
  const inner = await createControlFlowVm(shadow, innerOptions);
  const state = await fromInnerState(program, inner, meta);
  if (!stateBytesWithinBudget(program, state)) fail('OUTPUT_TOO_LARGE', 'Initial 7D state exceeds the checkpoint byte budget.');
  return state;
}

export async function advanceCollectVm(programInput: unknown, stateInput: unknown, input: AdvanceCollectInput): Promise<CollectStep> {
  const program = await validateCollectProgram(programInput);
  const shadow = await shadowControlFlowProgram(program);
  const state = cloneJson<CollectState>(stateInput);
  if (state.schemaVersion !== STATE_VERSION || state.programDigest !== program.programDigest) {
    fail('PROGRAM_DIGEST_MISMATCH', '7D state does not belong to this program.');
  }
  validateObservationMeta(state.observationMeta, program);

  if (!TERMINAL_STATUSES.has(state.status)) assertUnifiedBindingBudget(state.bindings, state.observationMeta, program, 'state');

  if (!TERMINAL_STATUSES.has(state.status) && state.pendingEffect === null && state.waitState === null) {
    const cursorPath = state.cursorPath;
    if (cursorPath === null) fail('INVALID_SEMANTICS', 'non-terminal state requires cursor path.');
    const node = nodeAtPath(program, cursorPath);
    if (node.type === 'COLLECT' || node.type === 'DEDUP') {
      return executeCollectionNode(program, shadow, state, input, node);
    }
  }

  const previousPublicPending = state.pendingEffect ? cloneJson<PendingEffect>(state.pendingEffect) : null;
  const innerState = await toInnerState(program, shadow, state);
  const innerInput = cloneJson<AdvanceCollectInput>(input);
  if (previousPublicPending && input.effectResult !== undefined) {
    const innerInputResult = innerInput.effectResult;
    const innerPending = innerState.pendingEffect;
    if (innerInputResult === undefined || innerPending === null) {
      fail('INVALID_SEMANTICS', 'Effect result requires an inner pending effect.');
    }
    if (innerInputResult.requestDigest !== previousPublicPending.requestDigest) {
      fail('INVALID_SEMANTICS', 'Effect result does not match the pending 7D request.');
    }
    innerInputResult.requestDigest = innerPending.requestDigest;
  }
  const pendingBinding = innerState.pendingEffect?.purpose === 'COMMAND' ? innerState.pendingEffect.resultBinding : null;
  const pendingMethod = innerState.pendingEffect?.purpose === 'COMMAND' ? innerState.pendingEffect.method : null;
  const advanced = await advanceControlFlowVm(shadow, innerState, innerInput);
  const meta = cloneJson<Record<string, ObservationMetaEntry>>(state.observationMeta);
  if (pendingBinding && input.effectResult?.ok === true) {
    const pending = { method: pendingMethod };
    meta[pendingBinding] = deriveEffectObservationMeta(program, pending, input.effectResult, input.logicalNowMs);
  }
  const publicState = await fromInnerState(program, advanced.state, meta, previousPublicPending);
  if (!stateBytesWithinBudget(program, publicState)) {
    return terminalizeCollect(program, publicState, 'PERSISTED_CHECKPOINT_BYTES', { budgetBytes: program.budgets.persistedCheckpointBytes });
  }
  const transition = await externalizeTransition(program, advanced.transition, publicState, previousPublicPending);
  return deepFreeze({ state: publicState, transition });
}
