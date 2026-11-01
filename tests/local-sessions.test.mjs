// @last-edited: 2026-10-31 UTC+7.
// @title: local-sessions — one cached driver per tab, fronted on switch, tested without a browser.
// @state: 9 locks; adapter shape, cache keys, front-once, close-drop.
// @dependencies: node:test, strict, ../local/sessions.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  asDriver,
  createSessionStore,
  findOn
} from '../local/sessions.js';

function fakeSession() {
  const calls = [];
  return {
    calls,
    read: async () => {
      calls.push(['read']); return { url: 'u' };
    },
    surfaceProfile: async () => {
      calls.push(['surfaceProfile']); return {
        surface: { canvas: true },
        strategy: []
      };
    },
    evaluate: async (expression) => {
      calls.push([
        'evaluate',
        expression
      ]); return [];
    },
    clickAt: async (
      x,
      y
    ) => {
      calls.push([
        'clickAt',
        x,
        y
      ]); return {
        x,
        y
      };
    },
    hover: async (
      x,
      y
    ) => {
      calls.push([
        'hover',
        x,
        y
      ]); return {
        x,
        y
      };
    },
    key: async (
      name,
      modifiers
    ) => {
      calls.push([
        'key',
        name,
        modifiers
      ]); return { key: name };
    },
    type: async (text) => {
      calls.push([
        'type',
        text
      ]); return { chars: text.length };
    },
    keys: async (events) => {
      calls.push([
        'keys',
        events
      ]); return { events: events.length };
    },
    settle: async (options) => {
      calls.push([
        'settle',
        options
      ]); return {
        waitedMs: 1,
        why: 'quiet'
      };
    },
    waitForText: async (
      text,
      options
    ) => {
      calls.push([
        'waitForText',
        text,
        options
      ]); return { text };
    },
    snapshot: async (options) => {
      calls.push([
        'snapshot',
        options
      ]);
      return [{
        role: 'menuitem',
        name: 'Insert',
        x: 1,
        y: 2
      }];
    },
    resolveRow: async ({
      role,
      name
    }) => {
      calls.push([
        'resolveRow',
        role,
        name
      ]);
      return {
        role,
        name: 'Insert',
        x: 1,
        y: 2,
        handle: 'opera-77'
      };
    },
    clickHandle: async (handle) => {
      calls.push([
        'clickHandle',
        handle
      ]);
      return {
        x: 9,
        y: 8,
        handle
      };
    },
    capture: async () => {
      calls.push(['capture']); return 'JPG';
    },
    viewport: async () => {
      calls.push(['viewport']); return {
        width: 100,
        height: 200,
        dpr: 1
      };
    },
    cdp: {
      send: async () => ({})
    },
    front: async () => {
      calls.push(['front']); return true;
    },
    close: () => {
      calls.push(['close']);
    }
  };
}

// WHY surfaceProfile IS DRIVEN HERE.
// The MCP server calls driver.surfaceProfile(), and the driver is this adapter: a primitive that exists but is not spoken here answers a tool call with "not a function" on a real browser, which is exactly what shipped.
// Measured: surface_profile failed against a live Google Doc while every unit test passed, because no test drove the adapter with a profile call.
// So the profile is driven through the adapter like every other verb, and the fake session has to carry the primitive for the call to reach it.

test('the adapter speaks driver verbs over primitive nouns', async () => {
  const session = fakeSession();
  const driver = asDriver(session);

  await driver.read();
  await driver.surfaceProfile();
  await driver.click(3, 4);
  await driver.hover(5, 6);
  await driver.key('a', ['Control']);
  await driver.type('hi');
  await driver.keys([{ text: 'x' }]);
  await driver.settle();
  await driver.waitForText('Total', { timeoutMs: 10 });
  await driver.capture();
  await driver.front();

  const verbs = session.calls.map((c) => c[0]);
  assert.deepEqual(verbs, [
    'read',
    'surfaceProfile',
    'clickAt',
    'hover',
    'key',
    'type',
    'keys',
    'settle',
    'waitForText',
    'capture',
    'front'
  ]);
});

// WHY THE ADAPTER RESOLVES THEN CLICKS A HANDLE.
// The row is found and held before anything is pressed, and the click is aimed at that node rather than at the point the snapshot reported — which is the whole difference between clicking the row that was asked for and clicking whatever slid under it.

// WHY THE CLICK'S PROOF IS PINNED HERE.
// The row is what was asked for; what the click hit belongs to the click.
// Measured live: a click_row answered with its row and its point while a dialog owned the point and took the click, and the adapter's rebuilt answer had thrown that fact away before anyone could read it.

// WHY THE GUARD ASKS THE MACHINE AND NOT THE SESSION.
// The page of a browser that is behind another program still says it has the focus, so the session cannot say whether the screen is the drive's - only the machine can.
// The machine read is injected, so one read is shared by the tab switch, the guard and the window answer.

