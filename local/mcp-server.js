// @last-edited: 2026-10-11 UTC+7.
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
// For the same reason those two calls answer before a tab is resolved inside run(): opening a session would touch a browser the job does not need.

import { statementCard, statementDelivered } from './statements.js';
import { reportFromFile } from './reports.js';
import { BURST_ACTIONS, BURST_INPUT_ACTIONS, BURST_MAX_STEPS, normalizeBurst, runLocalBurst } from './burst.js';

const stringArg = (name) => ({ type: 'string', description: name });
const numberArg = (name) => ({ type: 'number', description: name });

// The surface is only what the driver does well.
// It has a local burst for dependent moves on one tab, but no reusable element refs beyond a handle that a resolve step hands to a later step, and no cross-tab steps: those are the cloud server's affordances, and pretending a local stdio process has them would advertise something it cannot honour.
// Coordinates and a fresh read per action stay honest; the burst is the one call that spends its page read once, at the end, instead of after every step.

const tabArg = { type: 'string', description: 'which tab to drive, from list_tabs. Required for anything that writes. A chrome:// page (extensions, settings) refuses every move - name a tab the bridge can drive instead.' };

// WHY THIS SURFACE IS ALLOWLISTED AND READ-ONLY.
// An agent's fastest route from confused to knowing is asking the browser a structured question: which frames exist, which node is behind a row, what is in a frame's document.
// Doing that today means finding the loopback door by accident — and a product that offers no way to ask is a product that teaches guessing instead.
// So the door is promoted to a tool, with the answer to "how much power does this hand out" written into the list: only these methods, only reads.
// No Runtime.evaluate, so no free script in the page and no way around the redaction a snapshot applies to a password; no Input, no Page navigation, no storage.
// Anything that changes the page stays a named primitive, where it can be described, bounded and tested.
// A method not on this list is not refused by a shrug: it is refused by name, with the list, because "no" that explains itself is worth more than a "no" the agent has to guess at.

const ASKABLE = Object.freeze([
  'Page.getFrameTree',
  'Page.getNavigationHistory',
  'Page.captureScreenshot',
  'DOM.getDocument',
  'DOM.describeNode',
  'DOM.getFrameOwner',
  'DOM.getAttributes',
  'DOM.getBoxModel',
  'DOM.getOuterHTML',
  'DOM.querySelector',
  'DOM.querySelectorAll',
  'DOM.resolveNode',
  'DOM.requestNode'
]);

// WHY SCREENSHOTS ARE INCLUDED AND JPEG IS NOT FORCED.
// A picture is the one answer an agent cannot get wrong by reading too much, and asking for png is how a test image gets made for a page that will not take files.

const askParams = (args) => {
  const params = args.params && typeof args.params === 'object' ? args.params : {};
  if (args.method === 'Page.captureScreenshot') return { format: 'png', ...params };
  return params;
};

const STRAY_FILE_TAB = 'file://';

