// @last-edited: 2026-10-11 UTC+7.
// @title: mcp-server — the stdio MCP surface over the local driver.
// @state: 8 locks; the handshake, the advertised tools, and every way a call can fail without killing the server.
// @dependencies: ./driver.js.

// WHY THIS FILE EXISTS
//
// The driver runs in a process with no stdio contract, so nothing that speaks MCP
// can use it. This is that contract, and it is the whole difference between a
// driver that works on the machine it was written on and one that anyone can run
// with npx.
//
// WHY there are no dependencies. The repository runs on stock Node with an empty
// dependency list, and a driver meant for other people's machines is the worst
// place to introduce an install step that can fail on someone else's network. MCP
// over stdio is newline-delimited JSON-RPC, which Node can do unaided.
//
// WHY handle() is a plain function. A server that only exists as a process cannot
// be tested without spawning one, and a test that spawns a real browser fails on
// whoever else's machine runs it. So the protocol lives in a function that takes a
// request and returns a response, and the stdio wrapper below it stays thin enough
// to be obvious by reading.
//
// WHY closing goes through the fallback driver. Routing close_tab by its tab id
// would open a websocket to the tab being closed just to tear it down, and fail
// on a tab already half-dead. The fallback closes by id with no session at all,
// and both caches still drop what they hold for it.

const PROTOCOL_VERSION = '2024-11-05';

const stringArg = (name) => ({ type: 'string', description: name });
const numberArg = (name) => ({ type: 'number', description: name });

// The surface is only what the driver does well. There is no run_browser_burst and
// no reusable element refs here: those are the cloud server's affordances, and
// pretending a local stdio process has them would advertise something it cannot
// honour. Coordinates and a fresh read per action are honest and sufficient.

const tabArg = { type: 'string', description: 'which tab to drive, from list_tabs. Required for anything that writes.' };

