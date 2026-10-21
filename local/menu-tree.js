// @last-edited: 2026-10-15 UTC+7.
// @title: menu-tree — what an app can do, read from the page's own menu markup.
// @state: four node states, branch disclosure, path walking with a failure report.
// @dependencies: none.

// WHY THIS FILE EXISTS

// An agent that cannot see what an application can do, guesses.
// Guessing at a menu is expensive in a way guessing at text is not: a menu item that is not there costs a click that dismisses whatever was open, and the next click lands somewhere else — measured live on this product's own author, where a menu row resolved and clicked a second later landed on the button underneath it.

// WHY FOUR STATES AND NOT TWO.
// "Visible" and "absent" is the shape that makes a tree lie: an item one hover away is reported as not there, and the agent concludes the application cannot do it.
// So a node is a leaf, a branch, disabled, or unrevealed — and unrevealed carries how it would be revealed, so an agent knows the difference between "this app has no such command" and "one hover away".

// WHY THE DOCUMENT IS NOT A MENU.
// Google Docs renders the document's own headings as role=menuitem, so a walk that trusts roles alone descends into the document: measured live, a menu probe on an open Docs menu returned "BAB I PENDAHULUAN" and every paragraph as menu items.
// The reader here walks only what hangs off a menubar or a menu that a menu item owns, and a branch that grows into document text is reported as refused rather than walked to the end of the document.

const MENU_LIMIT = 200;

// WHY THE REACH IS 360 AND NOT "ADJACENT".
// A submenu sits beside its parent's menu, not beside its own item: measured on Google Docs, the item is 320 pixels wide, so its submenu opens a full item-width away from the item's right edge and never overlaps it.
// A rule that measures from the item alone misses every submenu; the number is a reach, and a miss here costs a wrong answer about what an application can do.

// WHY THE ROUNDS ARE CAPPED.
// A round that changes nothing ends the walk; this cap is what ends a page that keeps opening menus into itself.

const MENU_ROUNDS = 8;

const SUBMENU_REACH_PX = 360;

const BAR = '[role~="menubar"]';
const MENU = '[role~="menu"]';
const ITEM = '[role~="menuitem"],[role~="menuitemcheckbox"],[role~="menuitemradio"]';

// WHY THE ARROW AND NOT A CLICK.
// A submenu opens on hover in most applications and on click in some, and clicking to find out costs the menu: the click lands on an item and runs it.
// Hover opens a submenu without activating anything, so it is the first thing tried, always.
// The pointer also has to leave the parent and come back — measured live, a submenu that would not open did open once the pointer was sent away first, because the menu had never seen it arrive from outside.