export const TOOLS = Object.freeze([
  {
    name: 'browser_status',
    description: 'Report which Chromium browsers are installed, which debugging port is live, and whether a browser window is in front on this machine. A page cannot see whether the window in front of it is the one the operating system has in front, so when clicks and keys go nowhere this is the call that says why.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'focus_window',
    description: 'Bring a browser window to the front of the machine, so the page can take clicks and keys. Give the piece of the window title to bring forward ("Google Docs", "Google Chrome") - with two browser windows open, no match brings an arbitrary one forward. Answers the title it brought, and whether the operating system let it.',
    inputSchema: { type: 'object', properties: { match: stringArg('piece of the window title to bring forward') } }
  },
  {
    name: 'dialog_state',
    description: "Report the operating system's own dialog if one is open - its title, its buttons, and the text in its field. A file picker opened by a page lives outside the browser: no capture, no snapshot and no tab sees it, so this is the only way to know what it is asking for.",
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'dialog_type',
    description: 'Type text into the open operating system dialog\'s field - a full path into a file picker is the one that matters. This is outside the browser: the text goes to the dialog itself, not to a page.',
    inputSchema: { type: 'object', properties: { text: stringArg('text to put in the dialog field, usually a full path') }, required: ['text'] }
  },
  {
    name: 'dialog_press',
    description: "Press a button on the open operating system dialog by name - \"Open\", \"Save\", \"Cancel\". A page that opened a file picker cannot be answered from the browser; this answers it from the machine. Answer with the button it found, so a call that pressed the wrong thing says so.",
    inputSchema: { type: 'object', properties: { name: stringArg('button on the dialog, e.g. Open or Cancel') }, required: ['name'] }
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
    description: 'Read one tab: url, title and text, plus whether that text had stopped moving. settled and grewBy come from two reads a beat apart, because readyState lies: measured live, a page reported complete with a tenth of its text and reached the rest 600 ms later - a read that says settled:false is a page still filling in, so read again or wait_still() before acting. On a Google Doc the text is the document itself, read through the editor with paragraphs kept as lines; that read borrows the selection and puts the caret back where it was, answering caretMoved and caretRestored so a caret it could not restore is known rather than guessed, and settled is null there with settledWhy, because a second copy would move the caret twice. On other canvas-rendered pages little or no text comes back, so pair this with capture_page when the task needs to see content.',
    inputSchema: { type: 'object', properties: { tabId: tabArg } }
  },
  {
    name: 'find_elements',
    description: 'Find visible text on the page and return each match with a viewport rect. Coordinates are in the same space capture_page returns, so a rect here can be clicked directly.',
    inputSchema: { type: 'object', properties: { tabId: tabArg, query: stringArg('text to look for') }, required: ['query'] }
  },
  {
    name: 'click',
    description: 'Click in one tab. Give x and y for a point in the viewport (CSS pixels), at with fractions of the viewport (0 to 1) when the window may be resized between looking and clicking, or a handle to click that element wherever it is by then. A fraction is resolved against the viewport as it is at the moment of the click, so a window that changed size between turns does not move the aim; a handle cannot go stale at all, because the box is measured from the node at the click. The reply carries where the page now stands - url, title, text length, focus - and the rows that changed; ax_snapshot() lists every row when the next move needs more than the change set.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        x: numberArg('viewport x'),
        y: numberArg('viewport y'),
        handle: { type: 'string', description: 'element handle from resolve_row or click_row, instead of x and y' }
      }
    }
  },
  {
    name: 'resolve_row',
    description: 'Find a row by role and name in a fresh snapshot and hold on to the element itself, without clicking it. Returns the handle, the row, and where it stands right now — for when the gap between looking and acting is longer than one tool call: hover a submenu, wait for a dialog, then click the thing you already chose. The name matches exactly first and as a substring after.',
    inputSchema: {
      type: 'object',
      properties: { tabId: tabArg, role: stringArg('row role, e.g. menuitem'), name: stringArg('row name') },
      required: ['role', 'name']
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
    description: 'Send a key with optional modifiers to the focused element of one tab, for example a chord or an arrow. Returns where the page now stands and what changed, so what the key did is visible without a second call.',
    inputSchema: {
      type: 'object',
      properties: { tabId: tabArg, key: stringArg('Enter, Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, Space, Backspace, Delete, or a single printable ASCII character'), modifiers: { type: 'array', items: { type: 'string', enum: ['Control', 'Alt', 'Shift', 'Meta'] }, description: 'held while the key goes down' } },
      required: ['key']
    }
  },
  {
    name: 'type',
    description: 'Insert text into the focused surface of one tab, including newlines as real paragraph breaks in a rich editor. Returns where the page now stands and what changed, plus where the text landed: placed carries the index and neighbours of the inserted words on DOM pages, and found:false on canvas pages where the mirror lags - there read_page() is the proof, and a failure always deserves a read before any retry, because a slow mirror looks exactly like a dead page.',
    inputSchema: { type: 'object', properties: { tabId: tabArg, text: stringArg('text to insert') }, required: ['text'] }
  },
  {
    name: 'get_computed',
    description: 'Read one element the way the page renders it: tag, role, name, its box and whether it is on screen, plus font, size, weight, colour, background, display, visibility and opacity. Name it by selector or by the x and y inside the viewport. This is how an agent without eyes checks a page: a button that turned blue, a modal that opened, text running past the viewport. It reads; it never changes anything.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        selector: { type: 'string', description: 'CSS selector for the element' },
        x: { type: 'number', description: 'x inside the viewport, with y' },
        y: { type: 'number', description: 'y inside the viewport, with x' }
      }
    }
  },
  {
    name: 'scroll',
    description: 'Move the view: {y: pixels} for a relative scroll, {end: true} for the bottom, {text: "..."} or {selector: "..."} to bring something on screen. The answer carries what the page measured - which scroll container moved (a window or a panel, named), from and to, travelPx (how far the page can still go), and for a target whether it is now on screen. Without it a 21-page document is only its first screen, a lazy list never loads, and a click can answer success on coordinates that are above the viewport and hit nothing. It sets the scroll offset rather than sending a wheel, because a synthetic mouseWheel over a canvas editor got no answer at all from the tab - still outstanding after eight seconds, on two documents - and a scroll that hangs is worse than one that does nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        y: { type: 'number', description: 'pixels to move the view; negative moves up' },
        end: { type: 'boolean', description: 'scroll to the bottom of the page or panel' },
        text: { type: 'string', description: 'scroll the text named here into view' },
        selector: { type: 'string', description: 'scroll the element matching this CSS selector into view' }
      }
    }
  },
  {
    name: 'append',
    description: 'Add text at the very end of one tab: the caret is asked for the end, the text goes in, and the answer says whether anything follows it. atEnd is measured, not assumed - it is true only when the page shows no text after what was inserted, and it is found:false on canvas pages that mirror late, where read_page() is the proof. Use this instead of clicking and pressing End yourself: that road put a whole batch inside a table cell once, measured live. On a canvas editor atEnd is usually false for a good reason - the text the page reports ends with the editor chrome rather than with the document - so atEndWhy names what followed, and read_page() is the proof that the append reached the end of the document.',
    inputSchema: { type: 'object', properties: { tabId: tabArg, text: stringArg('text to add at the end') }, required: ['text'] }
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
    name: 'browser_burst',
    description: 'Run 1-8 dependent steps on one tab in a single call: click, click_row, hover, press_key, type, append, scroll, stream_keys, resolve, or wait. Steps run in order and the first failure stops the burst, keeping the steps that finished. The page is settled and read once at the end, not after every step, so a menu walk costs one page look instead of four. refFromStep carries a handle from an earlier resolve into a later click, or a point into a later hover; there is no cross-tab step, no navigation, and no script. Use the named tools for upload, download, open_url, or anything that changes which page this is.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        timeoutMs: { type: 'number', description: 'budget for the whole burst, default 12000, capped at 12000' },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: BURST_MAX_STEPS,
          description: 'dependent steps, in order; the first failure stops the burst',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: [...BURST_ACTIONS], description: 'what this step does' },
              x: { type: 'number', description: 'viewport x for click or hover' },
              y: { type: 'number', description: 'viewport y for click or hover' },
              handle: { type: 'string', description: 'element handle for click, instead of x/y' },
              refFromStep: { type: 'number', description: 'earlier step whose handle or point this step uses' },
              role: { type: 'string', description: 'row role for click_row, resolve, or a row wait' },
              name: { type: 'string', description: 'row name for click_row, resolve, or a row wait' },
              key: { type: 'string', description: 'key for press_key' },
              modifiers: { type: 'array', items: { type: 'string', enum: ['Control', 'Alt', 'Shift', 'Meta'] } },
              text: { type: 'string', description: 'text for type or append, or the text a wait looks for' },
              events: { type: 'array', items: { type: 'object' }, description: 'events for stream_keys' },
              end: { type: 'boolean', description: 'scroll to the end' },
              selector: { type: 'string', description: 'scroll this selector into view' },
              absent: { type: 'boolean', description: 'wait for the text or row to leave' },
              intervalMs: { type: 'number', description: 'gap between wait checks' }
            },
            required: ['action']
          }
        }
      },
      required: ['steps']
    }
  },
  {
    name: 'wait_for',
    description: 'Wait until a tab shows a text, then return the page as it now stands. Polls the same page state a read would show — including the document on a Google Doc — so the wait ends on the same evidence, without paying a full two-sample read on every check. Returns found:false with the current page instead of failing when the budget runs out.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        text: stringArg('text to wait for'),
        timeoutMs: { type: 'number', description: 'budget, default 8000, capped at 30000' },
        intervalMs: { type: 'number', description: 'gap between checks, default 100, capped at 5000' }
      },
      required: ['text']
    }
  },
  {
    name: 'ask_page',
    description: `Ask the browser a structured, read-only question about one tab and get the raw answer: the frame tree, the node behind a row, what a frame's document holds, a selector's matches, an element's box or outer HTML, a screenshot as png. This is how an agent finds out what a page actually is instead of inferring it from behaviour. Methods are allowlisted to reads only — ${ASKABLE.join(', ')} — so nothing here can change the page; anything that acts stays a named tool.`,
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        method: { type: 'string', enum: [...ASKABLE], description: 'one of the read-only CDP methods' },
        params: { type: 'object', description: 'the method\'s own parameters, passed through' }
      },
      required: ['method']
    }
  },
  {
    name: 'wait_for_row',
    description: 'Wait until a row is there - or, with absent, until it is gone. Menus, dialogs, buttons and spinners are not text, and reading the page cannot see them: this reads the same rows an agent sees and ends on the first one that matches. Returns found:false with the page as it stands when the budget runs out, instead of failing.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        role: stringArg('row role, e.g. menuitem'),
        name: stringArg('row name, matched exactly first and as a substring after'),
        absent: { type: 'boolean', description: 'wait for the row to go away instead of to arrive' },
        timeoutMs: { type: 'number', description: 'budget, default 10000' },
        intervalMs: { type: 'number', description: 'gap between checks, default 50' }
      },
      required: ['role', 'name']
    }
  },
  {
    name: 'wait_still',
    description: 'Wait until the page stops changing. Two identical reads in a row is the signal, so this ends on evidence rather than on a guess: use it after anything that moves on its own - a menu opening, a save running, an upload landing - and then act on what is actually there.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        timeoutMs: { type: 'number', description: 'budget, default 8000' },
        quietMs: { type: 'number', description: 'how long the page must hold still, default 120' },
        intervalMs: { type: 'number', description: 'kept for compatibility; the wait now settles on the page instead of sleeping a fixed gap' }
      }
    }
  },
  {
    name: 'caret_line',
    description: 'Report the text of the line the caret stands on. Selects its own line to read it, then puts the caret back where it was and answers caretRestored so a caret it could not put back is known. Dismiss any menu first; with one open the keys walk the menu instead of the text.',
    inputSchema: { type: 'object', properties: { tabId: tabArg } }
  },
  {
    name: 'upload',
    description: 'Upload a file into the page without touching the native file dialog: bytes or a local path go straight into the first file input, and the page uploads on the change it already listens for. Give exactly one of data or path.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        filename: stringArg('file name'),
        data: { type: 'string', description: 'base64 file bytes' },
        path: stringArg('absolute local path instead of bytes')
      },
      required: ['filename']
    }
  },
  {
    name: 'drop_file',
    description: 'Drop a file onto a point in the page, the way a person drags one in: bytes or a local path, a viewport point, and the page uploads it on the drop it already listens for. This is the road into a site whose file chooser has no input behind it — Google Docs opens the operating system dialog through the File System Access API, where upload finds nothing to fill and no CDP command can reach the dialog.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        x: { type: 'number', description: 'viewport x to drop on' },
        y: { type: 'number', description: 'viewport y to drop on' },
        filename: stringArg('file name, which also decides the dropped type'),
        data: { type: 'string', description: 'base64 file bytes' },
        path: stringArg('absolute local path instead of bytes')
      },
      required: ['x', 'y', 'filename']
    }
  },
  {
    name: 'intercept_file_chooser',
    description: 'Suppress the native file picker so uploads complete without OS UI: enable, walk the menu to Upload, call upload, then disable. While enabled, Upload clicks show nothing; forgetting to disable leaves later Upload clicks silent.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        enabled: { type: 'boolean', description: 'true to suppress the picker, false to restore it' }
      },
      required: ['enabled']
    }
  },
  {
    name: 'download',
    description: 'Click the control that starts a file download and wait until the file is on disk, then return its path and byte count. Arms the folder before the click, so the file lands where the caller says instead of the default downloads folder, and resets the browser-wide behavior afterwards. Point it at a handle from resolve_row, a role and name, or an x and y. saveAs names the file once it has stopped growing, which is how a portal\'s statement.pdf becomes klien-bank-periode.pdf. The file itself is the proof: a download still writing, a click that opened a viewer instead, and a click that produced nothing each come back downloaded:false with the reason and the next move.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        handle: { type: 'string', description: 'element handle from resolve_row or click_row' },
        role: stringArg('row role to click, e.g. link or button'),
        name: stringArg('row name for that role'),
        x: numberArg('viewport x, instead of a handle or a row'),
        y: numberArg('viewport y, instead of a handle or a row'),
        dir: stringArg('folder to download into; defaults to Downloads/opera-agent'),
        saveAs: stringArg('file name to give it once it has stopped growing, without a folder'),
        timeoutMs: numberArg('how long to wait for the file, default 30000')
      }
    }
  },
  {
    name: 'list_menus',
    description: "Read what this page's application can do, from its own menu markup, without clicking anything. Every node carries its state - leaf, branch, disabled, or unrevealed - and an unrevealed node carries how it would be revealed, so a command one hover away is never reported as one that does not exist. Read this before guessing at a menu.",
    inputSchema: {
      type: 'object',
      properties: { tabId: tabArg, limit: numberArg('most rows to return, default 200') }
    }
  },
  {
    name: 'open_menu',
    description: 'Walk a menu path and stop there, opening each level on the way: path ["Insert","Image"] brings the Image submenu open and leaves the choice to you. Set clickLeaf to also activate the last item. Branches are hovered, never clicked into blindly, because clicking a row that turns out to be a branch runs whatever it was. A path that breaks returns the level it broke on, what that level actually contained, and the nearest names to what you asked for - a map, not a dead end.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: tabArg,
        path: { type: 'array', items: { type: 'string' }, description: 'menu names from the bar down, e.g. ["Insert","Image"]' },
        clickLeaf: { type: 'boolean', description: 'also activate the last item, default false' },
        limit: numberArg('most rows to read per level, default 200')
      },
      required: ['path']
    }
  },
  {
    name: 'guide',
    description: 'Read what this server can do, written as tasks rather than a tool list: for each task, the calls that do it and the road that is known to work. Pass a topic to get only the roads for that task. Also returns what each tool does to the page before you call it — which reads move the caret, which bring the tab forward, which can make an operating-system dialog appear — and the three things this server will not pretend to do. Start here when you do not know which tool to reach for.',
    inputSchema: {
      type: 'object',
      properties: { topic: stringArg('a word or two: upload, menu, wait, verify') }
    }
  },
  {
    name: 'capture_page',
    description: 'Capture one tab as a JPEG image, and say what space it is in: the viewport size, the device scale factor, and the image size read from the picture itself. The picture is the viewport times that factor, and both move when a window is resized or dragged to a monitor with another scale - measured live, the viewport went 1144x714 to 1186x670 with the scale steady at 1.25 - so convert through the numbers returned here rather than by dividing pixels by eye. Pass fullPage to span the whole document instead; then the picture is the page, not the window, and the answer says so. On canvas-rendered pages (Google Docs is one) fullPage still stops at the viewport - measured live, an 18-page document answered 2000x937 pixels - so page through with End/PageDown and capture again rather than expecting the whole document at once.',
    inputSchema: { type: 'object', properties: { tabId: tabArg, fullPage: { type: 'boolean', description: 'capture the whole page past the viewport' } } }
  },
  {
    name: 'ax_snapshot',
    description: 'Map one tab to clickable coordinates with names: role, name, x, y for every button, link, menu row and field, plus the current value where a field carries one (formula bar, name box, toolbar inputs). Call it when you want to study the whole page: an action answers with where the page stands and the rows that changed, not all of them. The text caret rides as a final caret row when visible; read its line with caret_line.',
    inputSchema: { type: 'object', properties: { tabId: tabArg, limit: { type: 'number', description: 'max rows, default 120, capped at 500' } } }
  },
  {
    name: 'statement_card',
    description: 'Turn one client, one portal and one month into the card for a single delivery: the file name, the folder it belongs in, the manifest it will join, the page to open, and what must be true before the file counts. No browser is touched and nothing is downloaded. Name the client and the portal the way the person says them; the card derives a stable file name from both, so the same client-month always lands on the same name.',
    inputSchema: {
      type: 'object',
      properties: {
        client: stringArg('the client, as the person says it'),
        portal: stringArg('the bank or vendor the statement comes from'),
        period: stringArg('the month being delivered, YYYY-MM'),
        url: stringArg('the portal or statement page, when the person gave one'),
        root: stringArg('folder that holds the job; defaults to Downloads/opera-statements'),
        ext: stringArg('file extension, default pdf')
      },
      required: ['client', 'portal', 'period']
    }
  },
  {
    name: 'statement_delivered',
    description: 'Record a downloaded statement as delivered: check the file on disk, name what kind of file it really is, count a PDF\'s pages from its own structure, and append the client-month to the manifest. Refuses a file that is still being written, empty, missing, or already recorded for that client-month - a second line would bill it twice; replace:true is for a first file that was wrong. The balance is recorded as the page printed it, with the page named as its source, because the number a bookkeeper reconciles is the one the portal showed.',
    inputSchema: {
      type: 'object',
      properties: {
        client: stringArg('the client, as the card named it'),
        portal: stringArg('the bank or vendor'),
        period: stringArg('the month being delivered, YYYY-MM'),
        path: stringArg('the path download answered with'),
        balance: stringArg('the closing balance, as the page printed it'),
        manifest: stringArg('manifest file; defaults to one beside the statement'),
        replace: { type: 'boolean', description: 'replace an existing record for this client-month' }
      },
      required: ['client', 'portal', 'period', 'path']
    }
  },
  {
    name: 'report_build',
    description: 'Turn a sheet exported to CSV into a report plan whose every figure names the column and the exact rows it came from, recheck the plan against those rows, and write it beside the source. Refuses a row outside the requested period, a value that is not money, a missing column, and a figure that disagrees with its source - so a wrong number stops the report instead of reaching a client. No browser is touched: month-end reports must not depend on a tab being open.',
    inputSchema: {
      type: 'object',
      properties: {
        source: stringArg('the CSV file exported from the workbook'),
        client: stringArg('the client the report is for'),
        title: stringArg('the report title, as the person wants it read'),
        period: stringArg('the month the report covers, YYYY-MM'),
        periodColumn: stringArg('the column that holds each row\'s date, when the sheet has one'),
        groupBy: stringArg('the column whose values become the report lines'),
        valueColumn: stringArg('the money column that is summed'),
        out: stringArg('where to write the report; defaults beside the source')
      },
      required: ['source', 'client', 'title', 'period', 'groupBy', 'valueColumn']
    }
  }
]);

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

const afterAction = async (driver, action, limit) => {
  await settleForLook(driver);
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
  // With two
// browser windows open, a check that brings an arbitrary one forward leaves the tab in the same place as before and the answer says it fixed something.
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

const windowMatch = async (tab) => (tab?.named ? tab.title : '');

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
      ? await driver.ensureFront({ match: windowMatch(tab) })
      : null;
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
      case 'read_page':
        return asText(await driver.read());
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