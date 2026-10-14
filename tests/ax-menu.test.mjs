// @last-edited: 2026-10-13 UTC+7.
// @title: ax-menu — tree queries, verified walks, and honest failure.
// @state: 10 locks; find, plan, open, open-fail, missing-row, click, accel, wait, fast-open, fast-refuse.
// @dependencies: node:test, assert, ../lib/ax-menu.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { axChildren, axFind, axRowIndex, axSubmenu, clickMenuRow, menuAccel, menuWalkPlan, openSubmenu, pressMenuAccel, waitAx } from '../lib/ax-menu.js';

// A reduced fixture from the live Insert menu: node ids, roles, names, and the one
// open submenu. Shaped exactly like CDP Accessibility.getFullAXTree nodes.

function fixture() {
  return [
    { nodeId: '1', role: { value: 'menu' }, childIds: ['2', '3', '4'] },
    { nodeId: '2', role: { value: 'menuitem' }, name: { value: 'Image i ►' }, childIds: [] },
    { nodeId: '3', role: { value: 'menuitem' }, name: { value: 'Page elements Updated p ►' }, childIds: ['5'] },
    { nodeId: '4', role: { value: 'menuitem' }, name: { value: 'Comment m Ctrl+Alt+M' }, childIds: [] },
    { nodeId: '5', role: { value: 'menu' }, childIds: ['6', '7'] },
    { nodeId: '6', role: { value: 'menuitem' }, name: { value: 'Table of contents' }, childIds: [], backendDOMNodeId: 99 },
    { nodeId: '7', role: { value: 'menuitem' }, name: { value: 'Header' }, childIds: [] }
  ];
}

test('children resolve by id and find filters by role and name', () => {
  const nodes = fixture();
  const menu = nodes[0];
  const kids = axChildren(nodes, menu);

  assert.equal(kids.length, 3);
  assert.deepEqual(axFind(nodes, { role: 'menu' }).length, 2);
  assert.equal(axFind(nodes, { role: 'menuitem', nameIncludes: 'page ELEM' })[0].nodeId, '3');
  assert.equal(axSubmenu(nodes, kids[1]).nodeId, '5');
  assert.equal(axSubmenu(nodes, kids[0]), null);
  assert.equal(axRowIndex(kids, kids[2]), 2);
});

test('a walk plan downs to the 1-based row: nothing selected, Down lands on first', () => {
  assert.deepEqual(menuWalkPlan(1), [{ key: 'ArrowDown' }]);
  assert.deepEqual(menuWalkPlan(3).length, 3);
  assert.throws(() => menuWalkPlan(0), /1-based/);
});

test('opening a submenu walks to the named row and proves a new menu appeared', async () => {
  const closed = fixture().filter((n) => n.nodeId !== '5' && n.nodeId !== '6' && n.nodeId !== '7');
  const opened = fixture();
  const trees = [closed, opened];
  const keys = [];
  const submenu = await openSubmenu(
    {
      ax: async () => ({ nodes: trees.shift() ?? opened }),
      key: async (k) => { keys.push(k); }
    },
    closed[0],
    'page elements'
  );

  assert.deepEqual(keys, ['ArrowDown', 'ArrowDown', 'ArrowRight']);
  assert.equal(submenu.nodeId, '5');
});

test('a submenu that never appears fails naming the row, not hammering keys', async () => {
  const nodes = fixture();
  const keys = [];
  await assert.rejects(
    () => openSubmenu(
      { ax: async () => ({ nodes }), key: async (k) => { keys.push(k); }, sleep: async () => {} },
      nodes[0],
      'comment',
      { timeoutMs: 30 }
    ),
    /did not open after Right/
  );
  assert.deepEqual(keys, ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight']);
});

test('a missing row aborts naming what is visible instead of hammering keys', async () => {
  const nodes = fixture();
  let keys = 0;
  await assert.rejects(
    () => openSubmenu(
      { ax: async () => ({ nodes }), key: async () => { keys += 1; } },
      nodes[0],
      'Footnote'
    ),
    (error) => {
      assert.match(error.message, /not found/);
      assert.match(error.message, /Page elements/);
      return true;
    }
  );
  assert.equal(keys, 0, 'no key may move before the target is known to exist');
});

test('accelerators are parsed from the row name, or honestly absent', () => {
  assert.equal(menuAccel('Table t ►'), 't');
  assert.equal(menuAccel('Comment m Ctrl+Alt+M'), 'm');
  assert.equal(menuAccel('eSignature 1'), '1');
  assert.equal(menuAccel('Page elements Updated p ►'), 'p');
  assert.equal(menuAccel('Horizontal line r'), 'r');
  assert.equal(menuAccel('Table of contents'), null);
  assert.equal(menuAccel('Tab f11 Shift+F11'), null);
  assert.equal(menuAccel(''), null);
  assert.equal(menuAccel(null), null);
});

test('a wait returns the satisfying tree, or null when the budget runs out', async () => {
  let polls = 0;
  const nodes = await waitAx(
    async () => {
      polls += 1;
      return { nodes: polls < 3 ? [] : [{ nodeId: 'x' }] };
    },
    (candidates) => candidates.length > 0,
    { sleep: async () => {}, timeoutMs: 1000 }
  );
  assert.equal(nodes.length, 1);
  assert.equal(polls, 3);
  const missed = await waitAx(async () => ({ nodes: [] }), (candidates) => candidates.length > 0, { sleep: async () => {}, timeoutMs: 30 });
  assert.equal(missed, null);
});

test('an accelerator opens the submenu with one keypress', async () => {
  const closed = fixture().filter((n) => n.nodeId !== '5' && n.nodeId !== '6' && n.nodeId !== '7');
  const opened = fixture();
  const trees = [closed, opened];
  const keys = [];
  const submenu = await pressMenuAccel(
    {
      ax: async () => ({ nodes: trees.shift() ?? opened }),
      key: async (k) => { keys.push(k); },
      sleep: async () => {}
    },
    closed[0],
    'page elements'
  );

  assert.deepEqual(keys, ['p']);
  assert.equal(submenu.nodeId, '5');
});

test('a row without an accelerator refuses before any key moves', async () => {
  const nodes = [
    { nodeId: '1', role: { value: 'menu' }, childIds: ['2'] },
    { nodeId: '2', role: { value: 'menuitem' }, name: { value: 'Table of contents' }, childIds: [] }
  ];
  let keys = 0;
  await assert.rejects(
    () => pressMenuAccel(
      { ax: async () => ({ nodes }), key: async () => { keys += 1; } },
      nodes[0],
      'contents'
    ),
    /no accelerator/
  );
  assert.equal(keys, 0);
});

test('a row click resolves a fresh box and clicks its center', async () => {
  const nodes = fixture();
  let clicked = null;
  await clickMenuRow(
    {
      ax: async () => ({ nodes }),
      box: async (id) => {
        assert.equal(id, 99);
        return [100, 200, 300, 200, 300, 240, 100, 240];
      },
      click: async (x, y) => { clicked = [x, y]; }
    },
    nodes[4],
    'table of contents'
  );

  assert.deepEqual(clicked, [200, 220]);
});
