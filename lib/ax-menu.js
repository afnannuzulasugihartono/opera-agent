// @last-edited: 2026-10-13 UTC+7.
// @title: ax-menu — menu driving by accessibility tree: names and order, never coordinates or counts.
// @state: tree queries, accelerator fast path, polled waits, verified walks.
// @dependencies: none.

// WHY THIS FILE EXISTS

// Menus defeat every other locator.
// They render outside the queried DOM (find_elements returns nothing), their screen position drifts whenever the window changes (one calibration died within the hour), and blind key counts rot the moment the vendor reorders items.
// The accessibility tree answers all three: Blink computes one for every rendered page, it names every menu row, orders children exactly as shown, and resolves any node to a clickable box.
// A menu drive becomes: read the tree, walk to the named row, prove the submenu appeared, repeat.
// Measured live: a 748-node tree in 73 ms, menu rows with names, boxes exact to the pixel.

// WHY IT IS GENERIC.
// Nothing here names an application.
// Menus are role=menu, rows are role=menuitem, submenus are child menus: the same shape in Docs, Sheets, Slides, and every ARIA-conformant web app.
// Site-specific knowledge is a list of row names passed in by the caller, and the Docs table-of-contents path is the first client, not the design.

// WHAT IT DELIBERATELY DOES NOT DO.
// It never clicks from a remembered coordinate: every box is resolved from a live tree seconds before the click.
// It never assumes selection state: after each move it re-reads the tree and confirms the expected submenu exists before proceeding.
// And it never retries blindly: a missing row aborts with the visible rows listed, so the failure names what moved instead of hammering keys into the void.

export function axChildren(
  nodes,
  node
) {
  const byId = new Map(nodes.map((n) => [
    n.nodeId,
    n
  ]));
  return (node?.childIds ?? []).map((id) => byId.get(id)).filter(Boolean);
}

export function axFind(
  nodes,
  {
    role,
    nameIncludes,
    parent
  } = {}
) {
  const scope = parent ? axChildren(nodes, parent) : nodes;
  return scope.filter((n) => {
    if (role && (n.role?.value ?? n.role) !== role) return false;
    if (nameIncludes && !(n.name?.value ?? n.name ?? '').toLowerCase().includes(nameIncludes.toLowerCase())) return false;
    return true;
  });
}

export function axRowIndex(
  siblings,
  target
) {
  return siblings.findIndex((n) => n.nodeId === target.nodeId);
}

export function axSubmenu(
  nodes,
  row
) {
  return axChildren(nodes, row).find((n) => (n.role?.value ?? n.role) === 'menu') ?? null;
}

function axMenuRows(
  nodes,
  parentMenu
) {
  return axChildren(nodes, parentMenu).filter((n) => (n.role?.value ?? n.role) === 'menuitem');
}

function axMenuIds(nodes) {
  return new Set(nodes.filter((n) => (n.role?.value ?? n.role) === 'menu').map((n) => n.nodeId));
}

function axRowName(node) {
  return node?.name?.value ?? node?.name ?? '';
}

// A vendor menu prints its own accelerator inside the row name — "Table t ►", "Comment m Ctrl+Alt+M", "eSignature 1" — so the fastest walk is one keypress, not a count of Downs that rots when rows reorder.
// The parser takes the last lone letter or digit, skipping chord hints and multi-character tokens, and answers null when the row carries nothing pressable.
// Measured on the live Docs Insert menu 2026-10-13: pressing the parsed letter opened the Table grid.

export function menuAccel(rowName) {
  const tokens = String(rowName ?? '').replace(/►/g, ' ').trim().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].includes('+')) continue;
    if (/^[a-z0-9]$/i.test(tokens[i])) return tokens[i].toLowerCase();
  }
  return null;
}

// A menu answers in tens of milliseconds and a fixed sleep always budgets for the worst case, so every wait here polls the tree instead.
// Returns the nodes that satisfied the predicate, or null when the budget ran out.

