// @last-edited: 2026-10-15 UTC+7.
// @title: open-menu — walk a menu to a row, and click only what the caller named.
// @state: a fake page that answers the menu tree, the box of every row and the clicks.
// @dependencies: node:test, assert, ../local/primitives.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPrimitives } from '../local/primitives.js';
import { SETTLE_POLL_MS } from '../local/page-expressions.js';

// WHY THESE CLAIMS EXIST.
// Measured live on Google Docs: a walk for ["Insert", "Image", "Upload from computer"] opened the two menus and then clicked the leaf on the way, which opened the operating system's own file dialog - a window nothing inside the browser can close again - and the answer still said acted: false.
// So the leaf is clicked only when the caller says this item is the command, the answer says what was actually done, and a bar item is clicked because a top-level menu is a toggle that hover does not open.

const row = (
  name,
  depth,
  extra = {}
) => ({
  role: 'menuitem',
  name,
  depth,
  branch: false,
  disabled: false,
  expanded: false,
  node: depth * 10 + name.length,
  x: 300 + depth * 160,
  y: 80 + depth * 40,
  ...extra
});

const BAR = [
  row('File', 0, { branch: true }),
  row('Insert', 0, { branch: true })
];
const INSERT = [
  row('Image', 1, { branch: true }),
  row('Chart', 1)
];
const IMAGE = [
  row('Upload from computer', 2),
  row('By URL', 2)
];

// WHY THE BOX IS FIXED AND NOT DERIVED FROM THE ROW.
// A hover measures the row again at the moment it moves there, so the fake answers a box centred on the submenu parent - the one the walk hovers - and the walk's own coordinates for everything else.
// A fake that computed the box from the row it was asked about could not tell a stale row from a measured one, which is the thing being pinned.

const BOX_QUAD = [
  450,
  110,
  470,
  110,
  450,
  130,
  470,
  130
];

// WHY THE FAKE PAGE OPENS ITS MENUS WHEN THE POINTER SAYS SO.
// A tree that answered the same rows however the walk behaved could not tell a walk that opened the Insert menu from one that never did, which is the whole claim here: the bar item is clicked, the submenu parent is hovered, and the next level appears only then.

const OPENED = {
  press: (params) => params?.type === 'mousePressed' && params.x === BAR[1].x && params.y === BAR[1].y,
  hover: (params) => params?.type === 'mouseMoved' && params.x === 460 && params.y === 120
};

function menuCdp() {
  const calls = [];
  let level = 0;
  const tree = () => (level === 0 ? [...BAR] : level === 1 ? [
    ...BAR,
    ...INSERT
  ] : [
    ...BAR,
    ...INSERT,
    ...IMAGE
  ]);
  return {
    calls,
    send: async (
      method,
      params = {}
    ) => {
      calls.push({
        method,
        params
      });
      if (OPENED.press(params)) level = Math.max(level, 1);
      if (OPENED.hover(params)) level = Math.max(level, 2);
      if (method === 'Runtime.evaluate') {
        if (String(params.expression).includes('window.__operaMenuNodes[')) return { result: { objectId: `obj-${params.expression.match(/\d+/)[0]}` } };
        if (String(params.expression).includes('document.querySelectorAll')) {
          return { result: { value: tree() } };
        }
      }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 4242 } };
      if (method === 'DOM.getBoxModel') return { model: { content: BOX_QUAD } };
      return { result: {} };
    }
  };
}

const clicks = (cdp) => cdp.calls.filter((c) => c.params?.type === 'mousePressed');
const moves = (cdp) => cdp.calls.filter((c) => c.params?.type === 'mouseMoved');

test('a leaf that is the last step is hovered, not clicked', async () => {
  const cdp = menuCdp();
  const out = await createPrimitives(cdp).openMenu({
    path: [
      'Insert',
      'Image',
      'Upload from computer'
    ],
    timeoutMs: 60
  });

  assert.equal(out.opened, true);
  assert.deepEqual(out.at, [
    'Insert',
    'Image',
    'Upload from computer'
  ]);
  assert.equal(out.acted, false, 'nothing was run, so nothing acted');
  assert.deepEqual(clicks(cdp).map((c) => [
    c.params.x,
    c.params.y
  ]), [[
    300,
    80
  ]],
    'the only click is the bar item that opens the menu');
});

test('the same leaf is clicked when the caller says it is the command', async () => {
  const cdp = menuCdp();
  const out = await createPrimitives(cdp).openMenu({
    path: [
      'Insert',
      'Image',
      'Upload from computer'
    ],
    clickLeaf: true,
    timeoutMs: 60
  });

  assert.equal(out.opened, true);
  assert.equal(out.acted, true);
  assert.deepEqual(clicks(cdp).map((c) => [
    c.params.x,
    c.params.y
  ]), [
    [
      300,
      80
    ],
    [
      620,
      160
    ]
  ],
    'the bar item, then the leaf the caller named');
});

test('a branch below the bar is opened by hovering it, because hovering activates nothing', async () => {
  const cdp = menuCdp();
  await createPrimitives(cdp).openMenu({
    path: [
      'Insert',
      'Image'
    ],
    timeoutMs: 60
  });

  assert.deepEqual(clicks(cdp).map((c) => [
    c.params.x,
    c.params.y
  ]), [[
    300,
    80
  ]],
    'clicking Image would run whatever it holds');
  const hovered = moves(cdp).map((c) => [
    c.params.x,
    c.params.y
  ]);
  assert.ok(hovered.some(([
    x,
    y
  ]) => x === 460 && y === 120), 'the pointer went onto Image');
  assert.ok(hovered.length >= 3, 'and came from somewhere else first, which is the enter the menu waits for');
});

test('a menu walk settles between pointer moves instead of sleeping fixed gaps', async () => {
  const cdp = menuCdp();
  const slept = [];

  await createPrimitives(cdp, { sleep: async (ms) => {
    slept.push(ms);
  } }).openMenu({
    path: [
      'Insert',
      'Image'
    ],
    timeoutMs: 1000
  });

  assert.ok(slept.includes(SETTLE_POLL_MS), 'the walk waits on the page settle');
  assert.ok(!slept.some((ms) => ms === 120 || ms === 260 || ms === 90), 'and not on the old fixed hover/open/poll gaps');
});

test('a walk that reaches nothing says where it stopped and what was there', async () => {
  const cdp = menuCdp();
  const out = await createPrimitives(cdp).openMenu({
    path: [
      'Insert',
      'Chart',
      'Nothing'
    ],
    timeoutMs: 60
  });

  assert.equal(out.opened, false);
  assert.deepEqual(out.at, [
    'Insert',
    'Chart'
  ]);
  assert.equal(out.brokeAt, 'Nothing');
  assert.equal(out.level, 2);
  assert.ok(Array.isArray(out.tree));
});
