// @last-edited: 2026-10-31 UTC+7.
// @title: local-operafetch — the OpenCode plugin that turns the opera-local surface into native tools.
// @state: the registrations the plugin makes, the fetch pipeline it runs, and the tab it closes.
// @dependencies: node:test, strict, ../local/tools.js, ../local/bin/opera-opencode.js, ../local/context.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS } from '../local/tools.js';
import {
  createOperaPlugin,
  operaFetch
} from '../local/bin/opera-opencode.js';
import { createLocalContext } from '../local/context.js';

// WHY THE CONTEXT IS FAKED AND NOT BUILT.
// The plugin opens a browser when a tool runs, and a test that did that would drive the machine's real browser.
// The registry is captured instead, so the test reads what the plugin offers without touching a page.

const fakeRegistry = () => {
  const added = [];
  const namespaces = [];
  const allowed = [];
  const ctx = {
    permission: {
      async assert(request) {
        allowed.push(request);
      }
    },
    tool: {
      async transform(callback) {
        callback({
          namespace(namespace) {
            namespaces.push(namespace);
          },
          add(tool) {
            added.push(tool);
          }
        });
        return {
          async dispose() {}
        };
      }
    }
  };
  return {
    added,
    namespaces,
    allowed,
    ctx
  };
};

const registered = async () => {
  const registry = fakeRegistry();
  await createOperaPlugin({
    call: async () => ({
      content: []
    })
  }).setup(registry.ctx);
  return registry;
};

const asJson = (value) => ({
  content: [{
    type: 'text',
    text: JSON.stringify(value)
  }]
});

test('every tool in the table is registered natively, and the fetch sits beside them', async () => {
  const {
    added,
    namespaces
  } = await registered();

  assert.equal(namespaces.length, 1);
  assert.equal(namespaces[0].name, 'opera');
  assert.equal(added.length, TOOLS.length + 1);
  const names = added.map((tool) => tool.name);
  for (const tool of TOOLS) {
    assert.ok(names.includes(tool.name), `${tool.name} is not registered`);
  }
  assert.ok(names.includes('fetch'));
});

test('a registered tool keeps the schema and the description it already had', async () => {
  const {
    added
  } = await registered();
  const page = added.find((tool) => tool.name === 'read_page');
  const source = TOOLS.find((tool) => tool.name === 'read_page');

  assert.equal(page.description, source.description);
  assert.deepEqual(page.input, source.inputSchema);
  assert.equal(page.options.namespace, 'opera');
});

test('the fetch is registered with the url it needs and the text it can wait for', async () => {
  const {
    added
  } = await registered();
  const fetch = added.find((tool) => tool.name === 'fetch');

  assert.deepEqual(fetch.input.required, ['url']);
  assert.ok(fetch.input.properties.url);
  assert.ok(fetch.input.properties.waitFor);
});

