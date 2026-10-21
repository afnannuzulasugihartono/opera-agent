// @last-edited: 2026-10-15 UTC+7.
// @title: agent-guide — the roads are honest, and honesty is a build failure when they are not.
// @state: recipe-to-tool locks, side-effect coverage, topic filtering.
// @dependencies: node:test, strict, ../local/agent-guide.js, ../local/mcp-server.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RECIPES, SIDE_EFFECTS, guide } from '../local/agent-guide.js';
import { TOOLS } from '../local/mcp-server.js';

const names = new Set(TOOLS.map((tool) => tool.name));

// WHY THE GUIDE IS PINNED AGAINST THE TOOL LIST AND NOT AGAINST ITSELF.
// A guide that names a tool which no longer exists is worse than no guide: the agent follows the road, the call fails, and the guide is the thing it stops trusting.
// So the lock is between the guide and the real list, and a rename breaks the build instead of surprising an agent in production.

test('every tool named in a recipe exists on the server', () => {
  for (const recipe of RECIPES) {
    for (const step of recipe.do) {
      assert.ok(names.has(step), `${recipe.task} names "${step}", which is not a tool`);
    }
  }
});

test('every tool declares what it does to the page', () => {
  for (const name of names) {
    assert.ok(Object.hasOwn(SIDE_EFFECTS, name), `${name} has no declared side effect`);
  }
});

test('a side effect says something or is honestly empty', () => {
  for (const [tool, effects] of Object.entries(SIDE_EFFECTS)) {
    assert.ok(Array.isArray(effects), `${tool} effects is a list`);
    for (const effect of effects) {
      assert.equal(typeof effect, 'string');
      assert.ok(effect.length > 8, `"${effect}" names no consequence`);
    }
  }
});

// WHY THE MOVING READS ARE DECLARED, PINNED HERE.
// Half of what an agent loses is not a missing tool but an unannounced one: reading a Doc moves the caret, so the next click lands where the agent has already been.
// The declaration is the fix, and a declaration nobody reads is decoration — so this test fails if the two moving reads ever lose theirs.

test('the reads that move the page say so', () => {
  assert.ok(SIDE_EFFECTS.read_page.some((effect) => /caret/i.test(effect)));
  assert.ok(SIDE_EFFECTS.caret_line.some((effect) => /caret/i.test(effect)));
});

test('a topic returns the roads for that task and nothing else', () => {
  const upload = guide('upload');

  assert.ok(upload.recipes.length > 0, 'a topic that exists returns something');
  assert.ok(upload.recipes.every((recipe) => /upload|file/i.test(`${recipe.task} ${recipe.note}`)));
});

test('no topic returns every road and every side effect', () => {
  const whole = guide();

  assert.equal(whole.recipes.length, RECIPES.length);
  assert.equal(whole.sideEffects.length, names.size);
});

test('an unknown topic is an empty answer, not a wrong one', () => {
  const nothing = guide('teleportation');

  assert.deepEqual(nothing.recipes, []);
  assert.ok(nothing.sideEffects.length > 0, 'the side effects are still the whole surface');
});

// WHY THE REFUSALS TRAVEL WITH THE GUIDE.
// An agent that has not yet hit a boundary should not have to hit it first.
// The three lines are the ones that cost real time today: a native dialog that cannot be touched, a read-only question that looks like a free script, a tool reporting success when the page says otherwise, and a drive that cannot tell a page which ignored it from a window that was behind something the whole time.

test('the guide names the four things it will not pretend to do', () => {
  const { refusals } = guide();

  assert.equal(refusals.length, 4);
  assert.ok(refusals.some((line) => /native operating-system dialog/i.test(line)));
  assert.ok(refusals.some((line) => /ask_page refuses/i.test(line)));
  assert.ok(refusals.some((line) => /not proof/i.test(line)));
  assert.ok(refusals.some((line) => /cannot see whether the window in front/i.test(line)));
});