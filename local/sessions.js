// @last-edited: 2026-10-13 UTC+7.
// @title: sessions — one cached driver per tab, and the tab the agent touches comes forward.
// @state: keyed cache, adapter shape, front-on-switch.
// @dependencies: none.

// WHY THIS FILE EXISTS
//
// The MCP server speaks in driver verbs and the CDP session speaks in primitives;
// this is the only place the two are joined per tab, and it is separate from the
// entry point so the joining is testable without a browser behind it.
//
// WHY each tab gets its own session and keeps it. A single shared session that
// re-points at whichever page the browser lists first is how a latency run once
// typed into an unrelated document. Naming the tab removes that, and caching the
// session removes the websocket handshake from every later call.
//
// WHY the touched tab comes forward. The person watching has sixty tabs and the
// agent works one of them; bringing it forward on the first touch of each tab is
// the cheapest possible "the agent is here" sign. Only the switch fronts, never
// every call, so a long drive on one tab never yanks the screen twice. A tab that
// refuses still gets driven: the indicator must not break the drive.

export function findOn(page, query) {
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

// WHY EXACT MATCHES WIN OVER SUBSTRING ONES. A submenu container carries the
// concatenated names of everything inside it, so a substring search for an
// item also matches its own container — and overlay-first ordering puts that
// container first. Clicking it hits dead menu background instead of the row,
// which dismisses the menu and looks exactly like a missed click. The exact
// row is tried first; the substring stays as the fallback it always was.

import { guide } from './agent-guide.js';

export function asDriver(session) {
  return {
    read: () => session.read(),
    evaluate: (expression) => session.evaluate(expression),
    ask: (method, params) => session.ask(method, params),
    find: (query) => findOn(session, query),
    click: async (x, y, handle = null) => (handle ? session.clickHandle(handle) : session.clickAt(x, y)),
    resolve: (role, name) => session.resolveRow({ role, name }),
    guide: async (topic) => guide(topic),
    menuTree: (options) => session.menuTree(options ?? {}),
    openMenu: (options) => session.openMenu(options ?? {}),
    hover: (x, y) => session.hover(x, y),
    clickRow: async (role, name) => {
      const row = await session.resolveRow({ role, name });
      if (!row.handle) {
        await session.clickAt(row.x, row.y);
        return { role: row.role, name: row.name, x: row.x, y: row.y };
      }
      const at = await session.clickHandle(row.handle);
      return { role: row.role, name: row.name, x: at.x, y: at.y, handle: row.handle };
    },
    key: (name, modifiers) => session.key(name, modifiers),
    type: (text) => session.type(text),
    keys: (events) => session.keys(events),
    snapshot: (limit) => session.snapshot(limit === undefined ? {} : { limit }),
    caretLine: () => session.caretLine(),
    waitForRow: (options) => session.waitForRow(options),
    waitForStill: (options) => session.waitForStill(options),
    upload: (options) => session.upload(options),
    dropFile: (options) => session.dropFile(options),
    interceptFileChooser: (enabled) => session.interceptFileChooser(enabled),
    capture: (options) => session.capture(options),
    front: () => session.front(),
    close: () => session.close()
  };
}

export function createSessionStore({ openSession, port, browserId, viaBridge = null }) {
  const sessions = new Map();
  let fronted = null;

  async function open(options = {}) {
    const { url: targetUrl, targetId: named, ...rest } = options;
    const key = targetUrl ?? named ?? '';
    if (!sessions.has(key)) {
      const session = await openSession({ port, id: browserId, launch: false, tabUrl: targetUrl ?? null, targetId: named ?? null, viaBridge, ...rest });
      sessions.set(key, asDriver(session));
    }
    const driver = sessions.get(key);
    if (key !== fronted) {
      fronted = key;
      await driver.front().catch(() => null);
    }
    return driver;
  }

  const attach = () => open({});

  async function closeTab(tabId, closeTransport) {
    sessions.get(tabId)?.close?.();
    sessions.delete(tabId);
    if (fronted === tabId) fronted = null;
    return closeTransport(tabId);
  }

  return { open, attach, closeTab };
}