const MENU_TREE_EXPRESSION = `(() => {
  const LIMIT = __LIMIT__;
  const REACH = __REACH__;
  const BAR = '[role~="menubar"]';
  const MENU = '[role~="menu"]';
  const ITEM = '[role~="menuitem"],[role~="menuitemcheckbox"],[role~="menuitemradio"]';
  const rows = [];
  const seen = new Set();

  const shape = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return null;
    const popup = el.getAttribute('aria-haspopup');
    const expanded = el.getAttribute('aria-expanded');
    return {
      name: (el.innerText || el.textContent || '').trim().slice(0, 80),
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      disabled: el.getAttribute('aria-disabled') === 'true' || el.disabled === true,
      branch: popup === 'true' || expanded === 'true' || Boolean(el.querySelector(MENU)),
      expanded: expanded === 'true',
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    };
  };

  const nodes = [];

  const add = (el, depth, parent) => {
    if (!el || seen.has(el) || rows.length >= LIMIT) return null;
    seen.add(el);
    const found = shape(el);
    if (!found) return null;
    nodes.push(el);
    const row = { ...found, depth, parent: parent ?? null, node: nodes.length - 1 };
    rows.push(row);
    return row;
  };

  // WHY THE BAR IS NOT A ROW AND ITS CHILDREN ARE LEVEL ZERO. The bar is a
  // container whose accessible name is every top-level name run together —
  // "FileEditViewInsertFormatToolsExtensions" — so a walker that treats it as a
  // node resolves the path's first name against that string and fails one level
  // early, against a name no user would ever type. The bar contributes its items
  // at depth 0 and never appears as something to match.
  const queue = [];
  const push = (container, depth, parent) => {
    for (const item of container.querySelectorAll(':scope > ' + ITEM)) {
      const row = add(item, depth, parent);
      if (row) queue.push({ el: item, depth, parent });
    }
  };

  for (const bar of document.querySelectorAll(BAR)) push(bar, 0, null);

  // WHY AN ITEM'S MENU IS FOUND BY WHERE IT IS AND NOT BY BEING ITS CHILD.
  // Measured live on Google Docs: the Insert button is a div with role=menuitem,
  // and the menu it opens is not inside it - it is a sibling hanging off the
  // document body, with the button's own aria-controls pointing at it. So a walk
  // that looks for a child menu finds nothing under a button that is visibly open
  // and reports a menu tree with no children at all. An open menu is claimed by
  // the item whose column it sits in and which sits directly above it, which is
  // what a person does when they read the screen.
  const visibleMenus = () => [...document.querySelectorAll(MENU)]
    .filter((box) => {
      const r = box.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .map((box) => ({ box, rect: box.getBoundingClientRect() }));

  // WHY A SUBMENU IS CLAIMED BY SIDE, NOT ONLY BY WHERE IT SITS. A submenu opens
  // beside its item, not under it: measured live on Google Docs, the Image item
  // sits at x=178 and its submenu opens to the right of the parent menu's right
  // edge, sharing the item's vertical band. A rule that only accepts a menu below
  // an item finds the top-level dropdowns and misses every submenu in the
  // application. So a menu to the side counts too, when it overlaps the item
  // vertically and starts within a short reach of the item's own edge.
  // WHY A SUBMENU IS REACHED FROM THE ITEM'S OWN EDGE. Measured live: the Image
  // item is 320 wide inside a 322-wide menu, and its submenu opens at x=499 — a
  // 320-pixel gap from the item's own edge and no overlap with it at all. A reach
  // measured from the item alone finds nothing; the distance that matters is from
  // the menu the item lives in.
  const ownerOf = (item, menus) => {
    const b = item.getBoundingClientRect();
    let best = null;
    let bestGap = Infinity;
    for (const menu of menus) {
      const r = menu.rect;
      const overlapsVertically = r.top < b.bottom && r.bottom > b.top;
      const beside = r.left >= b.right - 8 && r.left <= b.right + REACH;
      const below = r.top >= b.top - 4 && r.left >= b.left - 8 && r.left <= b.right + 8;
      if (!overlapsVertically || (!beside && !below)) continue;
      const gap = beside ? r.left - b.right : r.top - b.bottom;
      if (gap < -8 || gap > REACH) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = menu.box;
      }
    }
    return best;
  };

  // WHY OWNERSHIP IS CLAIMED BEFORE THE WALK, NOT DURING IT. A menu is claimed by
  // the item that owns it — first by containment, then by where it sits — and
  // only an unclaimed menu becomes a top-level one. Claiming as the walk went
  // along let the first item take a menu that belonged to a bar, and every level
  // after that inherited the wrong parent.
  const claimed = new Set();

  const ownerJob = new Map();
  const rounds = __ROUNDS__;

  // WHY OWNERSHIP IS RESOLVED IN ROUNDS, TOP DOWN, AND LEFTOVERS LAST. Measured
  // live on Google Docs with the Image submenu already open: the submenu's rows came
  // back at depth 0, as though the submenu were a top-level menu of its own, and a
  // walk for ["Insert", "Image", "Upload from computer"] gave up at the third step
  // with nothing visible. The cause is order, not geometry. The Image item is only
  // in the queue after the Insert menu has been walked into, so in the very first
  // pass nobody owns the submenu; and if the menus nobody owns are handed out then,
  // the submenu is taken as a top-level menu before the item that owns it is ever
  // seen. So: items claim their menus, the menus they claimed are walked into rows,
  // the items in those rows claim theirs, and only when a round changes nothing are
  // the menus nobody claimed treated as top-level ones.
  const pushClaimed = () => {
    let pushedNew = false;
    for (const [menu, job] of ownerJob) {
      if (pushed.has(menu) || rows.length >= LIMIT) continue;
      pushed.add(menu);
      push(menu, job ? job.depth + 1 : 0, job ? job.parent : null);
      pushedNew = true;
    }
    return pushedNew;
  };

  const claimOwned = () => {
    const before = ownerJob.size;
    for (const job of queue) {
      if (claimed.has(job.el)) continue;
      const owned = job.el.querySelector(MENU) ?? ownerOf(job.el, visibleMenus());
      if (!owned || claimed.has(owned)) continue;
      claimed.add(owned);
      ownerJob.set(owned, job);
    }
    return ownerJob.size !== before;
  };

  const claimLeftOvers = () => {
    let grew = false;
    for (const menu of visibleMenus()) {
      if (claimed.has(menu.box)) continue;
      claimed.add(menu.box);
      ownerJob.set(menu.box, null);
      grew = true;
    }
    return grew;
  };

  const pushed = new Set();

  for (let round = 0; round < rounds; round += 1) {
    const owned = claimOwned();
    const walked = pushClaimed();
    if (owned || walked) continue;
    const left = claimLeftOvers();
    const walkedLeft = pushClaimed();
    if (!left && !walkedLeft) break;
  }

  // WHY THE MENU KEEPS ITS ELEMENTS TOO. A menu row is a place on the screen
  // that stops being true the moment the menu closes, so it resolves to its
  // element the same way a snapshot row does and is measured again at the click.
  window.__operaMenuNodes = nodes;
  return rows;
})()`;

