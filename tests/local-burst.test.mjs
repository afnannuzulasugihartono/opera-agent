// @last-edited: 2026-10-22 UTC+7.
// @title: local-burst — dependent steps on one tab, one page read at the end.
// @state: step bounds, ref integrity, stop-on-failure, and a whole-burst deadline.
// @dependencies: node:test, strict, ../local/drive/burst.js.

// WHY THIS FILE EXISTS

// A browser job is a sequence of dependent moves: resolve the menu, hover it, wait for the submenu, click the row.
// Driving every move as its own MCP call pays a tool turn, a settle and a page snapshot between each one, and the snapshot is the half that was already known.
// This file locks the local burst to the smaller shape: one call, one final look, and the first failure stops the sequence instead of sending the next step into a page it does not recognise.

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeBurst, runLocalBurst } from '../local/drive/burst.js';

function fakeDriver() {
  const calls = [];
  const driver = {
    calls,
    resolve: async (role, name) => {
      calls.push(['resolve', role, name]);
      return { role, name, x: 10, y: 20, handle: 'opera-7' };
    },
    click: async (x, y, handle = null) => {
      calls.push(['click', x, y, handle]);
      return { x, y, handle };
    },
    hover: async (x, y) => {
      calls.push(['hover', x, y]);
      return { x, y };
    },
    clickRow: async (role, name) => {
      calls.push(['clickRow', role, name]);
      return { role, name, x: 1, y: 2 };
    },
    key: async (key, modifiers) => {
      calls.push(['key', key, modifiers]);
      return { key, modifiers };
    },
    type: async (text) => {
      calls.push(['type', text]);
      return { chars: text.length };
    },
    append: async (text) => {
      calls.push(['append', text]);
      return { chars: text.length };
    },
    scroll: async (options) => {
      calls.push(['scroll', options]);
      return { movedPx: options.y ?? 0 };
    },
    keys: async (events) => {
      calls.push(['keys', events]);
      return { events: events.length };
    },
    waitForText: async (text, options) => {
      calls.push(['waitForText', text, options]);
      return { url: 'https://example.test/', title: 'Example', text: `the ${text} is here` };
    },
    waitForRow: async (options) => {
      calls.push(['waitForRow', options]);
      return { found: true, role: options.role, name: options.name, row: { role: options.role, name: options.name } };
    }
  };
  return driver;
}

test('a burst is one to eight steps and refuses a step that is not on the list', () => {
  assert.throws(() => normalizeBurst({ steps: [] }), /1-8 steps/);
  assert.throws(() => normalizeBurst({ steps: Array.from({ length: 9 }, () => ({ action: 'click', x: 1, y: 2 })) }), /1-8 steps/);
  assert.throws(() => normalizeBurst({ steps: [{ action: 'eval', expression: '1+1' }] }), /action/);
  assert.throws(() => normalizeBurst({ steps: [{ action: 'click', x: 1, y: 2, surprise: true }] }), /unknown key "surprise"/);
});

test('a ref can only point at an earlier step', () => {
  assert.throws(
    () => normalizeBurst({ steps: [{ action: 'click', refFromStep: 0 }] }),
    /earlier/
  );
  assert.throws(
    () => normalizeBurst({ steps: [{ action: 'resolve', role: 'menuitem', name: 'Insert' }, { action: 'click', refFromStep: 2 }] }),
    /earlier/
  );
});

test('the whole burst is capped at twelve seconds', () => {
  const normalized = normalizeBurst({ steps: [{ action: 'press_key', key: 'Enter' }], timeoutMs: 999999 });

  assert.equal(normalized.timeoutMs, 12000);
});

test('a ref carries the handle from resolve into the click, never a guessed point', async () => {
  const driver = fakeDriver();
  const normalized = normalizeBurst({
    steps: [
      { action: 'resolve', role: 'menuitem', name: 'Insert' },
      { action: 'click', refFromStep: 0 }
    ]
  });

  const out = await runLocalBurst({ driver, steps: normalized.steps, timeoutMs: normalized.timeoutMs });

  assert.equal(out.ok, true);
  assert.equal(out.completedSteps, 2);
  assert.deepEqual(driver.calls, [['resolve', 'menuitem', 'Insert'], ['click', null, null, 'opera-7']]);
});

test('the first failure stops the burst and keeps the steps that finished', async () => {
  const driver = fakeDriver();
  driver.clickRow = async () => { throw new Error('menu is gone'); };
  const normalized = normalizeBurst({
    steps: [
      { action: 'click_row', role: 'menuitem', name: 'Insert' },
      { action: 'type', text: 'must not run' }
    ]
  });

  const out = await runLocalBurst({ driver, steps: normalized.steps, timeoutMs: normalized.timeoutMs });

  assert.equal(out.ok, false);
  assert.equal(out.failedAt, 0);
  assert.equal(out.completedSteps, 0);
  assert.match(out.error.message, /menu is gone/);
  assert.ok(!driver.calls.some(([name]) => name === 'type'), 'the next step never fired');
});

test('the deadline is checked before the next step, so a burst cannot overrun it', async () => {
  const driver = fakeDriver();
  const times = [0, 11];
  const now = () => times.shift() ?? 11;

  const out = await runLocalBurst({
    driver,
    steps: [{ action: 'click', x: 5, y: 6 }],
    timeoutMs: 10,
    now
  });

  assert.equal(out.ok, false);
  assert.equal(out.timedOut, true);
  assert.equal(out.failedAt, 0);
  assert.deepEqual(driver.calls, [], 'nothing was clicked after the budget was gone');
});

test('a wait that never sees its text fails the step instead of walking into the next one', async () => {
  const driver = fakeDriver();
  driver.waitForText = async (text, options) => {
    driver.calls.push(['waitForText', text, options]);
    return { url: 'https://example.test/', title: 'Example', text: 'nothing useful' };
  };

  const out = await runLocalBurst({
    driver,
    steps: [{ action: 'wait', text: 'Total' }, { action: 'press_key', key: 'Enter' }],
    timeoutMs: 12000
  });

  assert.equal(out.ok, false);
  assert.equal(out.failedAt, 0);
  assert.match(out.error.message, /timed out/);
  assert.ok(!driver.calls.some(([name]) => name === 'key'), 'the next step never fired');
});
