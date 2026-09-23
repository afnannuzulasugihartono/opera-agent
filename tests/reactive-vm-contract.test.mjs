import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const contract = readJson('reactive-vm-contract-v1.json');
const programSchema = readJson('reactive-vm-program-schema-v1.json');
const checkpointSchema = readJson('reactive-vm-checkpoint-schema-v1.json');
const programs = readJson('reactive-vm-programs-v1.json');
const checkpoints = readJson('reactive-vm-checkpoints-v1.json');
const replay = readJson('reactive-vm-replay-v1.json');
const vectors = readJson('reactive-vm-digest-vectors-v1.json');
const thresholds = readJson('reactive-vm-thresholds-v1.json');
const mcp = readJson('mcp-contract-v1.json');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const protocol = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') { assert.equal(Number.isSafeInteger(value), true); return String(value); }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  assert.equal(typeof value, 'object');
  const keys = Object.keys(value);
  keys.forEach((key) => assert.match(key, /^[\x20-\x7e]+$/));
  keys.sort((a, b) => Buffer.compare(Buffer.from(a, 'ascii'), Buffer.from(b, 'ascii')));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const digest = (value) => `sha256:${crypto.createHash('sha256').update(canonical(value), 'utf8').digest('hex')}`;
const effects = new Map(contract.effectClassification.map((entry) => [entry.method, entry]));
const exprOps = new Set(contract.expressionGrammar.operators);

