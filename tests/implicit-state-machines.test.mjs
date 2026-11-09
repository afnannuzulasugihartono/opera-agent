// @last-edited: 2026-11-09 UTC+7.
// @title: implicit-state-machines - the register is the rule; a state machine nobody can name is a bug nobody can find.
// @state: the register validates, the paths are real, the decisions are stated, and this repository cannot ship a state machine the gate cannot see.
// @dependencies: node:test, strict, node:fs, node:url.

// WHY THIS FILE EXISTS.
// Every module whose behavior depends on state nobody declared is an implicit state machine.
// The failures this catches are the product's own confusing states: the ghost listen session, the connected-but-dead bridge, the command that completes after its timeout.
// A gate that only checks style cannot catch those; a register that is never validated rots; this is the one that makes both impossible.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const registerPath = new URL('docs/state-machines.json', root);
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));

const DECISIONS = new Set(['model', 'delete', 'tolerate']);

test('the register parses and names the sweep that produced it', () => {
  const register = read('docs/state-machines.json');
  assert.equal(register.version, 1, 'the schema version is pinned so the gate can read old registers');
  assert.ok(typeof register.generated === 'string' && register.generated.length > 0, 'the register says when it was built');
  assert.ok(typeof register.source === 'string' && register.source.length > 0, 'the register says where the inventory came from');
  assert.ok(Array.isArray(register.machines), 'the register lists its machines');
  assert.ok(register.machines.length >= 30, `the sweep found at least 30 machines, found ${register.machines.length} — if this falls below 30, the sweep shrank, and nobody can say why`);
});

test('every machine in the register is complete enough to act on', () => {
  const register = read('docs/state-machines.json');
  const seen = new Set();
  for (const machine of register.machines) {
    assert.match(machine.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `id ${machine.id} is a kebab-case token`);
    assert.ok(!seen.has(machine.id), `id ${machine.id} appears twice`);
    seen.add(machine.id);
    assert.ok(['extension', 'local', 'lib', 'sql', 'edge', 'site', 'billing', 'tooling'].includes(machine.kind), `${machine.id} names a kind this repo understands, found ${machine.kind}`);
    assert.ok(typeof machine.where === 'string' && machine.where.length > 0, `${machine.id} points somewhere`);
    assert.ok(Array.isArray(machine.states) && machine.states.length >= 2, `${machine.id} declares at least two states — a machine with one state is a constant, not a machine`);
    assert.ok(typeof machine.wrongIfConfused === 'string' && machine.wrongIfConfused.length >= 40, `${machine.id} says what a user sees when confused — the reason the machine exists`);
    assert.ok(DECISIONS.has(machine.decision), `${machine.id} decides: ${[...DECISIONS].join(' or ')}`);
    assert.ok(typeof machine.why === 'string' && machine.why.length >= 40, `${machine.id} says why that decision — a reason nobody else has yet`);
    assert.ok(Number.isInteger(machine.rank) && machine.rank >= 1 && machine.rank <= 5, `${machine.id} ranks within 1 (fix first) to 5`);
  }
});

test('every location in the register resolves to a file in this repository', () => {
  const register = read('docs/state-machines.json');
  for (const machine of register.machines) {
    const file = machine.where
      .replace(/\s*\(.*\)\s*$/, '')
      .replace(/:.*$/, '')
      .trim();
    assert.ok(fs.existsSync(new URL(file, root)), `${machine.id} points at ${file}, which does not exist`);
  }
});

test('the register is sorted by rank, then id, so the urgent machine is first', () => {
  const register = read('docs/state-machines.json');
  const keys = register.machines.map((m) => [m.rank, m.id]);
  const sorted = [...keys].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  assert.deepEqual(keys, sorted, 'state machines are registered by urgency: rank ascending, id as tiebreak — if the register is not sorted, an urgent machine can be hiding at the bottom');
});

test('this repository carries the rule it is named for', () => {
  const agents = fs.readFileSync(new URL('AGENTS.md', root), 'utf8');
  assert.match(agents, /implicit state machine/i, 'AGENTS.md must carry the implicit state machines rule');
  assert.match(agents, /user > developer > agent/i, 'the rule names the order it refuses to invert');
});
