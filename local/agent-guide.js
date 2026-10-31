// @last-edited: 2026-10-25 UTC+7.
// @title: agent-guide — what an agent can do here, written as tasks instead of a tool list.
// @state: recipes, side effects, honesty locks between them and the tools.
// @dependencies: none.

// WHY THIS FILE EXISTS

// An agent arriving cold does not know what to call first.
// Every tool description answers "what does this do" and never answer "I want to attach a file, what do I do" — so an agent reads all of them, in order, every session, and picks.
// Measured on this product's own author: an image upload took a dozen calls and a submenu twenty seconds of polling because the road was never written down anywhere the agent could read it.

// WHY THE RECIPES ARE DATA AND THE CHECKS ARE TESTS.
// A guide that drifts from the product is worse than none: an agent follows a route to a tool that was renamed and learns to distrust the guide.
// So the recipes name tools and the test fails the moment a name stops existing, the moment a tool has no declared side effect, and the moment a recipe points at a tool that is not on the list.
// Rot is a build failure, not a surprise in production.

// WHY SIDE EFFECTS ARE DECLARED AND NOT IMPLIED.
// Half of what an agent loses today is not a missing tool but an unannounced one: reading a Google Doc moves the caret, so the next click lands somewhere the agent had already visited.
// A tool that quietly moves something should say so in the tool list, where the agent reads before calling, not in a document it reads after being surprised.

// WHY A DOCUMENT OUTLINE IS NOT A MENU.
// Google Docs renders the document's own headings as role=menuitem, so a walk that trusts roles alone descends into the document — measured live: a menu probe on an open Docs menu returned "BAB I PENDAHULUAN" and every paragraph as menu items.
// The walk therefore treats a menu as a menu only while it hangs off a menubar or a menu that a manu item owns, and a whole branch that grows into document text is refused by name rather than walked to the end of the document.

export const RECIPES = Object.freeze([
  {
    task: 'See what is on the page',
    do: ['read_page'],
    note: 'On a Google Doc this reads the document itself, not the toolbar around it.'
  },
  {
    task: 'Meet a site you have never seen',
    do: [
      'surface_profile',
      'read_page'
    ],
    note: 'surface_profile costs one call and moves nothing, so it is the safe first step anywhere. Read the strategy it returns before paying for a read.'
  },
  {
    task: 'See what can be clicked, with coordinates',
    do: ['ax_snapshot'],
    note: 'Menus and dialogs come first, so a menu the agent just opened is never past the cap.'
  },
  {
    task: 'Click a row by what it is called',
    do: ['click_row'],
    note: 'One round trip: resolved and clicked in the same call, so no stale coordinates.'
  },
  {
    task: 'Click something you looked at earlier',
    do: [
      'resolve_row',
      'click'
    ],
    note: 'resolve_row hands back a handle; click with that handle measures the element again at the click, so a row that moved is still the row that gets clicked.'
  },
  {
    task: 'Open a menu and walk into a submenu',
    do: [
      'click_row',
      'wait_for_row',
      'hover',
      'wait_for_row'
    ],
    note: 'Submenus need the pointer to leave and come back. Wait for the row, never for a guessed number of milliseconds.'
  },
  {
    task: 'Do several dependent moves in one call',
    do: ['browser_burst'],
    note: 'Up to eight steps on one tab, in order. The first failure stops the burst and keeps the steps that finished; the page is settled and read once at the end instead of after every move. A refFromStep carries a handle from an earlier resolve into a later click.'
  },
  {
    task: 'Wait for something to arrive or to go',
    do: ['wait_for_row'],
    note: 'Add absent:true to wait for a row to leave. Returns found:false with the page rather than hanging.'
  },
  {
    task: 'Wait until the page has stopped moving',
    do: ['wait_still'],
    note: 'For anything that moves on its own: a menu animating, a save running, an upload landing.'
  },
  {
    task: 'Put a file into a page that has a file input',
    do: [
      'intercept_file_chooser',
      'click_row',
      'upload',
      'intercept_file_chooser'
    ],
    note: 'Enable interception first, click the chooser, call upload with the path or the bytes, then disable it. If upload reports inputFound:false, the site has no input — use the drop below.'
  },
  {
    task: 'Put a file into a page whose chooser has no input',
    do: ['drop_file'],
    note: 'A drop needs no dialog at all: the page takes the file on the drop it already listens for. If the chooser is already open - Google Docs opens it through the File System Access API - answer it with dialog_state, dialog_type and dialog_press, which reach it from the machine.'
  },
  {
    task: 'Take a file out of a page',
    do: [
      'resolve_row',
      'download'
    ],
    note: 'Resolve the control that starts the download, then hand its handle to download with the folder you want. The file landing and stopping growing is the proof; a still-writing file, a viewer that opened instead, and a click that produced nothing each come back downloaded:false with the reason.'
  },
  {
    task: 'Deliver a client statement',
    do: [
      'statement_card',
      'open_url',
      'read_page',
      'find_elements',
      'download',
      'statement_delivered'
    ],
    note: 'One client, one portal, one month. The card names the file and the folder before anything is clicked; the drive gets the file; statement_delivered checks it on disk and adds the client-month to the manifest. Never type a password: if the portal asks to sign in, the person signs in in their own browser and the same tab is used again. The answer is the proof another agent can hand to its own user: bytes, the kind of file sniffed from its bytes, the page count, and the closing balance as the portal printed it with the page named as its source. A balance that was not read is reported missing, never invented.'
  },
  {
    task: 'Ask the page a question instead of guessing',
    do: ['ask_page'],
    note: 'Frames, the node behind a row, a frame document, a selector, a box, a screenshot as png. Reads only — anything that acts stays a named tool.'
  },
  {
    task: 'Build a report from an exported sheet',
    do: ['report_build'],
    note: 'CSV in, a checked report out, written beside the source. No browser is touched: month-end reports must not depend on a tab being open. Every figure names the column and the exact rows it came from, and the plan is rechecked against those rows before the file exists.'
  },
  {
    task: 'Build a paper from JSON tables, images, and graphs',
    do: ['document_build'],
    note: 'JSON in, a checked document plan out, written beside the source. No browser is touched. Every graph names its table and columns, and the graph is recomputed from those rows before the file exists — a graph without a source, or one whose number disagrees with the table, stops the paper instead of reaching a reader.'
  },
  {
    task: 'Prove it worked',
    do: [
      'capture_page',
      'read_page'
    ],
    note: 'A picture and the text, compared against what you expected. A tool saying it succeeded is not proof; the page saying so is.'
  },
  {
    task: 'Bring a window forward',
    do: [
      'browser_status',
      'focus_window'
    ],
    note: 'browser_status names the browser in front and whether it is ours; focus_window takes a piece of the window title. With no match, focus_window answers the state without moving anything — pass a piece of the title to bring one forward. Never an empty match: that used to bring an arbitrary window forward.'
  }
]);

