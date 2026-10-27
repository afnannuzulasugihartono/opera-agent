// @last-edited: 2026-10-25 UTC+7.
// @title: mcp-server — the stdio MCP surface over the local driver.
// @state: 8 locks; the handshake, the advertised tools, and every way a call can fail without killing the server.
// @dependencies: ./driver.js.

// WHY THIS FILE EXISTS

// The driver runs in a process with no stdio contract, so nothing that speaks MCP can use it.
// This is that contract, and it is the whole difference between a driver that works on the machine it was written on and one that anyone can run with npx.

// WHY there are no dependencies.
// The repository runs on stock Node with an empty dependency list, and a driver meant for other people's machines is the worst place to introduce an install step that can fail on someone else's network.
// MCP over stdio is newline-delimited JSON-RPC, which Node can do unaided.

// WHY handle() is a plain function.
// A server that only exists as a process cannot be tested without spawning one, and a test that spawns a real browser fails on whoever else's machine runs it.
// So the protocol lives in a function that takes a request and returns a response, and the stdio wrapper below it stays thin enough to be obvious by reading.

// WHY closing goes through the fallback driver.
// Routing close_tab by its tab id would open a websocket to the tab being closed just to tear it down, and fail on a tab already half-dead.
// The fallback closes by id with no session at all, and both caches still drop what they hold for it.

const PROTOCOL_VERSION = '2024-11-05';

// WHY THE STATEMENT JOB IS IMPORTED HERE AND NOT ROUTED THROUGH A DRIVER.
// A card and a manifest are disk work: they open no tab, read no page and need no browser to be running.
// Asking a driver for them would mean a statement job fails on a machine where the browser is closed, which is exactly when a bookkeeper wants to see what was delivered last month.
// For the same reason the statement, report and document calls answer before a tab is resolved inside run(): opening a session would touch a browser the job does not need.

import { statementCard, statementDelivered } from './statements.js';
import { reportFromFile } from './reports.js';
import { documentFromFile } from './documents.js';
import { BURST_INPUT_ACTIONS, normalizeBurst, runLocalBurst } from './burst.js';
import { TOOLS, ASKABLE, askParams, STRAY_FILE_TAB } from './tools.js';

// The tool table lives in tools.js: the surface is data, and this file is the protocol that answers it.

export { TOOLS };

function requireArguments(args, required) {
  for (const name of required) {
    if (args?.[name] === undefined || args?.[name] === null || args?.[name] === '') {
      throw new Error(`${name} is required`);
    }
  }
}

// A browser that closed mid-call must not take the server with it, because the next tool call is still worth trying.

function asText(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] };
}

// WHY THE AUTO PAGE IS A STATE LINE AND NOT THE ROWS.
// Measured on a real eight-call job: the actions alone spent 25,089 characters, because sixty rows and the page text rode along after every click, and most of that text was the part that did not move.
// An agent pays for that in tokens and in attention, and re-reads it a turn later.
// So the answer carries where the page is (url, title, how much text it holds, what has focus), how many rows it has, and the rows that changed.
// The rest is one deliberate ax_snapshot away, which is a look the agent chose to take.

// WHY A WAIT POLLS THE FULL READ.
// The point of waiting is to end on the same evidence an agent would read by hand — including the document on a Google Doc, which the bare page text does not hold.
// A wait that runs out of budget throws nothing: found:false comes back with the page as it stands, which is what the next decision needs.
// Bounds are clamped, not refused, because a wait budget is a safety property and the snapshot limit already set that precedent.

const AUTO_PAGE_LIMIT = 60;
const AUTO_ROWS = 8;

// WHY THE FALLBACK STILL EXISTS.
// Every driver made by this tree has settle(), but a caller can hand the server its own driver, and a snapshot taken before a menu opened is a wrong answer.
// The fallback is the old fixed beat, used only when the driver cannot watch the page; the real path is the Node-polled settle in primitives, which ends after 32ms of quiet instead of always spending 120ms.

const SETTLE_FALLBACK_MS = 120;

// WHY AN ACTION REPORTS THE PAGE IT LEFT BEHIND.
// An agent that has to ask for the page after every action spends two round trips on one decision — act, then look — and the look is the half that costs.
// Measured on the reference implementation: roughly thirty per cent of all tool calls were snapshots, almost all of them immediately after something the agent had just done.
// The reply therefore says where the page is, what changed, and how many rows are still one call away, so a decision costs one call without the answer carrying the whole page.