test('the fetch opens a tab, settles the page, reads it, and closes the tab', async () => {
  const calls = [];
  const call = async (
    name,
    args
  ) => {
    calls.push([
      name,
      args
    ]);
    if (name === 'open_url') return asJson({
      action: {
        id: '7',
        url: 'https://example.com/'
      }
    });
    if (name === 'read_page') return asJson({
      title: 'Example Domain',
      url: 'https://example.com/',
      text: 'Example Domain'
    });
    return asJson({});
  };

  const out = await operaFetch({
    call,
    url: 'https://example.com/'
  });

  assert.deepEqual(calls.map((call_) => call_[0]), [
    'open_url',
    'wait_still',
    'read_page',
    'close_tab'
  ]);
  assert.equal(calls[0][1].url, 'https://example.com/');
  assert.equal(calls[3][1].tabId, '7');
  assert.equal(out.content[1].text, 'Example Domain');
  assert.match(out.content[0].text, /https:\/\/example\.com\//);
});

// WHY THE PAGE IS READ AGAIN.
// Measured live on Hacker News: a fresh tab held no text and no accessibility rows for its first 200ms, and wait_still answered "settled" after 155ms because two empty reads are identical.
// The wait measures stillness, not readiness, so the fetch reads until the page has something to say.

test('the fetch reads again while the page has nothing to say, and answers with what the page held', async () => {
  const calls = [];
  const call = async (
    name,
    args
  ) => {
    calls.push([
      name,
      args
    ]);
    if (name === 'open_url') return asJson({
      action: {
        id: '7'
      }
    });
    if (name === 'read_page') {
      const reads = calls.filter((entry) => entry[0] === 'read_page').length;
      if (reads === 1) return asJson({
        title: '',
        url: '',
        text: '',
        strategy: 'vision'
      });
      return asJson({
        title: 'Hacker News',
        url: 'https://news.ycombinator.com/',
        text: 'Hacker News'
      });
    }
    return asJson({});
  };

  const out = await operaFetch({
    call,
    url: 'https://news.ycombinator.com/',
    sleep: async () => {}
  });

  assert.equal(calls.filter((entry) => entry[0] === 'read_page').length, 2, 'the empty read was not the answer');
  assert.equal(out.content[1].text, 'Hacker News');
});

test('a page that never gives up its text says so, and leaves no tab behind', async () => {
  const calls = [];
  let at = 0;
  const call = async (
    name,
    args
  ) => {
    calls.push([
      name,
      args
    ]);
    if (name === 'open_url') return asJson({
      action: {
        id: '7'
      }
    });
    if (name === 'read_page') return asJson({
      title: '',
      url: '',
      text: '',
      strategy: 'vision'
    });
    return asJson({});
  };

  await assert.rejects(
    () => operaFetch({
      call,
      url: 'https://example.com/',
      timeoutMs: 600,
      sleep: async (ms) => {
        at += ms;
      },
      now: () => at
    }),
    /no text/
  );
  assert.equal(calls.at(-1)[0], 'close_tab', 'the tab was closed on the way out');
});

test('a page that was still loading when the fetch ended says so', async () => {
  const call = async (name) => {
    if (name === 'open_url') return asJson({
      action: {
        id: '7'
      }
    });
    if (name === 'read_page') return asJson({
      title: 'Hacker News',
      url: 'https://news.ycombinator.com/',
      text: 'Hacker News',
      ready: 'loading'
    });
    return asJson({});
  };
  let at = 0;

  const out = await operaFetch({
    call,
    url: 'https://news.ycombinator.com/',
    timeoutMs: 600,
    sleep: async (ms) => {
      at += ms;
    },
    now: () => at
  });

  assert.equal(out.content[1].text, 'Hacker News');
  assert.match(out.content[0].text, /still loading/);
});

test('a text that was waited for and never came is named, and the tab is still closed', async () => {
  const calls = [];
  const call = async (
    name,
    args
  ) => {
    calls.push([
      name,
      args
    ]);
    if (name === 'open_url') return asJson({
      action: {
        id: '9'
      }
    });
    if (name === 'wait_for') return asJson({
      action: {
        found: false
      }
    });
    return asJson({});
  };

  await assert.rejects(
    () => operaFetch({
      call,
      url: 'https://example.com/',
      waitFor: 'Never there'
    }),
    /Never there/
  );
  assert.deepEqual(calls.map((call_) => call_[0]), [
    'open_url',
    'wait_for',
    'close_tab'
  ]);
});

test('a page that fails to open says so, and leaves no tab behind', async () => {
  const call = async (name) => {
    if (name === 'open_url') throw new Error('refused: the browser is not listening');
    return asJson({});
  };

  await assert.rejects(
    () => operaFetch({
      call,
      url: 'https://example.com/'
    }),
    /the browser is not listening/
  );
});

test('the local context carries the driver the tools drive the browser with', () => {
  const context = createLocalContext();

  assert.equal(typeof context.driver.tabs, 'function');
  assert.equal(typeof context.driver.read, 'function');
  assert.equal(typeof context.open, 'function');
  assert.equal(typeof context.resolveTab, 'function');
});
