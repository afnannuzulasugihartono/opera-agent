// @last-edited: 2026-10-27 UTC+7.
// @title: surface-drive-browser — the shipped ladder, driven against a real browser.
// @state: one drill that profiles a real surface, reads it through the gated ladder, and proves the caret was not moved.
// @dependencies: node:test, node:assert/strict, ../local/driver.js.

// WHY THIS DRILL IS SKIPPED RATHER THAN FAKED.
// A unit test proves the decision; only a real browser proves the drive.
// This drill needs a browser listening on a debugging port with a page to read, which a CI machine does not have, so it says so and stays out of the way instead of pretending.

import test from 'node:test';
import assert from 'node:assert/strict';

import { openSession } from '../local/driver.js';

const PORT = Number(process.env.OPERA_DRILL_PORT || 9333);
const TARGET = process.env.OPERA_DRILL_TARGET || '';
const skip = TARGET === '' ? 'set OPERA_DRILL_TARGET to a page target from http://127.0.0.1:9333/json/list to run this drill' : false;

test('the profile answers a real surface and moves nothing', { skip }, async () => {
  const session = await openSession({
    id: 'brave',
    port: PORT,
    targetId: TARGET,
    viaBridge: false,
    launch: false,
    timeoutMs: 20000
  });
  try {
    const started = Date.now();
    const profile = await session.surfaceProfile();
    const elapsed = Date.now() - started;

    assert.equal(typeof profile.surface.canvas, 'boolean');
    assert.equal(typeof profile.surface.editable, 'boolean');
    assert.equal(typeof profile.surface.axRich, 'boolean');
    assert.ok(Array.isArray(profile.strategy) && profile.strategy.length >= 3);
    assert.ok(Array.isArray(profile.action) && profile.action.length === 2);
    assert.ok(profile.description.length > 0);
    for (const forbidden of ['docs.google', 'kix']) {
      assert.ok(!profile.description.includes(forbidden), 'the description names no site');
    }
    console.log(`surface_profile: ${profile.description} in ${elapsed}ms`);
  } finally {
    await session.close();
  }
});

test('a read without consent moves no caret and names what it skipped', { skip }, async () => {
  const session = await openSession({
    id: 'brave',
    port: PORT,
    targetId: TARGET,
    viaBridge: false,
    launch: false,
    timeoutMs: 20000
  });
  try {
    const started = Date.now();
    const read = await session.read({ allowCaretMove: false });
    const elapsed = Date.now() - started;

    assert.equal(read.caretMoved, false, 'no consent means the selection is never borrowed');
    assert.equal(read.harm, 'none', 'the step that ran asked nothing of the page');
    const caretish = read.skipped.filter((entry) => entry.harm === 'caret-move');
    for (const entry of caretish) assert.match(entry.why, /consent/i);
    console.log(`read (no consent): strategy ${read.strategy}, ${(read.text || '').length} chars in ${elapsed}ms, skipped ${read.skipped.length}`);
  } finally {
    await session.close();
  }
});

// WHY THIS DRILL DOES NOT FORCE THE GATED STEP.
// On a surface whose accessibility tree answers, the ladder never reaches the borrow, and that is the right order rather than a gap in the test.
// The gate itself is pinned by tests/surface-drive.test.mjs against a fake, where the accessibility tree can be made poor on purpose; what this drill proves is that the ladder really does answer a real canvas page before the borrow is ever considered.

test('a read with consent answers, and the verdict is honest whatever ran', { skip }, async () => {
  const session = await openSession({
    id: 'brave',
    port: PORT,
    targetId: TARGET,
    viaBridge: false,
    launch: false,
    timeoutMs: 20000
  });
  try {
    const started = Date.now();
    const read = await session.read({ allowCaretMove: true });
    const elapsed = Date.now() - started;

    assert.ok((read.text || '').length > 0, 'the canvas text came back');
    assert.equal(typeof read.caretMoved, 'boolean');
    assert.equal(read.caretMoved, read.strategy === 'select-all', 'the caret moved only if the borrow ran');
    if (read.strategy === 'select-all') {
      assert.equal(typeof read.caretRestored, 'boolean');
      assert.ok(read.caret.why.length > 0, 'the verdict explains itself');
    }
    console.log(`read (consent): strategy ${read.strategy}, ${read.text.length} chars in ${elapsed}ms, caretMoved ${read.caretMoved}`);
  } finally {
    await session.close();
  }
});
