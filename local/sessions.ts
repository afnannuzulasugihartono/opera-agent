// @last-edited: 2026-10-13 UTC+7.
// @title: sessions — one cached driver per tab, and the tab the agent touches comes forward.
// @state: keyed cache, adapter shape, front-on-switch (background for a tab the caller owns outright).
// @dependencies: none.

// WHY THIS FILE EXISTS

// The MCP server speaks in driver verbs and the CDP session speaks in primitives; this is the only place the two are joined per tab, and it is separate from the entry point so the joining is testable without a browser behind it.

// WHY each tab gets its own session and keeps it.
// A single shared session that re-points at whichever page the browser lists first is how a latency run once typed into an unrelated document.
// Naming the tab removes that, and caching the session removes the websocket handshake from every later call.

// WHY the touched tab comes forward.
// The person watching has sixty tabs and the agent works one of them; bringing it forward on the first touch of each tab is the cheapest possible "the agent is here" sign.
// Only the switch fronts, never every call, so a long drive on one tab never yanks the screen twice.
// A tab that refuses still gets driven: the indicator must not break the drive.

export function findOn(page: JsonRecord, query: unknown) {
  return page.evaluate(`(() => {
    const needle = ${JSON.stringify(String(query).toLowerCase())};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const out = [];
    for (let node = walker.currentNode; node && out.length < 25; node = walker.nextNode()) {
      const own = Array.from(node.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
      if (!own.toLowerCase().includes(needle)) continue;
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({ text: own.slice(0, 80), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    return out;
  })()`);
}

// WHY EXACT MATCHES WIN OVER SUBSTRING ONES.
// A submenu container carries the concatenated names of everything inside it, so a substring search for an item also matches its own container — and overlay-first ordering puts that container first.
// Clicking it hits dead menu background instead of the row, which dismisses the menu and looks exactly like a missed click.
// The exact row is tried first; the substring stays as the fallback it always was.

import { guide } from './agent-guide.js';
import { createFocusGuard } from './focus-guard.js';
import type { Driver, JsonRecord } from './types.js';

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

// WHY THE RESULT IS ASSERTED RATHER THAN WIDENED.
// A per-tab session carries the page verbs; opening and listing tabs belong to the entry point, and this adapter has never carried them.
// The full Driver type names both, so the gap is asserted here and named, not papered over by adding verbs the session does not have.

// WHY THE CLICK'S OWN ANSWER IS PASSED THROUGH RATHER THAN REBUILT.
// The row is what the caller asked for; the proof of what the click hit belongs to the click.
// Rebuilding the answer here threw that proof away - measured live, a click_row reported its row and its point while a dialog owned that point and took the click, and the answer could not say so.
// Anything the click measured now travels with the row it was aimed at.

export type SessionDriver = Omit<Driver, 'open' | 'tabs'>;