// WHY ACTIONS REPORT WHAT CHANGED.
// The change set is computed against the last look at the same tab: rows that appeared, rows that moved, and a count of rows that left.
// Rows match by value — role, name and position — so duplicates collapse and a reshaped page reports itself as reshaped instead of listing sixty new rows.
// Only the first eight added or moved rows ride along: they are the ones worth acting on, and the count says what was held back.
// Keyed by driver object in a WeakMap, so a closed tab's last look is garbage instead of a leak.

// WHY THE LOOK SETTLES FIRST.
// The snapshot used to run the instant the action's reply landed — and a menu that opens a frame later was already missed: proven live, the auto-page after clicking Insert held no menu rows while a snapshot a moment later held fifteen.
// The fix used to be 120ms of sleep because no cheaper signal existed.
// The page now watches itself with a MutationObserver, but the clock that reads that watcher lives in Node: a hidden tab clamps a page-side timer to seconds, measured 304ms to 1,009ms on a Google Doc, while a snapshot of the same page took 4ms.
// Node waits 8ms, asks how quiet the page has been, and stops after 32ms of quiet or 120ms total, so a background tab cannot turn the settle into a multi-second stall.
// Settling is still part of seeing, but it is measured instead of assumed.

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

import { withAdvice } from './advice.js';

const lastAuto = new WeakMap();
const lastPage = new WeakMap();

// WHY THE WINDOW LINE IS HELD PER DRIVER AND NOT PER CALL.
// afterAction builds the answer and the run that produced it are two different places; a driver is the one thing they share, and a tab's driver is exactly the scope where "what did this action do about the window" is a question with one answer.
// WHY THE ANSWER SAYS SO.
// An action that silently brought the user's window forward would be an action that changed something nobody asked for; an action that silently could not would be one that reports a click nobody received.
// So every input answer carries one line - already in front, or the window it brought, or why it could not - and reading, capturing and asking carry nothing, because they did nothing to where the machine's attention was.

const windowSaid = new WeakMap();

const tabSaid = new WeakMap();

// WHY THE ROWS ARE KEPT ONCE.
// Advice is written against the page as it stood a moment ago, not against one session's private cache: an agent that asked for a row on the tab it is driving is asking about the page it can see.
// Most recent read wins, and a failure before any read at all simply gets no advice about what was there.

let lastSeen = [];

// WHY A TAB THAT POINTS AT THE DROPPED FILE IS CLOSED.
// Chrome answers a drop no page accepted by doing the default thing: it opens the file.
// Measured live — every rejected drop left a `file://` tab behind, and every accepted drop left none — so a stray tab is also the honest signal that the page took the drop.
// It is closed and named, never hidden: a drop that did not land says so instead of leaving litter on the person's screen.

// WHY THE BUDGETS ARE CLAMPED WHERE THEY ARE.
// A wait that is asked for in milliseconds and a wait that is asked for in hours both have to come back: an agent that asks for a minute and waits ten is not measuring the page, it is measuring its own typing.
// Bounds keep a wait a wait.

const budgetOf = (value, fallback) => {
  const asked = Number(value ?? fallback);
  return Number.isFinite(asked) ? Math.min(30000, Math.max(500, asked)) : fallback;
};

const gapOf = (value, fallback, min = 100) => {
  const asked = Number(value ?? fallback);
  return Number.isFinite(asked) ? Math.min(5000, Math.max(min, asked)) : fallback;
};

const quietOf = (value, fallback) => {
  const asked = Number(value ?? fallback);
  return Number.isFinite(asked) ? Math.min(5000, Math.max(50, asked)) : fallback;
};



const settleForLook = async (driver) => {
  if (typeof driver.settle === 'function') {
    const settled = await driver.settle().catch(() => null);
    if (settled && settled.why !== 'failed' && settled.why !== 'no answer') return;
  }
  await new Promise((r) => setTimeout(r, SETTLE_FALLBACK_MS));
};

// WHY AN ACTION CAN SAY IT ALREADY SETTLED.
// A wait or a chord-only stream has already watched the page go quiet, so settling again before the snapshot is the same 32ms paid twice.
// The action's own verdict is the evidence; the page look trusts it.