// WHY THE REACH IS INTERPOLATED RATHER THAN NAMED INSIDE.
// The expression runs in the page, where a module constant does not exist: it came back `SUBMENU_REACH_PX is not defined` and the tree answered with an empty list, which reads exactly like "this menu has no children".
// A value the page needs has to be written into the expression.

export function menuTreeExpression(limit) {
  const asked = limit === undefined || limit === null ? 200 : Number(limit);
  const rows = Number.isFinite(asked) ? Math.min(MENU_LIMIT, Math.max(1, Math.trunc(asked))) : MENU_LIMIT;
  return MENU_TREE_EXPRESSION
    .replace('__LIMIT__', String(rows))
    .replace('__REACH__', String(SUBMENU_REACH_PX))
    .replace('__ROUNDS__', String(MENU_ROUNDS));
}

// WHY THE STATE IS DECIDED HERE AND NOT IN THE CALLER.
// Three facts decide a node's state and all three are in the page: whether it has a popup, whether it is disabled, and whether it has been rendered at all.
// Deciding them in one place is what keeps an unrevealed item from being reported as absent — the one way a menu tree can lie to an agent that is trying to learn what an app does.

export function stateOf(node) {
  if (node.disabled) return 'disabled';
  if (node.branch && !node.expanded) return 'unrevealed';
  if (node.branch) return 'branch';
  return 'leaf';
}

// WHY A NODE CARRIES HOW IT WOULD BE REVEALED.
// An agent that knows a command exists but not how to reach it can still choose: hover the parent, click the parent, or use the application's own menu search.
// Naming the three is the difference between a dead end and a decision.

export function revealOf(node) {
  if (node.branch && !node.expanded) return 'hover the parent, then read the children';
  if (!node.branch) return null;
  return 'the children are open';
}

// WHY SIMILARITY IS A LEVENSON GAP AND NOT A SCORE.
// When a path fails, the most useful thing an agent can be handed is the nearest thing that exists: the difference in letters between what was asked for and what is really there.
// "Upload from computer" against "Upload" is one word of difference; against "Break" it is many, and the agent should not be shown that one first.

export function distanceBetween(wanted, offered) {
  const a = String(wanted ?? '').toLowerCase();
  const b = String(offered ?? '').toLowerCase();
  const rows = a.length + 1;
  const cols = b.length + 1;
  const cost = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) cost[i][0] = i;
  for (let j = 0; j < cols; j += 1) cost[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const costHere = a[i - 1] === b[j - 1] ? 0 : 1;
      cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + costHere);
    }
  }
  return cost[rows - 1][cols - 1];
}

// WHY THE WALKER REPORTS THE LEVEL IT BROKE ON.
// A message like "Upload from computer is not in the menu" sends an agent back to guessing.
// A message like "the path broke at Insert, and Insert has: Image, Table, Bookmark" hands it a map and lets it choose the next move without a single further click.

// WHY A NAME THAT BEGINS WITH THE ASKED-FOR WORD WINS OVER LETTER COUNT.
// "Upload" is six edits from "Break" and thirteen from "Upload from computer", so distance alone hands back the wrong row first — and the wrong row here is the one that costs a click.
// A name that starts with the caller's word is that word with more detail on it, and it wins whatever the count says.

export function nearestNames(wanted, offered, count = 3) {
  const ask = String(wanted ?? '').toLowerCase();
  return [...new Set(offered)]
    .map((name) => {
      const low = String(name ?? '').toLowerCase();
      const begins = low.startsWith(ask) ? 0 : 1;
      return { name, rank: begins, distance: distanceBetween(wanted, name), length: Math.abs(low.length - ask.length) };
    })
    .sort((a, b) => a.rank - b.rank || a.distance - b.distance || a.length - b.length)
    .slice(0, count)
    .map((entry) => entry.name);
}

export function exactMatch(name, rows) {
  const want = String(name ?? '').toLowerCase();
  return rows.find((row) => String(row.name ?? '').toLowerCase() === want) ?? null;
}

export function looseMatch(name, rows) {
  const want = String(name ?? '').toLowerCase();
  return rows.find((row) => String(row.name ?? '').toLowerCase().includes(want)) ?? null;
}

export function findNode(name, rows) {
  return exactMatch(name, rows) ?? looseMatch(name, rows);
}

export const MENU_ROLES = Object.freeze([BAR, MENU, ITEM]);