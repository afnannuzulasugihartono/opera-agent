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
    evaluate: async (expression) => { calls.push(['evaluate', expression]); return []; },
    clickAt: async (x, y) => { calls.push(['clickAt', x, y]); return { x, y }; },
    hover: async (x, y) => { calls.push(['hover', x, y]); return { x, y }; },
    key: async (name, modifiers) => { calls.push(['key', name, modifiers]); return { key: name }; },
    type: async (text) => { calls.push(['type', text]); return { chars: text.length }; },
    keys: async (events) => { calls.push(['keys', events]); return { events: events.length }; },
    snapshot: async (options) => {
      calls.push(['snapshot', options]);
      return [{ role: 'menuitem', name: 'Insert', x: 1, y: 2 }];
    },
    capture: async () => { calls.push(['capture']); return 'JPG'; },
    front: async () => { calls.push(['front']); return true; },
    close: () => { calls.push(['close']); }
  };
}

test('the adapter speaks driver verbs over primitive nouns', async () => {
  const session = fakeSession();
  const driver = asDriver(session);

  await driver.read();
  await driver.click(3, 4);
  await driver.hover(5, 6);
  await driver.key('a', ['Control']);
  await driver.type('hi');
  await driver.keys([{ text: 'x' }]);
  await driver.capture();
  await driver.front();

  const verbs = session.calls.map((c) => c[0]);
  assert.deepEqual(verbs, ['read', 'clickAt', 'hover', 'key', 'type', 'keys', 'capture', 'front']);
});

test('a row click resolves fresh and clicks the center', async () => {
  const session = fakeSession();
  const out = await asDriver(session).clickRow('menuitem', 'inse');

  assert.deepEqual(out, { role: 'menuitem', name: 'Insert', x: 1, y: 2 });
  assert.deepEqual(session.calls.at(-1), ['clickAt', 1, 2]);
});

test('a missing row names what is visible instead of clicking blind', async () => {
  const session = fakeSession();

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