// WHY NO RECIPE FOR "FIND A FILE INPUT" ANYMORE.
// It was here for a day, written while it was the only road, and every step of it was a guess: poll, retry, hope.
// The two roads that replaced it are above, and a recipe that teaches guessing is worse than no recipe.

export const SIDE_EFFECTS = Object.freeze({
  browser_status: [],
  focus_window: ['brings a browser window to the front of the machine, which takes the keyboard away from whatever was in front'],
  dialog_state: [],
  dialog_type: ['writes text into an operating system dialog outside the browser'],
  dialog_press: ['presses a button on an operating system dialog outside the browser'],
  guide: [],
  list_menus: [],
  open_menu: ['opens menus by hovering and clicking levels on the way to the path you gave'],
  list_tabs: [],
  open_url: ['opens a new tab in the same browser'],
  close_tab: ['closes a tab the caller may still be holding'],
  read_page: [
    'with allowCaretMove, borrows the selection on a canvas editor to read the text through it, and answers caretRestored as what was measured rather than what was hoped',
    'without it, that step is skipped and the reason is reported, because a canvas caret is not in the DOM and cannot be promised back'
  ],
  surface_profile: [],
  find_elements: [],
  click: ['moves the pointer and presses'],
  resolve_row: ['leaves the page alone'],
  click_row: ['moves the pointer and presses'],
  hover: ['moves the pointer'],
  press_key: ['sends a key to whatever is focused'],
  type: ['inserts text into whatever is focused'],
  append: ['moves the caret to the end before inserting, so text lands at the end instead of wherever the caret was left'],
  scroll: ['moves the view, which can load more of a lazy page and move the page out from under coordinates you already hold'],
  get_computed: [],
  stream_keys: ['sends a key sequence to whatever is focused'],
  browser_burst: [
    'runs every step in order and stops at the first failure',
    'settles and reads the page once at the end, not after each step'
  ],
  wait_for: [],
  ask_page: [],
  wait_for_row: [],
  wait_still: [],
  caret_line: ['selects the caret line to read it, and answers caretRestored as what was measured rather than what was hoped'],
  upload: ['fills a file input, which fires the change the page listens for'],
  drop_file: ['brings the tab to front and drops a file on it'],
  intercept_file_chooser: ['changes whether the native file picker appears on this tab'],
  download: ['brings the tab to front, clicks, and writes a file into the download folder it names'],
  statement_card: [],
  statement_delivered: ['writes the client-month into the manifest on disk, replacing the record only when asked'],
  report_build: ['writes a checked report file beside the source; no page is touched'],
  document_build: ['writes a checked document file beside the source; no page is touched'],
  document_write: [
    'pastes the paper into the named tab, so the page gains the whole document at the caret',
    'puts the paper on the machine clipboard for the paste, so whatever was copied there is replaced',
    'breaks the pages and makes the table of contents in the page itself, and a contents the page refuses falls back to a pasted list of the headings',
    'with nativeCharts the graph travels through the machine clipboard too, as a chart copied out of a scratch sheet'
  ],
  capture_page: [],
  ax_snapshot: []
});

// WHY THE GUIDE ANSWERS ONE QUESTION AND NOT SEVERAL.
// A caller with a topic gets the roads for that task; a caller with none gets every road and every side effect, which is the whole surface in one read.
// Anything else is a filter that hides something and names nothing.

export function guide(topic) {
  const asked = String(topic ?? '').trim().toLowerCase();
  const recipes = asked
    ? RECIPES.filter((recipe) => `${recipe.task} ${recipe.note}`.toLowerCase().includes(asked))
    : RECIPES;
  return {
    recipes,
    sideEffects: Object.entries(SIDE_EFFECTS).map(([
      tool,
      effects
    ]) => ({
      tool,
      effects
    })),
    refusals: [
      'A native operating-system dialog cannot be opened, closed or filled from here — it is outside the browser.',
      'ask_page refuses anything that could change the page; the list is in its description.',
      'A tool that reports success is not proof. The page saying so is.',
      'A page cannot see whether the window in front of it is the one the machine has in front. Clicks and keys go nowhere while browser_status says the window is not focused.',
      'focus_window with no match answers the state without moving anything — pass a piece of the window title. An empty match used to bring an arbitrary window forward.',
      'A complex document or report is built as a plan on disk (report_build, document_build) before it reaches a page, not by driving cells one by one.'
    ]
  };
}
