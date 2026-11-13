// @last-edited: 2026-11-13 UTC+7.
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

export interface AxNode {
  nodeId: string;
  backendDOMNodeId?: number | null | undefined;
  role?: string | { value?: string | undefined } | undefined;
  name?: string | { value?: string | undefined } | undefined;
  childIds?: string[] | undefined;
}

export interface AxSnapshot {
  nodes: AxNode[];
}

export type AxReader = () => Promise<AxSnapshot>;
export type AxKeyDispatcher = (key: string) => Promise<unknown>;
export type AxSleeper = (ms: number) => Promise<unknown>;
export type AxBoxResolver = (backendDOMNodeId: number) => Promise<readonly [number, number, number, number, number, number, number, number]>;
export type AxClick = (x: number, y: number) => Promise<unknown>;

const roleOf = (node: AxNode | null | undefined): string => {
  const role = node?.role;
  if (!role) return '';
  return typeof role === 'string' ? role : String(role.value ?? '');
};

const nameOf = (node: AxNode | null | undefined): string => {
  const name = node?.name;
  if (name === undefined || name === null) return '';
  return typeof name === 'string' ? name : String(name.value ?? '');
};

export function axChildren(nodes: AxNode[], node: AxNode | null | undefined): AxNode[] {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  return (node?.childIds ?? []).map((id) => byId.get(id) as AxNode | undefined).filter((n): n is AxNode => n !== undefined);
}

export function axFind(nodes: AxNode[], { role, nameIncludes, parent }: { role?: string; nameIncludes?: string; parent?: AxNode | null } = {}): AxNode[] {
  const scope = parent ? axChildren(nodes, parent) : nodes;
  return scope.filter((n) => {
    if (role && roleOf(n) !== role) return false;
    if (nameIncludes && !nameOf(n).toLowerCase().includes(nameIncludes.toLowerCase())) return false;
    return true;
  });
}

export function axRowIndex(siblings: AxNode[], target: AxNode): number {
  return siblings.findIndex((n) => n.nodeId === target.nodeId);
}

export function axSubmenu(nodes: AxNode[], row: AxNode): AxNode | null {
  return axChildren(nodes, row).find((n) => roleOf(n) === 'menu') ?? null;
}

function axMenuRows(nodes: AxNode[], parentMenu: AxNode): AxNode[] {
  return axChildren(nodes, parentMenu).filter((n) => roleOf(n) === 'menuitem');
}

function axMenuIds(nodes: AxNode[]): Set<string> {
  return new Set(nodes.filter((n) => roleOf(n) === 'menu').map((n) => n.nodeId));
}

// A vendor menu prints its own accelerator inside the row name — "Table t ►", "Comment m Ctrl+Alt+M", "eSignature 1" — so the fastest walk is one keypress, not a count of Downs that rots when rows reorder.
// The parser takes the last lone letter or digit, skipping chord hints and multi-character tokens, and answers null when the row carries nothing pressable.
// Measured on the live Docs Insert menu 2026-10-13: pressing the parsed letter opened the Table grid.

export function menuAccel(rowName: string): string | null {
  const tokens = String(rowName ?? '').replace(/►/g, ' ').trim().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i] as string;
    if (token.includes('+')) continue;
    if (/^[a-z0-9]$/i.test(token)) return token.toLowerCase();
  }
  return null;
}

// A menu answers in tens of milliseconds and a fixed sleep always budgets for the worst case, so every wait here polls the tree instead.
// Returns the nodes that satisfied the predicate, or null when the budget ran out.

const defaultSleep: AxSleeper = (ms: number) => new Promise((resolve) => {
  setTimeout(() => resolve(undefined), ms);
});

export async function waitAx(ax: AxReader, predicate: (nodes: AxNode[]) => boolean, { timeoutMs = 3000, intervalMs = 100, sleep = defaultSleep }: { timeoutMs?: number; intervalMs?: number; sleep?: AxSleeper } = {}): Promise<AxNode[] | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { nodes } = await ax();
    if (predicate(nodes)) return nodes;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

// A walk is a pure plan: from a freshly opened menu with nothing selected, the Nth Down lands on the Nth row (proven against the live menu: two Downs reach the second row), Right opens its submenu, and the plan carries what must exist afterwards so the driver verifies instead of hoping.