test('the guard asks the machine what is in front, and takes the screen back through the session', async () => {
  const session = fakeSession();
  let heard = false;
  session.hasFocus = async () => heard;
  session.focusWindow = async (match) => {
    session.calls.push([
      'focusWindow',
      match
    ]); heard = true; return {
      focused: true,
      title: 'Paper - Google Chrome'
    };
  };
  let reads = 0;

  const out = await asDriver(session, {
    ask: async () => ({
      allowed: true,
      answer: 'allow'
    }),
    read: async () => {
      reads += 1;
      return {
        foreground: 'Typecelerate - Brave',
        windows: [],
        minimized: []
      };
    }
  }).ensureFront({ match: 'Paper' });

  assert.equal(reads, 1, 'the machine was asked once');
  assert.ok(session.calls.some((c) => c[0] === 'front'), 'the drive took its tab back to the front');
  assert.ok(session.calls.some((c) => c[0] === 'focusWindow'), 'and its window with it');
  assert.match(out.window, /took the screen back/);
});

test('a minimized session window is brought back through the session, not a shell', async () => {
  const session = fakeSession();
  session.hasFocus = async () => false;
  session.focusWindow = async (match) => {
    session.calls.push([
      'focusWindow',
      match
    ]); return {
      focused: true,
      title: 'Paper - Google Chrome'
    };
  };

  const out = await asDriver(session, {
    read: async () => ({
      foreground: '',
      windows: [],
      minimized: ['Paper - Google Chrome']
    })
  }).ensureFront({ match: 'Paper' });

  assert.deepEqual(session.calls.filter((c) => c[0] === 'focusWindow'), [[
    'focusWindow',
    'Paper - Google Chrome'
  ]]);
  assert.match(out.window, /brought Paper - Google Chrome back/);
});

test('a row click carries what the click itself reported', async () => {
  const session = fakeSession();
  session.clickHandle = async (handle) => {
    session.calls.push([
      'clickHandle',
      handle
    ]); return {
      x: 9,
      y: 8,
      handle,
      covered: true,
      coveredBy: 'div[dialog]'
    };
  };
  const out = await asDriver(session).clickRow('menuitem', 'inse');

  assert.deepEqual(out, {
    role: 'menuitem',
    name: 'Insert',
    x: 9,
    y: 8,
    handle: 'opera-77',
    covered: true,
    coveredBy: 'div[dialog]'
  });
  assert.deepEqual(session.calls.slice(-2), [
    [
      'resolveRow',
      'menuitem',
      'inse'
    ],
    [
      'clickHandle',
      'opera-77'
    ]
  ]);
  assert.ok(!session.calls.some((c) => c[0] === 'clickAt'), 'no point was clicked');
});

test('a row with no element behind it is clicked at the point it reported', async () => {
  const session = fakeSession();
  session.resolveRow = async ({ role }) => ({
    role,
    name: 'text caret',
    x: 4,
    y: 5,
    handle: null
  });

  const out = await asDriver(session).clickRow('caret', 'text caret');

  assert.deepEqual(out, {
    role: 'caret',
    name: 'text caret',
    x: 4,
    y: 5,
    hit: undefined,
    pressed: undefined
  });
  assert.deepEqual(session.calls.at(-1), [
    'clickAt',
    4,
    5
  ], 'the caret is a range, not an element');
});

test('a click with a handle never touches a coordinate', async () => {
  const session = fakeSession();
  const driver = asDriver(session);

  await driver.click(null, null, 'opera-12');

  assert.deepEqual(session.calls.at(-1), [
    'clickHandle',
    'opera-12'
  ]);
});

test('a missing row names what is visible instead of clicking blind', async () => {
  const session = fakeSession();
  session.resolveRow = async () => {
    throw new Error('no menuitem matching "Footnote". Visible: Insert');
  };

  await assert.rejects(
    () => asDriver(session).clickRow('menuitem', 'Footnote'),
    (error) => {
      assert.match(error.message, /no menuitem matching "Footnote"/);
      assert.match(error.message, /Insert/);
      return true;
    }
  );
  assert.ok(!session.calls.some((c) => c[0] === 'clickAt'), 'no click may fire without a resolved row');
});

test('find searches the page the session is attached to', async () => {
  const session = fakeSession();
  await asDriver(session).find('Total');

  const [, expression] = session.calls.find((c) => c[0] === 'evaluate');
  assert.match(expression, /total/);
});

// WHY THE ADAPTER CARRIES THE THREE VERBS A DOCUMENT WRITE NEEDS.
// A document write pastes a paper into a live page: it reads the viewport to place the caret, clicks a point, and hands the page connection to the clipboard.
// Measured live: the write stopped on "session.viewport is not a function" because the adapter spoke only the verbs the other tools used.

test('the adapter carries the verbs a document write needs', async () => {
  const session = fakeSession();
  const driver = asDriver(session);

  assert.deepEqual(await driver.viewport(), {
    width: 100,
    height: 200,
    dpr: 1
  });
  await driver.clickAt(4, 5);

  assert.equal(driver.cdp, session.cdp, 'the page connection is the session own');
  assert.deepEqual(session.calls.slice(-2), [
    [
      'viewport'
    ],
    [
      'clickAt',
      4,
      5
    ]
  ]);
});

test('findOn is the shared search the entry point reuses', async () => {
  const session = fakeSession();
  await findOn(session, 'Total');

  assert.ok(session.calls.some((c) => c[0] === 'evaluate'));
});