function hasCycle(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) if (hasCycle(child, seen)) return true;
  seen.delete(value);
  return false;
}
function validateExpr(expr) {
  if (!expr || typeof expr !== 'object' || Array.isArray(expr) || !exprOps.has(expr.op)) return 'UNKNOWN_EXPRESSION';
  if (expr.op === 'PATH') {
    if (!Array.isArray(expr.path) || expr.path.length < 1 || expr.path.some((p) => !/^[A-Za-z0-9_-]{1,64}$/.test(p) || ['__proto__','prototype','constructor'].includes(p))) return 'UNKNOWN_EXPRESSION';
    if (expr.path[0] === 'pageText') return 'UNTRUSTED_PROGRAM_SOURCE';
  }
  for (const item of expr.args || []) { const error = validateExpr(item); if (error) return error; }
  return expr.arg ? validateExpr(expr.arg) : null;
}
function semanticValidate(program) {
  if (!program || typeof program !== 'object' || Array.isArray(program)) return 'INVALID_SCHEMA';
  if (hasCycle(program)) return 'INVALID_SEMANTICS';
  if (Buffer.byteLength(JSON.stringify(program)) > contract.limits.serializedProgramBytes) return 'PROGRAM_TOO_LARGE';
  if (program.schemaVersion !== 'OA_REACTIVE_VM_V1' || !Number.isSafeInteger(program.goalRevision) || program.goalRevision < 1) return 'INVALID_SCHEMA';
  if (!program.target || !Number.isInteger(program.target.tabId) || program.target.tabId < 0 || !program.target.deviceId) return 'INVALID_SCHEMA';
  if (!program.budgets || Object.keys(contract.limits).some((key) => !Number.isSafeInteger(program.budgets[key]) || program.budgets[key] < 1 || program.budgets[key] > contract.limits[key])) return 'INVALID_SCHEMA';
  if (program.programDigest !== digest(Object.fromEntries(Object.entries(program).filter(([key]) => key !== 'programDigest')))) return 'PROGRAM_DIGEST_MISMATCH';
  let staticNodes = 0;
  const walk = (node, depth = 1, controlDepth = 0) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return 'INVALID_SCHEMA';
    if (++staticNodes > contract.limits.astNodes) return 'NODE_BUDGET_EXCEEDED';
    if (depth > contract.limits.astDepth) return 'AST_TOO_DEEP';
    const nextControl = controlDepth + (['IF','LOOP','UNTIL','RETRY'].includes(node.type) ? 1 : 0);
    if (nextControl > contract.limits.controlFlowDepth) return 'CONTROL_FLOW_TOO_DEEP';
    if (node.type === 'SEQUENCE') { if (!Array.isArray(node.children)) return 'INVALID_SCHEMA'; for (const child of node.children) { const e = walk(child, depth + 1, nextControl); if (e) return e; } return null; }
    if (node.type === 'IF') { const e = validateExpr(node.predicate); if (e) return e; const a = walk(node.then, depth + 1, nextControl); return a || (node.else ? walk(node.else, depth + 1, nextControl) : null); }
    if (node.type === 'LOOP' || node.type === 'UNTIL') { if (!Number.isInteger(node.maxIterations) || node.maxIterations < 1 || node.maxIterations > 50) return 'ITERATION_BUDGET_EXCEEDED'; if (node.type === 'UNTIL') { const e = validateExpr(node.predicate); if (e) return e; } return walk(node.body, depth + 1, nextControl); }
    if (node.type === 'WAIT_EVENT') { if (!Number.isInteger(node.timeoutMs) || node.timeoutMs < 1 || node.timeoutMs > 15000) return 'WAIT_BUDGET_EXCEEDED'; const effect = effects.get(node.observation?.method); if (!effect || effect.classification !== 'READ_ONLY_ALLOWED' || !effect.initialV1Allowed) return 'DISALLOWED_COMMAND'; if (node.observation?.arguments?.executionMode === 'foreground') return 'FOREGROUND_FORBIDDEN'; return validateExpr(node.predicate); }
    if (node.type === 'ASSERT') return validateExpr(node.predicate);
    if (node.type === 'COLLECT') return (!Number.isInteger(node.maxItems) || node.maxItems < 1 || node.maxItems > 1000) ? 'BINDING_BUDGET_EXCEEDED' : validateExpr(node.source);
    if (node.type === 'DEDUP') return validateExpr(node.source);
    if (node.type === 'RETRY') return (!node.policy || !Number.isInteger(node.policy.attempts) || node.policy.attempts < 1 || node.policy.attempts > 3) ? 'RETRY_BUDGET_EXCEEDED' : walk(node.body, depth + 1, nextControl);
    if (node.type === 'RETURN') return validateExpr(node.valueSpec);
    if (node.type === 'SUSPEND') return contract.suspensionReasons.includes(node.reason) ? null : 'INVALID_SEMANTICS';
    if (node.type === 'COMMAND') { const effect = effects.get(node.method); if (!effect?.initialV1Allowed) return 'DISALLOWED_COMMAND'; if (node.method === 'browser.burst' && (!Array.isArray(node.arguments?.steps) || node.arguments.steps.length < 1 || node.arguments.steps.some((s) => !['read','find','wait'].includes(s.action)))) return 'DISALLOWED_COMMAND'; return node.arguments?.executionMode === 'foreground' ? 'FOREGROUND_FORBIDDEN' : null; }
    return 'UNKNOWN_NODE';
  };
  const structural = walk(program.root); if (structural) return structural;
  const zero = () => ({ nodes:0, commands:0, iterations:0, wait:0, bindings:new Set() });
  const plus = (a,b) => ({ nodes:a.nodes+b.nodes, commands:a.commands+b.commands, iterations:a.iterations+b.iterations, wait:a.wait+b.wait, bindings:new Set([...a.bindings,...b.bindings]) });
  const scale = (m,n) => ({ nodes:m.nodes*n, commands:m.commands*n, iterations:m.iterations*n, wait:m.wait*n, bindings:new Set(m.bindings) });
  const estimate = (node) => {
    const own = { nodes:1, commands:0, iterations:0, wait:0, bindings:new Set() };
    if (node.type === 'COMMAND') { own.commands=1; if (node.resultBinding) own.bindings.add(node.resultBinding); return own; }
    if (node.type === 'WAIT_EVENT') { own.wait=node.timeoutMs; return own; }
    if (node.type === 'COLLECT' || node.type === 'DEDUP') { if (node.destination) own.bindings.add(node.destination); return own; }
    if (node.type === 'SEQUENCE') return node.children.reduce((a,c) => plus(a, estimate(c)), own);
    if (node.type === 'IF') { const a=estimate(node.then), b=node.else?estimate(node.else):zero(); return plus(own,{nodes:Math.max(a.nodes,b.nodes),commands:Math.max(a.commands,b.commands),iterations:Math.max(a.iterations,b.iterations),wait:Math.max(a.wait,b.wait),bindings:new Set([...a.bindings,...b.bindings])}); }
    if (node.type === 'LOOP' || node.type === 'UNTIL') { const body=scale(estimate(node.body),node.maxIterations); body.iterations += node.maxIterations; return plus(own,body); }
    if (node.type === 'RETRY') return plus(own,scale(estimate(node.body),node.policy.attempts));
    return own;
  };
  const m=estimate(program.root);
  if (m.nodes > program.budgets.executedNodesPerRun) return 'NODE_BUDGET_EXCEEDED';
  if (m.commands > program.budgets.browserCommandLeavesPerRun) return 'COMMAND_BUDGET_EXCEEDED';
  if (m.iterations > program.budgets.totalIterationsPerRun) return 'ITERATION_BUDGET_EXCEEDED';
  if (m.wait > program.budgets.cumulativeWaitMs) return 'WAIT_BUDGET_EXCEEDED';
  if (m.bindings.size > program.budgets.bindings) return 'BINDING_BUDGET_EXCEEDED';
  return null;
}
function validateCheckpoint(c, tenant, programDigest) {
  const forbidden=new Set(contract.checkpointPersistence.forbiddenRawFields), allowed=new Set(['schemaVersion',...contract.checkpointPersistence.allowedFields]);
  for (const key of Object.keys(c)) if (forbidden.has(key)) return 'SENSITIVE_VALUE';
  for (const key of Object.keys(c)) if (!allowed.has(key)) return 'INVALID_SCHEMA';
  if (c.schemaVersion !== 'OA_REACTIVE_VM_CHECKPOINT_V1') return 'INVALID_SCHEMA';
  if (c.tenant_id !== tenant) return 'CROSS_TENANT';
  if (!Number.isSafeInteger(c.goal_revision) || c.goal_revision < 1) return 'STALE_GOAL_REVISION';
  if (c.program_digest !== programDigest) return 'CHECKPOINT_DIGEST_MISMATCH';
  return Buffer.byteLength(JSON.stringify(c)) > 131072 ? 'OUTPUT_TOO_LARGE' : null;
}
function capabilities() {
  const block=protocol.match(/export const METHOD_SPECS = Object\.freeze\(\{([\s\S]*?)\n\}\);/); assert.ok(block);
  return [...block[1].matchAll(/^\s*'([^']+)':\s*\{/gm)].map((m)=>m[1]);
}
const redigest = (root) => { const p=structuredClone(programs.valid[0]); p.programId=`generated-${root.type.toLowerCase()}`; p.root=root; p.programDigest=digest(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='programDigest'))); return p; };