const afterAction = async (driver, action, limit) => {
  if (!action?.settled) await settleForLook(driver);
  const seen = await driver.snapshot(limit ?? AUTO_PAGE_LIMIT);
  const state = typeof driver.pageState === 'function'
    ? await driver.pageState().catch(() => null)
    : null;
  const prev = lastAuto.get(driver) ?? null;
  const prevState = lastPage.get(driver) ?? null;
  lastAuto.set(driver, seen);
  lastPage.set(driver, state);
  lastSeen = seen;
  const tab = tabSaid.get(driver) ?? null;
  const diff = diffElements(prev ?? [], seen);
  return asText({
    action,
    ...(tab ? { tab } : {}),
    window: windowSaid.get(driver) ?? null,
    page: {
      url: state?.url ?? null,
      title: state?.title ?? null,
      textChars: state?.textChars ?? null,
      rows: seen.length,
      focus: state?.focus ?? null
    },
    changed: {
      added: diff.added.slice(0, AUTO_ROWS),
      moved: diff.moved.slice(0, AUTO_ROWS),
      removed: diff.removed,
      reshaped: diff.reshaped,
      baseline: prev === null,
      url: prevState && state ? (prevState.url === state.url ? 'same' : state.url) : null,
      textGrew: prevState && state ? state.textChars - prevState.textChars : null
    }
  });
};

// WHY "SOME BROWSER IS IN FRONT" WAS A LIE.
// This machine has Chrome and Brave on it, and the answer said focused true with Brave in front while the drive was on a Chrome tab - an agent that reads that would never learn that the window it is driving is somewhere else entirely.
// So the answer names which browser has the machine, and "focused" means the window in front is one holding a tab of ours.

// WHY THE TITLES ARE THE EVIDENCE.
// Nothing in the bridge says which browser a tab belongs to, but the window in front carries the title of the page in it, and the tabs we drive carry their titles too.
// The one case this cannot tell is two windows showing the same page title, and it answers that with what it knows - the browser in front - rather than a yes it cannot back.

const windowTruth = (window, browsers, tabs = []) => {
  const foreground = String(window?.foreground ?? '');
  const lower = foreground.toLowerCase();
  const browser = browsers.find((entry) => lower.endsWith(`- ${String(entry.name).toLowerCase()}`))?.name ?? '';
  const ours = foreground !== '' && tabs.some((page) => String(page?.title ?? '').length > 3 && lower.includes(String(page.title).toLowerCase()));
  return {
    focused: ours,
    browser,
    title: ours ? foreground : '',
    why: window?.why || (foreground === ''
      ? 'the machine did not say which window is in front'
      : ours ? '' : `${browser || 'another window'} is in front${browser ? `, and this tab is not in ${browser}` : ''}`)
  };
};

// WHY THE TAB LOOKUP COMPARES TEXTUALLY.
// A Chrome tab id is a number, the tool schema says string, and an agent copies the id straight out of the tab list it was just handed.
// Comparing with === refused the id the product itself printed, which is how a drive that can see six tabs decides none of them is real.
// Ids are compared as text everywhere they cross a boundary.

// WHY THE PORT IS ASKED FOR, NOT STORED.
// The pipe is chosen per call because a worker can wake up late, so a port captured at startup is a lie the moment after it.
// Measured on the user's own machine: the drive was already on the bridge, list_tabs returned the real tabs, and browser_status still named the debugging port nothing was listening on — the kind of wrong answer that sends someone off to debug a port that was never in the way.

const livePort = (context) => (typeof context.port === 'function' ? context.port() : context.port);

// WHY EVERY ANSWER NAMES THE TAB IT HIT.
// An agent that named a tab rather than numbering it has to be told which tab that turned out to be, because the name it wrote is not an id and the answer is where the id belongs.

// WHY A FAILURE CARRIES THE NEXT MOVE.
// A message that only names the problem sends an agent looking for the problem again, usually while the thing that caused it is closing.
// Measured on this product's own author: every one of these failures had the same two or three next moves, and they were rediscovered every single time.
// The rows the advice reads are the page as it stood a moment ago, so "what was there" is answered with evidence rather than a guess.

// WHY A PAGE WITH NO FILE INPUT IS A FAILURE AND NOT AN ANSWER.
// Measured live on Google Docs: upload returned inputFound: false as a successful tool call, so an agent reading it as "done" moved on with nothing in the document - and the road in, a drop, was nowhere in the answer.
// The page is perfectly reachable; it simply has no input to fill.
// So it fails, names that, and carries the drop with it.