export const TOOLS = Object.freeze([
  {
    name: 'browser_status',
    description: 'Report which Chromium browsers are installed and which debugging port is live, before any action.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'list_tabs',
    description: 'List the page targets the browser currently has open, each with an id. Pass that id as tabId to drive a specific tab.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'open_url',
    description: 'Open a url in its own tab and return its id. Never navigates a tab that is already open, so a drive cannot destroy what the user was reading.',
    inputSchema: { type: 'object', properties: { url: stringArg('absolute url to open') }, required: ['url'] }
  },
  {
    name: 'close_tab',
    description: 'Close one tab by id and drop its cached session, so mapping runs and abandoned drives do not pile up tabs in the browser.',
    inputSchema: { type: 'object', properties: { tabId: stringArg('which tab to close, from list_tabs') }, required: ['tabId'] }
  },
  {
    name: 'read_page',
    description: 'Read one tab: url, title and text. On a Google Doc the text is the document itself, read through the editor with paragraphs kept as lines. On other canvas-rendered pages little or no text comes back, so pair this with capture_page when the task needs to see content.',
    inputSchema: { type: 'object', properties: { tabId: tabArg } }
  },
  {
    name: 'find_elements',
    description: 'Find visible text on the page and return each match with a viewport rect. Coordinates are in the same space capture_page returns, so a rect here can be clicked directly.',
    inputSchema: { type: 'object', properties: { tabId: tabArg, query: stringArg('text to look for') }, required: ['query'] }
  },
  {
    name: 'click',
    description: 'Click a coordinate in one tab. The coordinate space is the viewport in CSS pixels, which is what capture_page is clipped to.',
    inputSchema: {
      type: 'object',
      properties: { tabId: tabArg, x: numberArg('viewport x'), y: numberArg('viewport y') },
      required: ['x', 'y']
    }
  },
  {
    name: 'click_row',
    description: 'Find a row by role and name in a fresh snapshot and click its center in one round trip: no stale coordinates, no separate snapshot call. The name matches case-insensitively as a substring; the first match wins.',
    inputSchema: {
      type: 'object',
      properties: { tabId: tabArg, role: stringArg('menuitem, button, option, link, textbox, ...'), name: stringArg('substring of the visible name') },
      required: ['role', 'name']
    }
  },
  {
    name: 'hover',
    description: 'Move the pointer over a coordinate without pressing, and mark the spot blue. Dropdown menus and submenus open on hover and close on click, so hover first — the page comes back with the reply, showing what appeared. Waits for the move it dispatched. A move to a window that is not in front costs about five seconds on the compositor; press and release stay at milliseconds.',
    inputSchema: {
      type: 'object',
      properties: { tabId: tabArg, x: numberArg('viewport x'), y: numberArg('viewport y') },
      required: ['x', 'y']
    }
  },
  {
    name: 'press_key',
    description: 'Send a key with optional modifiers to the focused element of one tab, for example a chord or an arrow. Returns the page as it now stands, so you see what the key did without a second call.',
    inputSchema: {
      type: 'object',
      properties: { tabId: tabArg, key: stringArg('Enter, Tab, Escape, ArrowUp, ArrowDown, Home, End, Space, Backspace, Delete, or a single printable ASCII character'), modifiers: { type: 'array', items: { type: 'string', enum: ['Control', 'Alt', 'Shift', 'Meta'] }, description: 'held while the key goes down' } },
      required: ['key']
    }
  },
  {
    name: 'type',
    description: 'Insert text into the focused surface of one tab, including newlines as real paragraph breaks in a rich editor. Returns the page as it now stands.',
    inputSchema: { type: 'object', properties: { tabId: tabArg, text: stringArg('text to insert') }, required: ['text'] }
  },
  {
    name: 'stream_keys',
    description: 'Send up to 100 keys and texts in order, with optional gaps. Events go out one at a time in the order written, and keys keep a fifty-millisecond beat Docs can hear, so a chord never overtakes its own key and a menu walk takes the branch you meant.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        events: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', description: 'a named key or a single printable ASCII character' }, modifiers: { type: 'array', items: { type: 'string', enum: ['Control', 'Alt', 'Shift', 'Meta'] } }, text: { type: 'string' }, gapMs: { type: 'number' } } }, description: 'in order: { key, modifiers?, gapMs? } or { text, gapMs? }' }
      },
      required: ['events']
    }
  },
  {
    name: 'wait_for',
    description: 'Wait until a tab shows a text, then return the page as it now stands. Polls the same read an agent would do — including the document on a Google Doc — so the wait ends on the same evidence. Returns found:false with the current page instead of failing when the budget runs out.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        text: stringArg('text to wait for'),
        timeoutMs: { type: 'number', description: 'budget, default 8000, capped at 30000' },
        intervalMs: { type: 'number', description: 'gap between checks, default 250' }
      },
      required: ['text']
    }
  },
  {
    name: 'capture_page',
    description: 'Capture one tab as a JPEG image, clipped to the viewport at one pixel per clickable coordinate. Pass fullPage to span the whole scrollable document past the viewport instead. Returns image content the caller can see.',
    inputSchema: { type: 'object', properties: { tabId: tabArg, fullPage: { type: 'boolean', description: 'capture the whole page past the viewport' } } }
  },
  {
    name: 'ax_snapshot',
    description: 'Map one tab to clickable coordinates with names: role, name, x, y for every button, link, menu row and field, plus the current value where a field carries one (formula bar, name box, toolbar inputs). Every action already returns this for the page as it now stands, so call it when you want to study the whole page or the near rows the action left out, not to find out what your last click did. Actions also report what changed since their last look.',
    inputSchema: { type: 'object', properties: { tabId: tabArg, limit: { type: 'number', description: 'max rows, default 120, capped at 500' } } }
  }
]);

function requireArguments(args, required) {
  for (const name of required) {
    if (args?.[name] === undefined || args?.[name] === null || args?.[name] === '') {
      throw new Error(`${name} is required`);
    }
  }
}

// A browser that closed mid-call must not take the server with it, because the
// next tool call is still worth trying.

function asText(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] };
}

// WHY THE AUTO PAGE IS HALF. It rides along on every action, so a fifteen-action
// job pays for it fifteen times. The near half of a page is usually what did
// not move, and unchanged elements are exactly what an agent should not spend
// its attention on.

// WHY A WAIT POLLS THE FULL READ. The point of waiting is to end on the same
// evidence an agent would read by hand — including the document on a Google
// Doc, which the bare page text does not hold. A wait that runs out of budget
// throws nothing: found:false comes back with the page as it stands, which is
// what the next decision needs. Bounds are clamped, not refused, because a
// wait budget is a safety property and the snapshot limit already set that
// precedent.

const AUTO_PAGE_LIMIT = 60;
const SETTLE_MS = 120;