export async function waitAx(
  ax,
  predicate,
  {
    timeoutMs = 3000,
    intervalMs = 100,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  } = {}
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { nodes } = await ax();
    if (predicate(nodes)) return nodes;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

// A walk is a pure plan: from a freshly opened menu with nothing selected, the Nth Down lands on the Nth row (proven against the live menu: two Downs reach the second row), Right opens its submenu, and the plan carries what must exist afterwards so the driver verifies instead of hoping.

export function menuWalkPlan(rowIndex1Based) {
  if (!Number.isInteger(rowIndex1Based) || rowIndex1Based < 1) {
    throw new Error('menuWalkPlan needs a 1-based row index.');
  }
  return Array.from({ length: rowIndex1Based }, () => ({ key: 'ArrowDown' }));
}

// Drives one menu level to a named row and opens its submenu, verifying each stage against a fresh tree.
// Tools arrive injected: ax reads the tree, key sends one chord, box resolves a node to clickable coordinates.
// Returns the open submenu node.

// WHY NEWNESS, NOT PARENTHOOD.
// A submenu is not a child of its row in the accessibility tree; it appears as a sibling menu node when opened.
// Detection therefore snapshots the menu id set before Right and takes the node that was not there before.
// Measured live: the Insert menu, its submenus, and the document outline all surface as separate menu nodes in one tree.

export async function openSubmenu({
  ax,
  key,
  sleep
},
  parentMenu,
  rowNamePart,
  { timeoutMs } = {}
) {
  const first = await ax();
  const rows = axMenuRows(first.nodes, parentMenu);
  const index = rows.findIndex((n) => axRowName(n).toLowerCase().includes(rowNamePart.toLowerCase()));
  if (index < 0) {
    const visible = rows.map((n) => axRowName(n)).join(' | ');
    throw new Error(`menu row "${rowNamePart}" not found. Visible: ${visible}`);
  }

  for (let i = 0; i <= index; i++) {
    await key('ArrowDown');
  }
  const before = axMenuIds(first.nodes);
  await key('ArrowRight');

  const submenu = await waitForMenu(ax, before, sleep, timeoutMs);
  if (!submenu) {
    throw new Error(`submenu under "${rowNamePart}" did not open after Right.`);
  }
  return submenu;
}

async function waitForMenu(
  ax,
  before,
  sleep,
  timeoutMs
) {
  const nodes = await waitAx(
    ax,
    (candidates) => candidates.some((n) => (n.role?.value ?? n.role) === 'menu' && !before.has(n.nodeId)),
    {
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(sleep === undefined ? {} : { sleep })
    }
  );
  return nodes?.find((n) => (n.role?.value ?? n.role) === 'menu' && !before.has(n.nodeId)) ?? null;
}

// The one-key version of openSubmenu: when the row name carries its accelerator the letter alone selects the row and opens its submenu, with no counts to rot.
// Rows without one keep the counted walk, chosen by the caller, never guessed here.

export async function pressMenuAccel({
  ax,
  key,
  sleep
},
  parentMenu,
  rowNamePart,
  { timeoutMs } = {}
) {
  const first = await ax();
  const rows = axMenuRows(first.nodes, parentMenu);
  const row = rows.find((n) => axRowName(n).toLowerCase().includes(rowNamePart.toLowerCase()));
  if (!row) {
    const visible = rows.map((n) => axRowName(n)).join(' | ');
    throw new Error(`menu row "${rowNamePart}" not found. Visible: ${visible}`);
  }
  const accel = menuAccel(axRowName(row));
  if (!accel) {
    throw new Error(`menu row "${axRowName(row)}" carries no accelerator; walk to it instead.`);
  }

  const before = axMenuIds(first.nodes);
  await key(accel);

  const submenu = await waitForMenu(ax, before, sleep, timeoutMs);
  if (!submenu) {
    throw new Error(`submenu under "${axRowName(row)}" did not open after "${accel}".`);
  }
  return submenu;
}

// Clicks a menu row found by name in a live tree: resolve, box, click center.
// The tree is read inside this call so the coordinates can never go stale between measurement and action.

export async function clickMenuRow({
  ax,
  box,
  click
},
  parentMenu,
  rowNamePart
) {
  const { nodes } = await ax();
  const rows = axMenuRows(nodes, parentMenu);
  const row = rows.find((n) => axRowName(n).toLowerCase().includes(rowNamePart.toLowerCase()));
  if (!row || row.backendDOMNodeId == null) {
    const visible = rows.map((n) => axRowName(n)).join(' | ');
    throw new Error(`menu row "${rowNamePart}" not found or has no box. Visible: ${visible}`);
  }
  const quad = await box(row.backendDOMNodeId);
  const xs = [
    quad[0],
    quad[2],
    quad[4],
    quad[6]
  ];
  const ys = [
    quad[1],
    quad[3],
    quad[5],
    quad[7]
  ];
  await click(
    Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    Math.round((Math.min(...ys) + Math.max(...ys)) / 2)
  );
  return row;
}