test('each tab gets its own session and keeps it', async () => {
  let opens = 0;
  const store = createSessionStore({
    openSession: async () => {
      opens += 1; return fakeSession();
    },
    port: 1
  });

  const a1 = await store.open({ targetId: 'AAA' });
  const a2 = await store.open({ targetId: 'AAA' });
  await store.open({ targetId: 'BBB' });

  assert.equal(opens, 2);
  assert.equal(a1, a2, 'the same tab returns the cached driver');
});

test('the touched tab comes forward once per switch, never per call', async () => {
  const fronts = [];
  const store = createSessionStore({
    openSession: async () => {
      const session = fakeSession();
      const front = session.front;
      session.front = async () => {
        fronts.push(1); return front();
      };
      return session;
    },
    port: 1
  });

  await store.open({ targetId: 'AAA' });
  await store.open({ targetId: 'AAA' });
  await store.open({ targetId: 'BBB' });

  assert.equal(fronts.length, 2, 'AAA once, BBB once, the repeat free');
});

test('a tab that refuses to front still gets driven', async () => {
  const store = createSessionStore({
    openSession: async () => {
      const session = fakeSession();
      session.front = async () => {
        throw new Error('headless target');
      };
      return session;
    },
    port: 1
  });

  const driver = await store.open({ targetId: 'AAA' });

  assert.equal(typeof driver.read, 'function');
});

// WHY AN UNNAMED ATTACH NEVER TAKES THE SCREEN.
// The unnamed session is whatever page the browser lists first, and reading the browser or the page must not move the person off what they are doing.
// The named path keeps the sign that the agent is here; the unnamed path is the one nobody named, so it stays out of the way and the input guard is what takes the screen when input is about to be sent.

test('an unnamed attach never takes the screen from the person', async () => {
  const fronts = [];
  let asked = 0;
  const store = createSessionStore({
    openSession: async () => {
      const session = fakeSession();
      session.front = async () => {
        fronts.push(1);
        return true;
      };
      return session;
    },
    port: 1,
    mayFront: async () => {
      asked += 1;
    }
  });

  await store.attach();

  assert.equal(fronts.length, 0, 'the screen stays where the person put it');
  assert.equal(asked, 0, 'and nobody is asked about a focus that was never taken');
});

test('a named tab is asked about before it comes forward, with the driver in hand', async () => {
  const asked = [];
  const store = createSessionStore({
    openSession: async () => fakeSession(),
    port: 1,
    mayFront: async (options) => {
      asked.push(options);
    }
  });

  await store.open({ targetId: 'AAA' });

  assert.equal(asked.length, 1, 'the person is asked once, about the tab the drive wants');
  assert.equal(asked[0].key, 'AAA');
  assert.equal(typeof asked[0].driver.browser, 'function', 'and the question can name the browser the tab belongs to');
});

test('closing drops the cache and the browser tab together', async () => {
  const closed = [];
  let opens = 0;
  const store = createSessionStore({
    openSession: async () => {
      opens += 1; return fakeSession();
    },
    port: 1
  });

  await store.open({ targetId: 'AAA' });
  await store.closeTab('AAA', async (id) => {
    closed.push(id); return {
      id,
      closed: true
    };
  });
  await store.open({ targetId: 'AAA' });

  assert.deepEqual(closed, ['AAA']);
  assert.equal(opens, 2, 'the dropped tab reconnects fresh');
});

// WHY THE UNNAMED SESSION IS CHECKED AGAINST THE LIVE TABS.
// Measured live: the unnamed session is whatever page the browser listed first when it was made, and when the person closes that tab the cache keeps pointing at a target that no longer exists - every tab-less call then answers "No tab with given id" while the browser has thirty live tabs.
// So the unnamed session is re-taken from the live list when its tab is gone; a named tab keeps its session, because a drive that named a tab means that tab.

test('an unnamed attach follows the browser when its first tab is gone', async () => {
  let live = [
    '111'
  ];
  let opens = 0;
  const store = createSessionStore({
    openSession: async () => {
      opens += 1;
      const session = fakeSession();
      session.targetId = live[0];
      return session;
    },
    resolveTabs: async () => live,
    port: 1
  });

  const first = await store.attach();
  assert.equal(opens, 1);
  assert.equal(await store.attach(), first, 'a live tab keeps its session');
  assert.equal(opens, 1, 'no new session while the tab lives');

  live = [
    '222'
  ];
  const third = await store.attach();

  assert.equal(opens, 2, 'the dead tab is dropped and a live one is taken');
  assert.notEqual(third, first);
});

test('an unnamed attach keeps its session when the tab list cannot answer', async () => {
  let opens = 0;
  const store = createSessionStore({
    openSession: async () => {
      opens += 1;
      const session = fakeSession();
      session.targetId = '111';
      return session;
    },
    resolveTabs: async () => {
      throw new Error('bridge down');
    },
    port: 1
  });

  const first = await store.attach();
  await store.attach();

  assert.equal(opens, 1, 'a failed list does not thrash the session');
  assert.equal(await store.attach(), first);
});