// WHY A NAMED TAB IS NAVIGATED AND NOT OPENED.
// Measured live on this machine: `open_url` with a tabId answered "driver.open is not a function", because a per-tab driver has no way to open anything - and a caller who names a tab means "this tab goes here", not "open one more".
// So a named tab is navigated and says which tab it moved.

// WHY THESE TOOLS CHECK THE WINDOW AND THE OTHERS DO NOT.
// A click, a key, text typed, a file dropped and a menu walked all have to reach a page that is listening, and a page behind another window is not listening - measured live, with Google Docs taking the keys and dropping them while every answer said the click was delivered.
// Reading, capturing and asking change nothing about where the machine's attention is, so they do not pay for the check, and a drive that is only looking never steals the human's focus.

// WHY THE WINDOW THAT GETS BROUGHT FORWARD IS THE ONE HOLDING THE TAB.
// With two browser windows open, a check that brings an arbitrary one forward leaves the tab in the same place as before and the answer says it fixed something.
// The tab's own title is the piece that identifies its window, and the call is best-effort: a driver that cannot see windows says so and the action still goes out.

// WHY A TAB MAY BE NAMED AS WELL AS NUMBERED.
// Measured live on this product's own author: an agent that copies an eight-digit id wrong is told "No page target", and the number is the one thing it cannot check - it cannot read a digit back off a screenshot, but it can read a title.
// So a tabId that is not a number is looked for by title or address, and a name that fits two tabs is refused with both of them, because picking one and saying nothing is how a drive ends up typing into the wrong document.

const INPUT_TOOLS = new Set(['click', 'click_row', 'hover', 'type', 'stream_keys', 'press_key', 'upload', 'drop_file', 'open_menu', 'download']);

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

const namedTab = async (wanted) => {
  const text = String(wanted ?? '').trim().toLowerCase();
  if (text === '') return null;
  const pages = await fallback.tabs().catch(() => []);
  const hits = pages.filter((page) => String(page.title ?? '').toLowerCase().includes(text)
    || String(page.url ?? '').toLowerCase().includes(text));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new Error(`"${wanted}" is ${hits.length} tabs: ${hits.map((page) => `${page.id} ${page.title}`).join(' | ')}. Name it more closely, or use its id.`);
  }
  return null;
};

const resolvedTab = async (tabId) => {
  if (tabId === undefined || tabId === null || tabId === '') return null;
  const asText_ = String(tabId);
  const pages = await fallback.tabs().catch(() => []);
  const exact = pages.find((page) => String(page.id) === asText_);
  if (exact) return { id: asText_, title: String(exact.title ?? ''), named: false };
  if (/^\d+$/.test(asText_)) return null;
  const hit = await namedTab(asText_);
  return hit ? { id: String(hit.id), title: String(hit.title ?? ''), named: true } : null;
};

// WHY THE WINDOW MATCH HAS TO BE TEXT.
// Measured through this server on this machine: the guard turns the match into text to pick a window off the taskbar, and a promise sent as the match became "[object Promise]", so a minimized browser was never brought back.
// The tab's title is the piece its window carries, and a call that names no tab drives the tab the driver is attached to, whose page knows its own title.

const pageTitle = async (driver) => {
  const state = await driver.pageState().catch(() => null);
  return String(state?.title ?? '');
};

