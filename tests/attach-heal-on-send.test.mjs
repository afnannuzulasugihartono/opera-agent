// @last-edited: 2026-10-14 UTC+7.
// @title: attach-heal-on-send.test — a cached attach that another road released heals itself.
// @state: unit pins the heal helper plus the source pin proving withDebugger uses it.
// @dependencies: node:test, strict, node:fs/promises, ../extension/worker/capture.js.

// WHY THE SEND SIDE HEALS. Shared sessions cache attached:true so repeat
// calls skip the attach. Anything else that detaches the debugger — the relay
// road in this same extension, a DevTools window, a browser restart — leaves
// the cache lying, and every later send then fails "not attached" for good:
// observed live as one tab permanently dead on the bridge while the relay
// drove the very same tab happily. Healing on attach cannot catch it, because
// the attach was skipped.

import test from 'node:test';
import assert from 'node:assert/strict';

const { withAttachHeal } = await import('../extension/worker/capture.js');

const NOT_ATTACHED = new Error('Debugger is not attached to the tab with id: 7.');

test('a send that fails as detached is retried once behind a heal', async () => {
  let sends = 0;
  let heals = 0;

  const result = await withAttachHeal(7, async () => {
    sends += 1;
    if (sends === 1) throw NOT_ATTACHED;
    return { ok: true };
  }, async () => {
    heals += 1;
  });

  assert.equal(heals, 1, 'the cache is corrected before the retry');
  assert.equal(sends, 2, 'the command runs again after the heal');
  assert.deepEqual(result, { ok: true });
});

test('any other failure propagates untouched and heals nothing', async () => {
  let heals = 0;
  await assert.rejects(
    () => withAttachHeal(7, async () => { throw new Error('Target closed.'); }, async () => { heals += 1; }),
    /Target closed/
  );
  assert.equal(heals, 0, 'a foreign error must not trigger a detach');
});

test('a second detached failure gives up instead of healing forever', async () => {
  let heals = 0;
  await assert.rejects(
    () => withAttachHeal(7, async () => { throw NOT_ATTACHED; }, async () => { heals += 1; }),
    /not attached/
  );
  assert.equal(heals, 1, 'exactly one heal, then the honest failure reaches the caller');
});
