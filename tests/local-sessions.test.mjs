// @last-edited: 2026-10-13 UTC+7.
// @title: local-sessions — one cached driver per tab, fronted on switch, tested without a browser.
// @state: 9 locks; adapter shape, cache keys, front-once, close-drop.
// @dependencies: node:test, strict, ../local/sessions.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { asDriver, createSessionStore, findOn } from '../local/sessions.js';

function fakeSession() {
  const calls = [];
  return {
    calls,
    read: async () => { calls.push(['read']); return { url: 'u' }; },
    surfaceProfile: async () => { calls.push(['surfaceProfile']); return { surface: { canvas: true }, strategy: [] }; },
    evaluate: async (expression) => { calls.push(['evaluate', expression]); return []; },
    clickAt: async (x, y) => { calls.push(['clickAt', x, y]); return { x, y }; },
    hover: async (x, y) => { calls.push(['hover', x, y]); return { x, y }; },
    key: async (name, modifiers) => { calls.push(['key', name, modifiers]); return { key: name }; },
    type: async (text) => { calls.push(['type', text]); return { chars: text.length }; },
    keys: async (events) => { calls.push(['keys', events]); return { events: events.length }; },
    settle: async (options) => { calls.push(['settle', options]); return { waitedMs: 1, why: 'quiet' }; },
    waitForText: async (text, options) => { calls.push(['waitForText', text, options]); return { text }; },
    snapshot: async (options) => {
      calls.push(['snapshot', options]);
      return [{ role: 'menuitem', name: 'Insert', x: 1, y: 2 }];
    },
    resolveRow: async ({ role, name }) => {
      calls.push(['resolveRow', role, name]);
      return { role, name: 'Insert', x: 1, y: 2, handle: 'opera-77' };
    },
    clickHandle: async (handle) => {
      calls.push(['clickHandle', handle]);
      return { x: 9, y: 8, handle };
    },
    capture: async () => { calls.push(['capture']); return 'JPG'; },
    front: async () => { calls.push(['front']); return true; },
    close: () => { calls.push(['close']); }
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
  assert.deepEqual(verbs, ['read', 'surfaceProfile', 'clickAt', 'hover', 'key', 'type', 'keys', 'settle', 'waitForText', 'capture', 'front']);
});

// WHY THE ADAPTER RESOLVES THEN CLICKS A HANDLE.
// The row is found and held before anything is pressed, and the click is aimed at that node rather than at the point the snapshot reported — which is the whole difference between clicking the row that was asked for and clicking whatever slid under it.

// WHY THE CLICK'S PROOF IS PINNED HERE.
// The row is what was asked for; what the click hit belongs to the click.
// Measured live: a click_row answered with its row and its point while a dialog owned the point and took the click, and the adapter's rebuilt answer had thrown that fact away before anyone could read it.

test('a deaf page asks the session window, not the operating system shell', async () => {
  const session = fakeSession();
  session.hasFocus = async () => false;
  session.windowState = async () => { session.calls.push(['windowState']); return { foreground: '', windows: [], minimized: [] }; };
  session.focusWindow = async () => { session.calls.push(['focusWindow']); return { focused: true, title: 'x' }; };

  const out = await asDriver(session).ensureFront({ match: 'Paper' });

  assert.ok(session.calls.some((c) => c[0] === 'windowState'), 'the session was asked about the window');
  assert.ok(!session.calls.some((c) => c[0] === 'focusWindow'), 'a background window is left where the human put it');
  assert.match(out.window, /background and hears input anyway/);
});

test('a minimized session window is brought back through the session, not a shell', async () => {
  const session = fakeSession();
  session.hasFocus = async () => false;
  session.windowState = async () => { session.calls.push(['windowState']); return { foreground: '', windows: [], minimized: ['Paper - Google Chrome'] }; };
  session.focusWindow = async (match) => { session.calls.push(['focusWindow', match]); return { focused: true, title: 'Paper - Google Chrome' }; };

  const out = await asDriver(session).ensureFront({ match: 'Paper' });

  assert.deepEqual(session.calls.filter((c) => c[0] === 'focusWindow'), [['focusWindow', 'Paper - Google Chrome']]);
  assert.match(out.window, /brought Paper - Google Chrome back/);
});

test('a row click carries what the click itself reported', async () => {
  const session = fakeSession();
  session.clickHandle = async (handle) => { session.calls.push(['clickHandle', handle]); return { x: 9, y: 8, handle, covered: true, coveredBy: 'div[dialog]' }; };
  const out = await asDriver(session).clickRow('menuitem', 'inse');

  assert.deepEqual(out, { role: 'menuitem', name: 'Insert', x: 9, y: 8, handle: 'opera-77', covered: true, coveredBy: 'div[dialog]' });
  assert.deepEqual(session.calls.slice(-2), [['resolveRow', 'menuitem', 'inse'], ['clickHandle', 'opera-77']]);
  assert.ok(!session.calls.some((c) => c[0] === 'clickAt'), 'no point was clicked');
});

test('a row with no element behind it is clicked at the point it reported', async () => {
  const session = fakeSession();
  session.resolveRow = async ({ role }) => ({ role, name: 'text caret', x: 4, y: 5, handle: null });

  const out = await asDriver(session).clickRow('caret', 'text caret');

  assert.deepEqual(out, { role: 'caret', name: 'text caret', x: 4, y: 5, hit: undefined });
  assert.deepEqual(session.calls.at(-1), ['clickAt', 4, 5], 'the caret is a range, not an element');
});

test('a click with a handle never touches a coordinate', async () => {
  const session = fakeSession();
  const driver = asDriver(session);

  await driver.click(null, null, 'opera-12');

  assert.deepEqual(session.calls.at(-1), ['clickHandle', 'opera-12']);
});

test('a missing row names what is visible instead of clicking blind', async () => {
  const session = fakeSession();
  session.resolveRow = async () => { throw new Error('no menuitem matching "Footnote". Visible: Insert'); };

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

test('findOn is the shared search the entry point reuses', async () => {
  const session = fakeSession();
  await findOn(session, 'Total');

  assert.ok(session.calls.some((c) => c[0] === 'evaluate'));
});

test('each tab gets its own session and keeps it', async () => {
  let opens = 0;
  const store = createSessionStore({ openSession: async () => { opens += 1; return fakeSession(); }, port: 1 });

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
      session.front = async () => { fronts.push(1); return front(); };
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
      session.front = async () => { throw new Error('headless target'); };
      return session;
    },
    port: 1
  });

  const driver = await store.open({ targetId: 'AAA' });

  assert.equal(typeof driver.read, 'function');
});

test('closing drops the cache and the browser tab together', async () => {
  const closed = [];
  let opens = 0;
  const store = createSessionStore({ openSession: async () => { opens += 1; return fakeSession(); }, port: 1 });

  await store.open({ targetId: 'AAA' });
  await store.closeTab('AAA', async (id) => { closed.push(id); return { id, closed: true }; });
  await store.open({ targetId: 'AAA' });

  assert.deepEqual(closed, ['AAA']);
  assert.equal(opens, 2, 'the dropped tab reconnects fresh');
});
