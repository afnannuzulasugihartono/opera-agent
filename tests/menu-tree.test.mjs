// @last-edited: 2026-10-15 UTC+7.
// @title: menu-tree — an app's menus read as a tree, and a tree that cannot lie.
// @state: four states, level matching, nearest names, limits.
// @dependencies: node:test, strict, ../local/menu-tree.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  distanceBetween,
  exactMatch,
  findNode,
  looseMatch,
  menuTreeExpression,
  nearestNames,
  revealOf,
  stateOf
} from '../local/menu-tree.js';

// WHY FOUR STATES ARE TESTED AND NOT TWO. The lie that costs an agent the most
// time is reporting a command one hover away as one the application does not
// have. A two-state tree cannot tell those apart, so the states are pinned here
// against the three facts that decide them: a popup, a disabled flag, and whether
// it has been rendered.

test('a plain command is a leaf and reveals nothing', () => {
  const node = { branch: false, expanded: false, disabled: false };

  assert.equal(stateOf(node), 'leaf');
  assert.equal(revealOf(node), null);
});

test('a command with a closed popup is unrevealed, and says how it opens', () => {
  const node = { branch: true, expanded: false, disabled: false };

  assert.equal(stateOf(node), 'unrevealed');
  assert.match(revealOf(node), /hover the parent/);
});

test('an open popup is a branch whose children are readable', () => {
  const node = { branch: true, expanded: true, disabled: false };

  assert.equal(stateOf(node), 'branch');
  assert.match(revealOf(node), /children are open/);
});

// WHY DISABLED IS ITS OWN STATE AND NOT A LEAF. A greyed row looks exactly like a
// live one to a snapshot and costs a wasted click to discover, so it is named.

test('a disabled row is disabled whatever else it is', () => {
  assert.equal(stateOf({ branch: false, expanded: false, disabled: true }), 'disabled');
  assert.equal(stateOf({ branch: true, expanded: true, disabled: true }), 'disabled');
});

// WHY THE EXACT ROW WINS. A submenu container carries the concatenated names of
// everything inside it, so a substring search also matches the container — and
// the container sits at the parent level, which is how a walk ends up one level
// off while every step looked correct.

test('an exact row beats a container carrying the same names', () => {
  const rows = [
    { name: 'Upload from computer\nSearch the web\nDrive', depth: 1 },
    { name: 'Upload from computer', depth: 2 }
  ];

  assert.equal(findNode('Upload from computer', rows).depth, 2, 'the row, not the menu around it');
});

test('a name that is only part of a row still finds it', () => {
  const rows = [{ name: 'Upload from computer\nSearch the web', depth: 2 }];

  assert.equal(looseMatch('upload from comp', rows).depth, 2);
  assert.equal(exactMatch('upload from comp', rows), null, 'exact stays exact');
});

// WHY NEAREST NAMES ARE ORDERED BY DISTANCE AND NOT BY POSITION. When a path
// breaks, the useful thing to hand over is the closest thing that exists: the
// caller wrote "Upload" and the page offers "Upload from computer" — one word
// away. "Break" is many words away and must not be offered first.

test('the nearest name is the caller word with more detail, not the closest by letters', () => {
  const offered = ['Break', 'Upload from computer', 'Bookmark', 'Table'];

  assert.equal(nearestNames('Upload', offered)[0], 'Upload from computer');
  assert.equal(nearestNames('Upload from computr', offered)[0], 'Upload from computer',
    'a single typo still finds the row');
  assert.ok(!nearestNames('Upload', offered, 1).includes('Break'),
    'six edits away loses to thirteen edits of the same word');
});

test('the distance is real, so a same name costs nothing and a stranger costs much', () => {
  assert.equal(distanceBetween('Upload', 'Upload'), 0);
  assert.ok(distanceBetween('Upload', 'Upload from computer') > distanceBetween('Upload', 'Upload'),
    'distance alone would rank Break first, which is why it is not the only signal');
  assert.ok(distanceBetween('Image', 'Bookmark') > 2);
});

// WHY THE EXPRESSION CARRIES ITS LIMITS INSTEAD OF TRUSTING THEM. The limit is
// substituted into the page, so an unbounded request would walk the document
// that pretends to be a menu; and the submenu reach is a value the page has to
// hold, which is why it is written in rather than named.

test('the expression carries the limit and the reach into the page', () => {
  const expression = menuTreeExpression(3);

  assert.match(expression, /const LIMIT = 3;/);
  assert.doesNotMatch(expression, /__LIMIT__/);
  assert.match(expression, /const REACH = \d+;/);
  assert.doesNotMatch(expression, /__REACH__/);
});

test('a wild limit is clamped so the walk cannot become the document', () => {
  assert.match(menuTreeExpression(99999), /const LIMIT = 200;/);
  assert.match(menuTreeExpression(0), /const LIMIT = 1;/, 'zero is a limit, not a missing argument');
  assert.match(menuTreeExpression(-5), /const LIMIT = 1;/);
  assert.match(menuTreeExpression('nonsense'), /const LIMIT = 200;/);
});

// WHY THE WALK IS NOT BUILT FROM ROLES ALONE. Google Docs renders its own
// document headings as role=menuitem, so a walk that trusts the role descends
// into the document. The expression therefore only reads menus that hang off a
// menubar or that a menu item owns, and this pins that the selectors are the
// ones that keep a document out.

test('the walk reads menus and menubars, and never the document behind them', () => {
  const expression = menuTreeExpression();

  assert.match(expression, /\[role~="menubar"\]/);
  assert.match(expression, /\[role~="menu"\]/);
  assert.match(expression, /querySelectorAll\(BAR\)/);
  assert.match(expression, /job\.el\.querySelector\(MENU\)/, 'a menu inside an item is that item menu');
  assert.match(expression, /ownerOf\(job\.el/, 'and one beside an item is claimed by position');
});

// WHY THE ROUNDS ARE PINNED HERE AND NOT ONLY LIVE. Measured live on Google Docs
// with the Image submenu already open: its rows came back at depth 0, so a walk for
// ["Insert", "Image", "Upload from computer"] gave up at the third step with nothing
// visible - the submenu looked like a top-level menu. The cause was order, not
// geometry: the Image item is only in the queue after the Insert menu has been
// walked into, so in the first pass nobody owns the submenu - and handing the menus
// nobody owns out then took it as a top-level menu before the item that owns it was
// ever seen. So ownership is resolved in rounds, and the leftovers are last.

test('ownership is resolved in rounds, and the menus nobody owns are taken last', () => {
  const expression = menuTreeExpression();

  assert.match(expression, /const claimOwned = \(\) =>/, 'items claim the menus they own');
  assert.match(expression, /const claimLeftOvers = \(\) =>/, 'and the menus nobody owns are a separate pass');
  assert.match(expression, /round < rounds/, 'the walk keeps claiming while a round changes something');
  assert.match(expression, /const rounds = 8/, 'the rounds are capped, so a page that loops cannot spin the walk');
  const loop = expression.slice(expression.indexOf('for (let round = 0'));
  assert.ok(loop.indexOf('claimOwned()') < loop.indexOf('claimLeftOvers()'),
    'a menu nobody owns yet is not handed out before the items that could own it are in the queue');
  assert.doesNotMatch(expression, /MENU_ROUNDS/, 'a name that exists only in the driver throws inside the page, and the tree comes back empty');
  assert.doesNotMatch(expression, /const jobs = \[\.\.\.queue\]/, 'the queue is walked every round, not once');
});