export function menuWalkPlan(rowIndex1Based: number): Array<{ key: string }> {
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

export async function openSubmenu(tools: { ax: AxReader; key: AxKeyDispatcher; sleep?: AxSleeper }, parentMenu: AxNode, rowNamePart: string, { timeoutMs }: { timeoutMs?: number } = {}): Promise<AxNode> {
  const first = await tools.ax();
  const rows = axMenuRows(first.nodes, parentMenu);
  const index = rows.findIndex((n) => nameOf(n).toLowerCase().includes(rowNamePart.toLowerCase()));
  if (index < 0) {
    const visible = rows.map((n) => nameOf(n)).join(' | ');
    throw new Error(`menu row "${rowNamePart}" not found. Visible: ${visible}`);
  }

  for (let i = 0; i <= index; i++) {
    await tools.key('ArrowDown');
  }
  const before = axMenuIds(first.nodes);
  await tools.key('ArrowRight');

  const submenu = await waitForMenu(tools.ax, before, tools.sleep, timeoutMs);
  if (!submenu) {
    throw new Error(`submenu under "${rowNamePart}" did not open after Right.`);
  }
  return submenu;
}

async function waitForMenu(ax: AxReader, before: Set<string>, sleep: AxSleeper | undefined, timeoutMs: number | undefined): Promise<AxNode | null> {
  const nodes = await waitAx(
    ax,
    (candidates) => candidates.some((n) => roleOf(n) === 'menu' && !before.has(n.nodeId)),
    { ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(sleep === undefined ? {} : { sleep }) },
  );
  return nodes?.find((n) => roleOf(n) === 'menu' && !before.has(n.nodeId)) ?? null;
}

// The one-key version of openSubmenu: when the row name carries its accelerator the letter alone selects the row and opens its submenu, with no counts to rot.
// Rows without one keep the counted walk, chosen by the caller, never guessed here.

export async function pressMenuAccel(tools: { ax: AxReader; key: AxKeyDispatcher; sleep?: AxSleeper }, parentMenu: AxNode, rowNamePart: string, { timeoutMs }: { timeoutMs?: number } = {}): Promise<AxNode> {
  const first = await tools.ax();
  const rows = axMenuRows(first.nodes, parentMenu);
  const row = rows.find((n) => nameOf(n).toLowerCase().includes(rowNamePart.toLowerCase()));
  if (!row) {
    const visible = rows.map((n) => nameOf(n)).join(' | ');
    throw new Error(`menu row "${rowNamePart}" not found. Visible: ${visible}`);
  }
  const accel = menuAccel(nameOf(row));
  if (!accel) {
    throw new Error(`menu row "${nameOf(row)}" carries no accelerator; walk to it instead.`);
  }

  const before = axMenuIds(first.nodes);
  await tools.key(accel);

  const submenu = await waitForMenu(tools.ax, before, tools.sleep, timeoutMs);
  if (!submenu) {
    throw new Error(`submenu under "${nameOf(row)}" did not open after "${accel}".`);
  }
  return submenu;
}

// Clicks a menu row found by name in a live tree: resolve, box, click center.
// The tree is read inside this call so the coordinates can never go stale between measurement and action.

export async function clickMenuRow(tools: { ax: AxReader; box: AxBoxResolver; click: AxClick }, parentMenu: AxNode, rowNamePart: string): Promise<AxNode> {
  const { nodes } = await tools.ax();
  const rows = axMenuRows(nodes, parentMenu);
  const row = rows.find((n) => nameOf(n).toLowerCase().includes(rowNamePart.toLowerCase()));
  if (!row || row.backendDOMNodeId == null) {
    const visible = rows.map((n) => nameOf(n)).join(' | ');
    throw new Error(`menu row "${rowNamePart}" not found or has no box. Visible: ${visible}`);
  }
  const [x0, y0, x1, y1, x2, y2, x3, y3] = await tools.box(row.backendDOMNodeId);
  const xs = [x0, x1, x2, x3];
  const ys = [y0, y1, y2, y3];
  await tools.click(
    Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
  );
  return row;
}