// WHY AN ACTION RETURNS THE PAGE WITH IT. An agent that has to ask for the
// page after every action spends two round trips on one decision — act, then
// look — and the look is the half that costs. Measured on the reference
// implementation: roughly thirty per cent of all tool calls were snapshots,
// almost all of them immediately after something the agent had just done.
// Handing the page back with the action makes one decision cost one call.
//
// WHY THE AUTO PAGE IS SMALLER THAN ax_snapshot. It rides along on every
// action, so it lands in context fifteen times on a fifteen-action job. The
// explicit snapshot is for when the agent means to study the page; this is
// for "what did that do", and the near half of the page that did not move is
// noise on every single turn.

// WHY ACTIONS REPORT WHAT CHANGED. The full page rides every action so the
// agent is never stranded, but sixty rows a turn buries the three that moved.
// The change set is a hint computed against the last look at the same tab:
// rows that appeared, rows that moved, and a count of rows that left. Rows
// match by value — role, name and position — so duplicates collapse and a
// reshaped page reports itself as reshaped instead of listing sixty new rows.
// The first look at a tab reports null: there is no previous page, and the
// elements it carries ARE the baseline. Keyed by driver object in a WeakMap,
// so a closed tab's last look is garbage instead of a leak.
//
// WHY THE LOOK WAITS A BEAT FIRST. The snapshot used to run the instant the
// action's reply landed — and a menu that opens a frame later was already
// missed: proven live, the auto-page after clicking Insert held no menu rows
// while a snapshot a moment later held fifteen. A hundred and twenty
// milliseconds is frames, not networks — seven of them, enough for any handler
// to place its DOM — and twenty-five times less than one model turn, so the
// tax framing is wrong: settling is part of seeing, and a page read before it
// stands is a page misread.

function diffElements(prev, curr) {
  const key = (r) => `${r.role}|${r.name}|${r.x}|${r.y}`;
  const name = (r) => `${r.role}|${r.name}`;
  const prevExact = new Set(prev.map(key));
  const currExact = new Set(curr.map(key));
  const prevNames = new Set(prev.map(name));
  const currNames = new Set(curr.map(name));
  const addedAll = curr.filter((r) => !prevExact.has(key(r)) && !prevNames.has(name(r)));
  const movedAll = curr.filter((r) => !prevExact.has(key(r)) && prevNames.has(name(r)));
  const removed = prev.filter((r) => !currExact.has(key(r)) && !currNames.has(name(r))).length;
  if (prev.length === 0) return { added: curr.slice(0, 20), moved: [], removed: 0, reshaped: false };
  const total = Math.max(prev.length, curr.length);
  if ((addedAll.length + removed) / total > 0.5) {
    return { added: [], moved: [], removed, reshaped: true };
  }
  return { added: addedAll.slice(0, 20), moved: movedAll.slice(0, 20), removed, reshaped: false };
}

const lastAuto = new WeakMap();

const afterAction = async (driver, action, limit) => {
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const seen = await driver.snapshot(limit ?? AUTO_PAGE_LIMIT);
  const prev = lastAuto.get(driver) ?? null;
  lastAuto.set(driver, seen);
  return asText({ action, elements: seen, changed: prev ? diffElements(prev, seen) : null });
};

// WHY THE TAB LOOKUP COMPARES TEXTUALLY. A Chrome tab id is a number, the tool
// schema says string, and an agent copies the id straight out of the tab list
// it was just handed. Comparing with === refused the id the product itself
// printed, which is how a drive that can see six tabs decides none of them is
// real. Ids are compared as text everywhere they cross a boundary.

// WHY THE PORT IS ASKED FOR, NOT STORED. The pipe is chosen per call because a
// worker can wake up late, so a port captured at startup is a lie the moment
// after it. Measured on the user's own machine: the drive was already on the
// bridge, list_tabs returned the real tabs, and browser_status still named the
// debugging port nothing was listening on — the kind of wrong answer that sends
// someone off to debug a port that was never in the way.

const livePort = (context) => (typeof context.port === 'function' ? context.port() : context.port);