test('7A contract schemas preserve public compatibility while 7B implements the frozen core',()=>{ assert.equal(contract.runtimeStatus,'CONTRACT_ONLY_NO_STEPPER'); assert.equal(programSchema.$defs.node.oneOf.length,12); assert.equal(checkpointSchema.additionalProperties,false); assert.equal(pkg.version,'1.6.9'); assert.equal(manifest.version,'1.6.9'); assert.equal(contract.internalSurfaceDecision.decision,'NO_NEW_MCP_TOOL'); });
test('7A semantic fixtures fail closed before execution',()=>{ programs.valid.forEach((p)=>assert.equal(semanticValidate(p),null,p.programId)); programs.invalid.forEach((x)=>assert.equal(semanticValidate(x.program),x.expectedError,x.id)); const cyclic=structuredClone(programs.valid[0]); cyclic.root.children.push(cyclic.root); assert.equal(semanticValidate(cyclic),'INVALID_SEMANTICS'); });
test('7A aggregate worst-case budgets are rejected',()=>{ const cmd=(i)=>({type:'COMMAND',method:'page.read',arguments:{},resultBinding:`r${i}`}); assert.equal(semanticValidate(redigest({type:'SEQUENCE',children:Array.from({length:201},(_,i)=>cmd(i))})),'COMMAND_BUDGET_EXCEEDED'); assert.equal(semanticValidate(redigest({type:'SEQUENCE',children:Array.from({length:6},()=>({type:'LOOP',maxIterations:50,body:{type:'RETURN',valueSpec:{op:'CONST',value:1}}}))})),'ITERATION_BUDGET_EXCEEDED'); assert.equal(semanticValidate(redigest({type:'SEQUENCE',children:Array.from({length:5},()=>({type:'WAIT_EVENT',observation:{method:'page.read',arguments:{}},predicate:{op:'CONST',value:false},intervalMs:100,timeoutMs:15000}))})),'WAIT_BUDGET_EXCEEDED'); assert.equal(semanticValidate(redigest({type:'SEQUENCE',children:Array.from({length:65},(_,i)=>({type:'COLLECT',source:{op:'CONST',value:1},projection:['id'],destination:`c${i}`,maxItems:1}))})),'BINDING_BUDGET_EXCEEDED'); });
test('7A checkpoint is bounded metadata only',()=>{ const valid=checkpoints.valid[0]; assert.equal(validateCheckpoint(valid,'tenant-test',valid.program_digest),null); checkpoints.invalid.forEach((x)=>assert.equal(validateCheckpoint(x.checkpoint,'tenant-test',valid.program_digest),x.expectedError,x.id)); contract.checkpointPersistence.forbiddenRawFields.forEach((x)=>assert.equal(contract.checkpointPersistence.allowedFields.includes(x),false)); });
test('7A transitions, statuses, effects and limits are explicit',()=>{ assert.equal(contract.instructionTransitions.length,12); assert.equal(contract.suspensionReasons.length,10); assert.deepEqual(contract.checkpointStatuses,['READY','RUNNING','SUSPENDED','RETURNED','LIMIT_REACHED','FAILED','CANCELLED','EXPIRED']); assert.equal(contract.limits.astNodes,256); assert.equal(contract.limits.controlFlowDepth,4); assert.equal(contract.limits.browserCommandLeavesPerRun,200); assert.equal(contract.limits.executionSliceMs,20000); assert.equal(contract.limits.runDeadlineMs,300000); assert.equal(contract.replaySemantics.effectMayDuplicate,false); assert.equal(contract.replaySemantics.pageTextCanDefineProgram,false); assert.equal(contract.replaySemantics.commandReceiptCanProveCompletion,false); });
test('7A effect table locks protocol 1 / 26 capabilities / 22 MCP tools (U-T rebaseline: watch tools added)',()=>{ const actual=capabilities(); assert.equal(actual.length,26); assert.deepEqual(contract.inventory.value.capabilities,actual); assert.equal(contract.effectClassification.length,26); assert.ok(contract.effectClassification.filter((x)=>x.initialV1Allowed).every((x)=>['READ_ONLY_ALLOWED','READ_ONLY_SUBSET_ALLOWED'].includes(x.classification))); ['tabs.activate','tabs.navigate','media.play'].forEach((m)=>assert.equal(effects.get(m).initialV1Allowed,false)); assert.equal(mcp.toolCount,22); });
test('7A hostile corpus exceeds 24 cases with zero unsafe acceptance',()=>{ assert.ok(replay.cases.length>=24); assert.equal(new Set(replay.cases.map((x)=>x.id)).size,replay.cases.length); replay.cases.forEach((x)=>{ assert.equal(x.focusChanges,0,x.id); assert.equal(x.crossTenantAccepted,false,x.id); assert.equal(x.sensitivePersisted,false,x.id); assert.equal(x.falseCompletion,false,x.id); }); });
test('7A canonical vectors and inventory digest agree for 100 runs',()=>{ vectors.vectors.forEach((v)=>{ assert.equal(canonical(v.input),v.canonical); const outputs=Array.from({length:100},()=>digest(v.input)); assert.equal(new Set(outputs).size,1); assert.equal(outputs[0],v.digest); }); const value={protocolVersion:1,capabilityCount:capabilities().length,capabilities:capabilities(),mcpToolCount:mcp.toolCount,mcpSourceSha256:mcp.sourceSha256,mcpTools:mcp.tools}; assert.equal(digest(value),contract.inventory.digest); assert.equal(contract.inventory.digest,thresholds.inventoryDigest); });
test('7A baselines remain 1.6.0 and do not claim VM runtime performance',()=>{ assert.equal(thresholds.baselineVersion,'1.6.0'); assert.equal(thresholds.pairedWorkflowBaseline.richReadMedianMs,19.83); assert.equal(thresholds.pairedWorkflowBaseline.richReadP95Ms,20.65); assert.equal(thresholds.pairedWorkflowBaseline.burstStabilityPassed,20); assert.equal(thresholds.pairedPureComputeBaseline.ledgerValidationMedianMs,0.2949); assert.equal(thresholds.pairedPureComputeBaseline.proof500P95Ms,2.4166); assert.match(thresholds.note,/no VM runtime/i); });
