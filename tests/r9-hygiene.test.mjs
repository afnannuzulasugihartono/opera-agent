// R9 hygiene (2026-09-30): properties that keep the R9 code correct as it
// grows, and that the R9 code itself violated when first written.
//
// Each case here corresponds to a real defect found by audit, not a style
// preference. They are cheap and they fail loudly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FOCUS_GATE_ATTEMPTS } from '../extension/lib/focus-gate.js';

await import('../extension/role-reconcile.js');
await import('../extension/hover-settle.js');

const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');

test('a read is serialized once, not once per size check', () => {
  // page.read measures the result against the ceiling and the dispatcher then
  // measures it again. Without a memo, every read paid a second full
  // JSON.stringify on the hottest observation path in the product. The memo
  // covers RESULT sizing only; the file has other legitimate uses (request
  // body, cache key, burst size, error candidates), so the assertion is scoped
  // to the three functions involved.
  const block = background.slice(
    background.indexOf('function boundedResult'),
    background.indexOf('// ---- U-T Event-Triggered Workflows')
  );
  assert.equal((block.match(/JSON\.stringify\(/g) || []).length, 1, 'exactly one stringify in the result-sizing path');
  assert.match(background, /function serializeResult\(value\)/);
  assert.match(background, /if \(serializedResult\.value === value\) return serializedResult\.text;/);
  assert.match(block, /function oversized\(value\) \{\s*return serializeResult\(value\)\.length > MAX_RESULT_BYTES;/);
  const bounded = block.slice(block.indexOf('function boundedResult'), block.indexOf('function oversized'));
  assert.match(bounded, /const text = serializeResult\(value\)/);
  // Unserializable input still fails loudly rather than being silently accepted.
  assert.match(background, /Result is not serializable\./);
});

test('the memo cannot retain a large result between commands', () => {
  // The memo is keyed on identity, so it holds at most one result, but a stale
  // reference would pin a large object for the worker's lifetime. It is
  // cleared per command.
  assert.match(background, /let serializedResult = \{ value: null, text: '' \};/);
  const executor = background.slice(background.indexOf('async function executeCommand'));
  assert.match(executor.slice(0, 900), /serializedResult = \{ value: null, text: '' \};/);
});

test('the focus gate loop is bounded by construction', () => {
  // It was a conditionless for(;;), which reads as unbounded even though the
  // policy module always refuses on the final attempt.
  const gate = background.slice(
    background.indexOf('async function withForegroundFocusGate'),
    background.indexOf('// U-V Action Pipeline')
  );
  assert.doesNotMatch(gate, /for \([^;]*;\s*;/);
  assert.match(gate, /for \(let attempt = 1; attempt <= FOCUS_GATE_ATTEMPTS; attempt \+= 1\)/);
  assert.match(gate, /FOCUS_GATE_SETTLE_MS/);
  assert.equal(FOCUS_GATE_ATTEMPTS, 3);
});

test('the shared runtimes are frozen, so a sibling script cannot mutate them', () => {
  const roles = globalThis.OperaAgentRoleReconcile;
  const hover = globalThis.OperaAgentHoverSettle;
  assert.equal(Object.isFrozen(roles), true, 'the role runtime must be frozen');
  assert.equal(Object.isFrozen(hover), true, 'the hover runtime must be frozen');
  // Object.freeze does NOT make a Set immutable, so the role list is published
  // as a frozen array. Assert it is an array, not a Set: handing out the Set
  // would leave it writable through .add().
  assert.equal(Array.isArray(roles.GENERIC_ROLES), true, 'GENERIC_ROLES must be an array, not a Set');
  assert.equal(Object.isFrozen(roles.GENERIC_ROLES), true);
  assert.throws(() => { roles.GENERIC_ROLES.push('button'); }, TypeError);
  assert.equal(roles.isGenericRole('button'), false, 'a rejected mutation must not take effect');
  assert.throws(() => { hover.DEFAULTS.timeoutMs = 99999; }, TypeError);
  assert.equal(hover.DEFAULTS.timeoutMs, 1500, 'the settle budget must be unchanged');
});

test('the role gap sample is a positive integer, not an accidental truthy value', () => {
  const { ROLE_GAP_SAMPLE_SIZE } = globalThis.OperaAgentRoleReconcile;
  assert.equal(Number.isInteger(ROLE_GAP_SAMPLE_SIZE), true);
  assert.ok(ROLE_GAP_SAMPLE_SIZE > 0);
});

test('the R9 modules expose no unused surface', async () => {
  // keyNames() existed only to seed KEY_ALLOWLIST; a public helper nothing
  // calls is dead weight on a file a sibling script loads on every page.
  const keyboard = await readFile(new URL('../extension/lib/keyboard.js', import.meta.url), 'utf8');
  const uses = keyboard.match(/keyNames/g) || [];
  assert.equal(uses.length, 2, 'keyNames must be referenced only by its declaration and its one caller');
  assert.match(keyboard, /export const KEY_ALLOWLIST = Object\.freeze\(keyNames\(\)\)/);
});