const windowMatch = async (tab, driver) => (tab ? String(tab.title ?? '') : pageTitle(driver));

  const run = async (name, args) => {
    requireArguments(args, TOOLS.find((t) => t.name === name)?.inputSchema.required ?? []);

    // The burst is checked before a tab is resolved, so a malformed step list cannot touch a browser, and a caller learns which step was wrong before any page is changed.
    const burst = name === 'browser_burst' ? normalizeBurst(args) : null;

    if (name === 'statement_card') {
      return asText(statementCard({
        client: args.client,
        portal: args.portal,
        period: args.period,
        url: args.url ?? null,
        root: args.root ?? null,
        ext: args.ext ?? 'pdf'
      }));
    }
    if (name === 'statement_delivered') {
      return asText(statementDelivered({
        client: args.client,
        portal: args.portal,
        period: args.period,
        path: args.path,
        balance: args.balance ?? null,
        manifest: args.manifest ?? null,
        replace: args.replace === true
      }));
    }
    if (name === 'document_build') {
      return asText(documentFromFile({
        source: args.source,
        out: args.out ?? null
      }));
    }
    if (name === 'report_build') {
      return asText(reportFromFile({
        source: args.source,
        client: args.client,
        title: args.title,
        period: args.period,
        periodColumn: args.periodColumn ?? null,
        groupBy: args.groupBy,
        valueColumn: args.valueColumn,
        out: args.out ?? null
      }));
    }

    const tab = name === 'close_tab' ? null : await resolvedTab(args?.tabId);
    const driver = name === 'close_tab' ? fallback : await driverFor(tab ? tab.id : args?.tabId);
    const wantsFront = INPUT_TOOLS.has(name)
      || (burst?.steps.some((step) => BURST_INPUT_ACTIONS.includes(step.action)) ?? false);
    const front = wantsFront && typeof driver.ensureFront === 'function'
      ? await driver.ensureFront({ match: await windowMatch(tab, driver) })
      : null;

    // WHY A DEAF PAGE STOPS THE ACTION.
    // Measured live on this machine: two windows can carry one page title, and the window that comes forward may not be the one holding this tab.
    // The guard now confirms the page hears input after a restore; when it does not, sending the keystroke anyway is the silent loss this product exists to remove.
    if (front?.blocked) {
      throw new Error(`refused: ${front.window}. Nothing was sent, because input into a window that cannot hear it is lost without a word. Bring the window back with focus_window, or name the tab, then try again.`);
    }
    windowSaid.set(driver, front);
    tabSaid.set(driver, tab);

    switch (name) {
      case 'browser_status': {
        const window = await driver.windowState();
        const pages = await fallback.tabs().catch(() => []);
        return asText({
          browsers: context.browsers,
          port: livePort(context),
          window: windowTruth(window, context.browsers, pages)
        });
      }
      case 'focus_window':
        return asText(await driver.focusWindow(args.match ?? ''));
      case 'dialog_state':
        return asText(await driver.dialogState());
      case 'dialog_type':
        return asText(await driver.dialogType(args.text ?? ''));
      case 'dialog_press':
        return asText(await driver.dialogPress(args.name ?? ''));
      case 'list_tabs':
        return asText(await driver.tabs());
      case 'open_url':
        return afterAction(driver, tab
          ? { navigated: await driver.navigate(args.url), tab: args.tabId }
          : await driver.open(args.url));
      case 'close_tab': {
        const out = await driver.close(args.tabId);
        sessions.get(args.tabId)?.close?.();
        sessions.delete(args.tabId);
        return asText(out);
      }
      case 'surface_profile':
        return asText(await driver.surfaceProfile());
      case 'read_page':
        return asText(await driver.read({ allowCaretMove: args.allowCaretMove === true }));
      case 'find_elements':
        return asText(await driver.find(args.query));
      case 'click':
        return afterAction(driver, args.at
          ? await driver.clickFraction(args.at)
          : await driver.click(args.x, args.y, args.handle ?? null));
      case 'resolve_row':
        return asText({ action: await driver.resolve(args.role, args.name) });
      case 'click_row':
        return afterAction(driver, await driver.clickRow(args.role, args.name));
      case 'hover':
        return afterAction(driver, await driver.hover(args.x, args.y));
      case 'press_key':
        return afterAction(driver, await driver.key(args.key, args.modifiers ?? []));
      case 'type':
        return afterAction(driver, await driver.type(args.text));
      case 'append':
        return afterAction(driver, await driver.append(args.text));
      case 'get_computed':
        return asText(await driver.computed({ x: args.x, y: args.y, selector: args.selector }));
      case 'scroll':
        return afterAction(driver, await driver.scroll({
          y: args.y,
          end: args.end === true,
          text: args.text,
          selector: args.selector
        }));
      case 'stream_keys':
        return afterAction(driver, await driver.keys(args.events));
      case 'browser_burst':
        return afterAction(driver, await runLocalBurst({
          driver,
          steps: burst.steps,
          timeoutMs: burst.timeoutMs
        }));
      case 'wait_for': {
        const started = Date.now();
        const rawTimeout = Number(args.timeoutMs ?? 8000);
        const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(30000, Math.max(500, rawTimeout)) : 8000;
        const rawGap = Number(args.intervalMs ?? 100);
        const intervalMs = Number.isFinite(rawGap) ? Math.min(5000, Math.max(50, rawGap)) : 100;
        const state = await driver.waitForText(args.text, { timeoutMs, intervalMs });
        return afterAction(driver, { found: (state.text || '').includes(args.text), ms: Date.now() - started });
      }
      case 'ask_page': {
        const method = String(args.method ?? '');
        if (!ASKABLE.includes(method)) {
          throw new Error(`ask_page is read-only. Allowed: ${ASKABLE.join(', ')}. Asked for: ${method || '(none)'}`);
        }
        return asText({ method, result: await driver.ask(method, askParams(args)) });
      }
      case 'wait_for_row':
        return afterAction(driver, await driver.waitForRow({
          role: args.role,
          name: args.name,
          absent: args.absent === true,
          timeoutMs: budgetOf(args.timeoutMs, 10000),
          intervalMs: gapOf(args.intervalMs, 50, 50)
        }));
      case 'wait_still':
        return afterAction(driver, await driver.waitForStill({
          timeoutMs: budgetOf(args.timeoutMs, 8000),
          quietMs: quietOf(args.quietMs, 120)
        }));
      case 'guide':
        return asText(await driver.guide(args.topic));
      case 'list_menus':
        return asText(await driver.menuTree({ limit: args.limit }));
      case 'open_menu': {
        const path = Array.isArray(args.path) ? args.path : [];
        if (path.length === 0) throw new Error('open_menu needs a path of menu names, e.g. ["Insert","Image"]');
        return afterAction(driver, await driver.openMenu({
          path,
          clickLeaf: args.clickLeaf === true,
          limit: args.limit
        }));
      }
      case 'ax_snapshot':
        return asText(await driver.snapshot(args.limit));
      case 'caret_line':
        return asText(await driver.caretLine());
      case 'upload': {
        const uploaded = await driver.upload({ filename: args.filename, data: args.data ?? null, path: args.path ?? null });
        if (uploaded && uploaded.inputFound === false) {
          throw new Error(`upload: inputFound: false - ${args.filename} went nowhere: the page has no file input to fill`);
        }
        return afterAction(driver, uploaded);
      }
      case 'drop_file': {
        const before = new Set((await fallback.tabs()).map((tab) => String(tab.id)));
        const dropped = await driver.dropFile({
          x: args.x,
          y: args.y,
          filename: args.filename,
          data: args.data ?? null,
          path: args.path ?? null
        });
        const strays = (await fallback.tabs()).filter((tab) => !before.has(String(tab.id)));
        let openedInstead = false;
        for (const tab of strays) {
          if (!String(tab.url ?? '').startsWith(STRAY_FILE_TAB)) continue;
          openedInstead = true;
          await fallback.close(String(tab.id)).catch(() => null);
        }
        return afterAction(driver, { ...dropped, openedInstead });
      }
      case 'intercept_file_chooser':
        return asText(await driver.interceptFileChooser(args.enabled === true));
      case 'download':
        return asText(await driver.download({
          handle: args.handle ?? null,
          role: args.role ?? null,
          name: args.name ?? null,
          x: args.x,
          y: args.y,
          dir: args.dir ?? null,
          saveAs: args.saveAs ?? null,
          timeoutMs: args.timeoutMs
        }));
      case 'capture_page': {
        const shot = await driver.captureSized(args.fullPage === true ? { fullPage: true } : {});
        return {
          content: [
            { type: 'image', data: shot.data, mimeType: 'image/jpeg' },
            { type: 'text', text: JSON.stringify({ viewport: shot.viewport, dpr: shot.dpr, image: shot.image, note: shot.note }) }
          ]
        };
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
        return fail(withAdvice(error, { rows: lastSeen }));
      }
    }
  };
}

// WHY the loop is line based and never awaits a parse.
// MCP stdio frames are newline-delimited JSON, so a line that is not yet complete is not a frame, and a malformed one must be reported rather than thrown, because a throwing read loop ends the session over one bad message.

// WHY the dispatch carries a rejection handler and a void.
// Without the handler a single rejected handle ends the process on an unhandled rejection, taking down a whole session over one bad call.
// SonarCloud caught that on this file and it was right: the handler is not decoration.
// The void then says the reply is deliberately not awaited, because an event loop has nothing else to wait for.

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