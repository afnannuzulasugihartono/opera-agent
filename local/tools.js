// @last-edited: 2026-10-23 UTC+7.
// @title: tools — the MCP tool surface of the local driver, with the schema each call is answered against.
// @state: every tool name, its description and its input schema, frozen in one table.
// @dependencies: ./burst.js.

// WHY THE SURFACE IS A TABLE AND NOT A SWITCH.
// A tool the agent can call is a promise made in writing, and the promise is read far more often than the code behind it is.
// Kept as data, the whole surface can be read from top to bottom, and a tool added without its schema is a diff a reviewer can see.

// WHY THE NAMES ARE UNDERSCORED AND NOT DOTTED OR HYPHENATED.
// A dot already means something in this tree: it is the namespace separator of the wire protocol underneath, where tabs.list and page.click name the method a tool ends up calling.
// A tool called page.click would be the transport wearing the product's name, and one log line would not say which layer had answered.
// A hyphen is refused by every identifier this tree writes - Postgres function names, workflow names in the migrations, and the plugin manifest's name_for_model are all read as bare identifiers, and a hyphen forces quoting in every one of them.
// An underscore survives JavaScript, TypeScript and SQL unquoted, so it is the one separator that never has to be escaped, and the wire protocol uses it the same way inside a name: page.wait_for.

import { BURST_ACTIONS, BURST_MAX_STEPS } from './burst.js';

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

export const ASKABLE = Object.freeze([
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

export const askParams = (args) => {
  const params = args.params && typeof args.params === 'object' ? args.params : {};
  if (args.method === 'Page.captureScreenshot') return { format: 'png', ...params };
  return params;
};

export const STRAY_FILE_TAB = 'file://';

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
        intervalMs: { type: 'number', description: 'kept for compatibility; the wait now settles on the page instead of sleeping a fixed gap' }
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
        intervalMs: { type: 'number', description: 'kept for compatibility; the wait now settles on the page instead of sleeping a fixed gap' }
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
    name: 'document_build',
    description: 'Turn a paper described as JSON (title, sections with tables, images and graphs) into a document plan whose every graph names the section and rows it came from, recheck the plan against those, and write it beside the source. Refuses a missing title, a section without a heading, a table with bad cells, an image without alt text, a graph with no data, and a graph that disagrees with its tables - so a wrong number stops the paper instead of reaching a reader. No browser is touched: papers are planned on disk before they reach a page.',
    inputSchema: {
      type: 'object',
      properties: {
        source: stringArg('the JSON file describing the paper'),
        out: stringArg('where to write the document; defaults beside the source')
      },
      required: ['source']
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
