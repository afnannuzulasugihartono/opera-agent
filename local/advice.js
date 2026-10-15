// @last-edited: 2026-10-15 UTC+7.
// @title: advice — what to do next when a call could not do what it was asked.
// @state: rules keyed by what went wrong, each with a move that is known to work.
// @dependencies: none.

// WHY THIS FILE EXISTS
//
// A failure that names the problem sends an agent looking for the problem again.
// Measured on this product's own author: "no menuitem matching \"Image\"" said
// exactly what was missing and nothing about what to do, and the next move was
// always the same two or three — open the menu that holds it, read the menu tree,
// wait for it to appear. Those moves are written down here once, so the failure
// carries them and the agent does not have to rediscover them while a menu is
// closing underneath it.
//
// WHY ADVICE IS DATA AND NOT SENTENCES APPENDED TO ERRORS. An error that grows a
// paragraph of advice becomes unreadable, and the advice drifts from what the
// product can actually do. Here a rule matches what went wrong and names the
// call to make; a rule that names a call nobody has is caught by a test, the same
// way the guide's recipes are.
//
// WHY EVERY MOVE IS ONE CALL. An advice line that needed three calls is a plan,
// and a plan inside an error message is read once and forgotten. Each move below
// is a single tool call that answers the question the failure raised.

const MENU_ROLES = ['menuitem', 'menuitemcheckbox', 'menuitemradio'];

const trim = (text, at = 60) => {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > at ? `${one.slice(0, at)}...` : one;
};

// WHY THE NEAREST NAME IS OFFERED WHEN NOTHING MATCHED. The caller asked for one
// thing and the page offers another that starts the same way — "Upload" against
// "Upload from computer". An agent that sees the difference spelled out does not
// have to guess whether its own spelling was wrong or the page's.

const rowAdvice = (role, name, rows) => {
  const wanted = String(name ?? '').toLowerCase();
  const sameRole = rows.filter((row) => row.role === role);
  const begins = sameRole.find((row) => String(row.name ?? '').toLowerCase().startsWith(wanted));
  const looks = [...new Set(sameRole.map((row) => row.name))]
    .filter((text) => wanted && (String(text).toLowerCase().includes(wanted.slice(0, 6)) || wanted.includes(String(text).toLowerCase().slice(0, 6))))
    .slice(0, 3);
  if (begins) return [`the page has "${trim(begins.name)}" — click_row(role: "${role}", name: "${trim(begins.name, 40)}")`];
  if (looks.length) return [`the page has: ${looks.map((text) => `"${trim(text, 34)}"`).join(', ')}`];
  if (MENU_ROLES.includes(role)) {
    return [
      'list_menus() to see what this application can do',
      'open_menu({path: [...]}) to walk into the menu that holds it',
      `wait_for_row({role: "${role}", name: "..."}) if it has not appeared yet`
    ];
  }
  return [`ax_snapshot() to see what is on the page now`];
};

const HANDLE_GONE = [
  'resolve_row() again — the element it named is gone, and the row may now be somewhere else',
  'ax_snapshot() to find the row under its new name or place'
];

const NOT_A_HANDLE = [
  'a handle comes from resolve_row or click_row and looks like "opera-1234"',
  'click({x, y}) for a point, click({handle}) for an element'
];

const BRIDGE_GONE = [
  'the extension has to be connected: reload it in chrome://extensions, then browser_status() to confirm',
  'nothing that touches a page can succeed until this is fixed'
];

const WRONG_PIPE = [
  'this is the debug-port road, not the real profile: start the local driver and reload the extension so the bridge is used'
];

const NO_TARGET = [
  'list_tabs() for the ids that exist now',
  'open_url() if the page is not open yet'
];

const EMPTY_FILE_INPUT = [
  'the page has no file input to fill — drop_file({x, y, filename, path}) instead, which is the road into a picker with no input behind it',
  'capture_page() after the drop to see whether the page took it'
];

// WHY TEXT THAT WENT NOWHERE GETS ITS OWN MOVES. Measured live: five characters were
// typed into a document that had lost its caret, and the call answered with the
// number of characters it had inserted. The next move is always the same two - put a
// caret in the page, then type again - and both are one call each.

const EDIT_GONE = [
  'click({x, y}) where the text should go, then type again \u2014 the page has nothing focused to receive it',
  'caret_line() to see where the caret is, or read_page() to see what the page holds',
  'focus_window({match: \u201cthe tab title\u201d}) if the browser window is minimized, because a page under the taskbar hears nothing'
];

const READ_ONLY = [
  'guide("ask") for the roads to what you were trying to do',
  'anything that changes the page is a named tool, not a question'
];

// WHY THE FIRST RULE THAT FITS WINS. A refusal and a missing row can both be
// true at once — ask_page refusing a method it does not allow is also "no such
// thing" — and a caller is better served by the most specific thing that is
// wrong, which is the first rule in this order.

export const RULES = Object.freeze([
  {
    when: (error) => /ask_page is read-only/.test(error),
    next: READ_ONLY
  },
  {
    when: (error) => /was still in flight when the device disconnected|extension is not connected/.test(error),
    next: BRIDGE_GONE
  },
  {
    when: (error) => /is not reachable: fetch failed/.test(error),
    next: BRIDGE_GONE
  },
  {
    when: (error) => /not reachable: fetch failed|debugging port/.test(error),
    next: WRONG_PIPE
  },
  {
    when: (error) => /No page target/.test(error),
    next: NO_TARGET
  },
  {
    when: (error) => /is not an element handle/.test(error),
    next: NOT_A_HANDLE
  },
  {
    when: (error) => /no longer in the page/.test(error),
    next: HANDLE_GONE
  },
  {
    when: (error) => /inputFound|found no file input/.test(error),
    next: EMPTY_FILE_INPUT
  },
  {
    when: (error) => /nothing on the page changed|holds no text and no field/.test(error),
    next: EDIT_GONE
  },
  {
    when: (error) => /^no \w+ matching/.test(error),
    next: (error, context) => {
      const asked = /^no (\w+) matching "([^"]*)"/.exec(error);
      const role = asked?.[1] ?? 'row';
      const name = asked?.[2] ?? '';
      return rowAdvice(role, name, context?.rows ?? []);
    }
  }
]);

// WHY THE FIRST WORD IS KEPT. "no menuitem matching" says what was looked for and
// what class of thing it was, and an agent that reads only the first line still
// knows whether to look for a menu, a button or a text field.

export function withAdvice(error, context = {}) {
  const text = String(error?.message ?? error ?? '');
  if (!text) return text;
  const rule = RULES.find((entry) => entry.when(text));
  if (!rule) return text;
  const moves = typeof rule.next === 'function' ? rule.next(text, context) : rule.next;
  return `${text}\nNext: ${moves.join('\n      ')}`;
}