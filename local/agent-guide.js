// @last-edited: 2026-10-15 UTC+7.
// @title: agent-guide — what an agent can do here, written as tasks instead of a tool list.
// @state: recipes, side effects, honesty locks between them and the tools.
// @dependencies: none.

// WHY THIS FILE EXISTS
//
// An agent arriving cold does not know what to call first. Twenty-three tool
// descriptions answer "what does this do" and never answer "I want to attach a
// file, what do I do" — so an agent reads all of them, in order, every session,
// and picks. Measured on this product's own author: an image upload took a dozen
// calls and a submenu twenty seconds of polling because the road was never
// written down anywhere the agent could read it.
//
// WHY THE RECIPES ARE DATA AND THE CHECKS ARE TESTS. A guide that drifts from
// the product is worse than none: an agent follows a route to a tool that was
// renamed and learns to distrust the guide. So the recipes name tools and the
// test fails the moment a name stops existing, the moment a tool has no
// declared side effect, and the moment a recipe points at a tool that is not on
// the list. Rot is a build failure, not a surprise in production.
//
// WHY SIDE EFFECTS ARE DECLARED AND NOT IMPLIED. Half of what an agent loses
// today is not a missing tool but an unannounced one: reading a Google Doc
// moves the caret, so the next click lands somewhere the agent had already
// visited. A tool that quietly moves something should say so in the tool list,
// where the agent reads before calling, not in a document it reads after being
// surprised.

// WHY THESE RECIPES AND NOT OTHERS. Every line here is a road that was driven,
// with the number it took written down, because an untested road is a guess
// wearing a recipe's clothes.

export const RECIPES = Object.freeze([
  {
    task: 'See what is on the page',
    do: ['read_page'],
    note: 'On a Google Doc this reads the document itself, not the toolbar around it.'
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
    do: ['resolve_row', 'click'],
    note: 'resolve_row hands back a handle; click with that handle measures the element again at the click, so a row that moved is still the row that gets clicked.'
  },
  {
    task: 'Open a menu and walk into a submenu',
    do: ['click_row', 'wait_for_row', 'hover', 'wait_for_row'],
    note: 'Submenus need the pointer to leave and come back. Wait for the row, never for a guessed number of milliseconds.'
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
    do: ['intercept_file_chooser', 'click_row', 'upload', 'intercept_file_chooser'],
    note: 'Enable interception first, click the chooser, call upload with the path or the bytes, then disable it. If upload reports inputFound:false, the site has no input — use the drop below.'
  },
  {
    task: 'Put a file into a page whose chooser has no input',
    do: ['drop_file'],
    note: 'Google Docs opens the operating system dialog through the File System Access API: there is no input to fill and no CDP command that suppresses it. A drop is the road in, and the page takes it on the drop it already listens for.'
  },
  {
    task: 'Ask the page a question instead of guessing',
    do: ['ask_page'],
    note: 'Frames, the node behind a row, a frame document, a selector, a box, a screenshot as png. Reads only — anything that acts stays a named tool.'
  },
  {
    task: 'Prove it worked',
    do: ['capture_page', 'read_page'],
    note: 'A picture and the text, compared against what you expected. A tool saying it succeeded is not proof; the page saying so is.'
  }
]);

// WHY NO RECIPE FOR "FIND A FILE INPUT" ANYMORE. It was here for a day, written
// while it was the only road, and every step of it was a guess: poll, retry,
// hope. The two roads that replaced it are above, and a recipe that teaches
// guessing is worse than no recipe.

export const SIDE_EFFECTS = Object.freeze({
  browser_status: [],
  guide: [],
  list_tabs: [],
  open_url: ['opens a new tab in the same browser'],
  close_tab: ['closes a tab the caller may still be holding'],
  read_page: ['on a Google Doc selects the whole document and leaves the caret at its end'],
  find_elements: [],
  click: ['moves the pointer and presses'],
  resolve_row: ['leaves the page alone'],
  click_row: ['moves the pointer and presses'],
  hover: ['moves the pointer'],
  press_key: ['sends a key to whatever is focused'],
  type: ['inserts text into whatever is focused'],
  stream_keys: ['sends a key sequence to whatever is focused'],
  wait_for: [],
  ask_page: [],
  wait_for_row: [],
  wait_still: [],
  caret_line: ['selects the caret line and leaves the caret at its end'],
  upload: ['fills a file input, which fires the change the page listens for'],
  drop_file: ['brings the tab to front and drops a file on it'],
  intercept_file_chooser: ['changes whether the native file picker appears on this tab'],
  capture_page: [],
  ax_snapshot: []
});

// WHY THE GUIDE ANSWERS ONE QUESTION AND NOT SEVERAL. A caller with a topic
// gets the roads for that task; a caller with none gets every road and every
// side effect, which is the whole surface in one read. Anything else is a filter
// that hides something and names nothing.

export function guide(topic) {
  const asked = String(topic ?? '').trim().toLowerCase();
  const recipes = asked
    ? RECIPES.filter((recipe) => `${recipe.task} ${recipe.note}`.toLowerCase().includes(asked))
    : RECIPES;
  return {
    recipes,
    sideEffects: Object.entries(SIDE_EFFECTS).map(([tool, effects]) => ({ tool, effects })),
    refusals: [
      'A native operating-system dialog cannot be opened, closed or filled from here — it is outside the browser.',
      'ask_page refuses anything that could change the page; the list is in its description.',
      'A tool that reports success is not proof. The page saying so is.'
    ]
  };
}