export function asDriver(session: JsonRecord): SessionDriver {
  // WHY THE GUARD IS PER SESSION NOW.
  // The machine read used to be one OS shell for the whole process.
  // A CDP session can answer the same question in under a millisecond, so the guard is built over this session's window methods and the OS shell stays only as the fallback inside them.
  const focusGuard = createFocusGuard({
    read: () => session.windowState(),
    focus: (match) => session.focusWindow(match)
  });

  return {
    read: () => session.read(),
    surfaceProfile: () => session.surfaceProfile(),
    evaluate: (expression) => session.evaluate(expression),
    settle: () => session.settle(),
    ask: (method, params) => session.ask(method, params),
    find: (query) => findOn(session, query),
    click: async (x, y, handle = null) => (handle ? session.clickHandle(handle) : session.clickAt(x, y)),
    resolve: (role, name) => session.resolveRow({ role, name }),
    clickFraction: (at) => session.clickFraction(at),
    hasFocus: () => session.hasFocus(),
    ensureFront: (options) => focusGuard({ ...(isRecord(options) ? options : {}), hasFocus: () => session.hasFocus() }),
    captureSized: (options) => session.captureSized(isRecord(options) ? options : {}),
    navigate: (url) => session.navigate(url),
    guide: async (topic) => guide(topic),
    menuTree: (options) => session.menuTree(isRecord(options) ? options : {}),
    openMenu: (options) => session.openMenu(isRecord(options) ? options : {}),
    hover: (x, y) => session.hover(x, y),
    clickRow: async (role, name) => {
      const row = await session.resolveRow({ role, name });
      if (!row.handle) {
        const at = await session.clickAt(row.x, row.y);
        return { role: row.role, name: row.name, x: row.x, y: row.y, hit: at.hit };
      }
      const at = await session.clickHandle(row.handle);
      return { role: row.role, name: row.name, ...at };
    },
    key: (name, modifiers) => session.key(name, modifiers),
    type: (text) => session.type(text),
    append: (text) => session.append(text),
    scroll: (options) => session.scroll(isRecord(options) ? options : {}),
    computed: (options) => session.computed(isRecord(options) ? options : {}),
    keys: (events) => session.keys(events),
    snapshot: (limit) => session.snapshot(limit === undefined ? {} : { limit }),
    pageState: () => session.pageState(),
    pageLook: (options) => session.pageLook?.(isRecord(options) ? options : {}) ?? null,
    caretLine: () => session.caretLine(),
    windowState: () => session.windowState(),
    focusWindow: (match) => session.focusWindow(match),
    dialogState: () => session.dialogState(),
    dialogType: (text) => session.dialogType(text),
    dialogPress: (name) => session.dialogPress(name),
    waitForRow: (options) => session.waitForRow(options),
    waitForText: (text, options) => session.waitForText(text, options),
    waitForStill: (options) => session.waitForStill(options),
    waitForUrl: (options) => session.waitForUrl(options),
    upload: (options) => session.upload(options),
    dropFile: (options) => session.dropFile(options),
    interceptFileChooser: (enabled) => session.interceptFileChooser(enabled),
    download: (options) => session.download(options),
    capture: (options) => session.capture(options),
    front: () => session.front(),
    close: () => session.close()
  };
}

export interface SessionStoreOptions {
  openSession: (options: JsonRecord) => Promise<JsonRecord>;
  port: number;
  browserId?: string | undefined;
  viaBridge?: string | null | undefined;
}

export function createSessionStore({ openSession, port, browserId, viaBridge = null }: SessionStoreOptions) {
  const sessions = new Map<unknown, Driver>();
  let fronted: unknown = null;

  async function open(options: JsonRecord = {}) {
    const { url: targetUrl, targetId: named, background, ...rest } = options;
    const key = targetUrl ?? named ?? '';
    if (!sessions.has(key)) {
      // The full Driver also names open and tabs, which belong to the entry point rather than one tab; the map is where the two shapes meet.
      const session = await openSession({ port, id: browserId, launch: false, tabUrl: targetUrl ?? null, targetId: named ?? null, viaBridge, ...rest });
      sessions.set(key, asDriver(session) as unknown as Driver);
    }
    const driver = sessions.get(key);
    if (!driver) throw new Error(`the session for ${String(key)} was not opened`);
    // WHY A SEARCH OPENS ITS TAB WITHOUT FRONTING IT.
    // The local search opens and closes its own background tab in one call, and bringing that tab forward for its brief life is the one focus jump the caller did not ask for.
    // The tab is closed before the answer returns, so no window is left in a state the person did not choose; everything else keeps the front-on-switch rule.
    if (background !== true && key !== fronted) {
      fronted = key;
      await driver.front().catch(() => null);
    }
    return driver;
  }

  const attach = () => open({});

  async function closeTab(tabId: unknown, closeTransport: (id: unknown) => Promise<unknown>) {
    void sessions.get(tabId)?.close?.();
    sessions.delete(tabId);
    if (fronted === tabId) fronted = null;
    return closeTransport(tabId);
  }

  return { open, attach, closeTab };
}