export function createMcpServer(context) {
  const sessions = new Map();
  const fallback = context.driver ?? null;

  const driverFor = async (tabId) => {
    if (!tabId) return fallback;
    const known = context.resolveTab ? await context.resolveTab() : [];
    if (known.length && !known.some((id) => String(id) === String(tabId))) {
      throw new Error(`No page target ${tabId}. Open pages: ${known.join(' | ')}`);
    }
    if (!sessions.has(tabId)) {
      sessions.set(tabId, await context.open({ ...(context.sessionOptions ?? {}), targetId: tabId }));
    }
    return sessions.get(tabId);
  };

  const run = async (name, args) => {
    requireArguments(args, TOOLS.find((t) => t.name === name)?.inputSchema.required ?? []);
    const driver = name === 'close_tab' ? fallback : await driverFor(args?.tabId);

    switch (name) {
      case 'browser_status':
        return asText({ browsers: context.browsers, port: livePort(context) });
      case 'list_tabs':
        return asText(await driver.tabs());
      case 'open_url':
        return afterAction(driver, await driver.open(args.url));
      case 'close_tab': {
        const out = await driver.close(args.tabId);
        sessions.get(args.tabId)?.close?.();
        sessions.delete(args.tabId);
        return asText(out);
      }
      case 'read_page':
        return asText(await driver.read());
      case 'find_elements':
        return asText(await driver.find(args.query));
      case 'click':
        return afterAction(driver, await driver.click(args.x, args.y));
      case 'click_row':
        return afterAction(driver, await driver.clickRow(args.role, args.name));
      case 'hover':
        return afterAction(driver, await driver.hover(args.x, args.y));
      case 'press_key':
        return afterAction(driver, await driver.key(args.key, args.modifiers ?? []));
      case 'type':
        return afterAction(driver, await driver.type(args.text));
      case 'stream_keys':
        return afterAction(driver, await driver.keys(args.events));
      case 'wait_for': {
        const started = Date.now();
        const rawTimeout = Number(args.timeoutMs ?? 8000);
        const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(30000, Math.max(500, rawTimeout)) : 8000;
        const rawGap = Number(args.intervalMs ?? 250);
        const intervalMs = Number.isFinite(rawGap) ? Math.min(5000, Math.max(100, rawGap)) : 250;
        for (;;) {
          const state = await driver.read();
          if ((state.text || '').includes(args.text)) {
            return afterAction(driver, { found: true, ms: Date.now() - started });
          }
          if (Date.now() - started >= timeoutMs) {
            return afterAction(driver, { found: false, ms: Date.now() - started });
          }
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      }
      case 'ax_snapshot':
        return asText(await driver.snapshot(args.limit));
      case 'capture_page': {
        const data = await driver.capture(args.fullPage === true ? { fullPage: true } : {});
        return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  return {
    async close() {
      for (const session of sessions.values()) session.close?.();
      sessions.clear();
    },
    async handle(request) {
      const { id, method, params } = request ?? {};
      const reply = (result) => ({ jsonrpc: '2.0', id, result });
      const fail = (message) => ({ jsonrpc: '2.0', id, error: { code: -32000, message } });

      try {
        if (method === 'initialize') {
          return reply({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'opera-local', version: context.version ?? '0.0.0' }
          });
        }
        if (method === 'tools/list') return reply({ tools: TOOLS });
        if (method === 'tools/call') {
          const started = Date.now();
          const out = await run(params?.name, params?.arguments ?? {});
          out.content.push({ type: 'text', text: `${Date.now() - started} ms` });
          return reply(out);
        }

        if (method?.startsWith('notifications/')) return undefined;
        return fail(`Unknown method: ${method}`);
      } catch (error) {
        return fail(error.message);
      }
    }
  };
}

// WHY the loop is line based and never awaits a parse. MCP stdio frames are
// newline-delimited JSON, so a line that is not yet complete is not a frame, and a
// malformed one must be reported rather than thrown, because a throwing read loop
// ends the session over one bad message.
//
// WHY the dispatch carries a rejection handler and a void. Without the handler a
// single rejected handle ends the process on an unhandled rejection, taking down a
// whole session over one bad call. SonarCloud caught that on this file and it was
// right: the handler is not decoration. The void then says the reply is deliberately
// not awaited, because an event loop has nothing else to wait for.

export function startStdio({ input = process.stdin, output = process.stdout, context }) {
  const server = createMcpServer(context);
  let buffer = '';

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      let request;
      try {
        request = JSON.parse(text);
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        continue;
      }
      void Promise.resolve(server.handle(request))
        .catch((error) => ({ jsonrpc: '2.0', id: request.id ?? null, error: { code: -32603, message: error.message } }))
        .then((response) => {
          if (response) output.write(`${JSON.stringify(response)}\n`);
        });
    }
  });

  return server;
}