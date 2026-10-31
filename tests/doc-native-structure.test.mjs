// @last-edited: 2026-10-31 UTC+7.
// @title: doc-native-structure — the page break and the table of contents a document makes for itself.
// @state: the menu walk that inserts each of them, and what each says when the page refuses.
// @dependencies: node:test, strict, ../local/doc-native-structure.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  insertPageBreak,
  insertTableOfContents
} from '../local/doc-native-structure.js';

const BAR = [
  'File',
  'Edit',
  'View',
  'Insert',
  'Format',
  'Tools',
  'Extensions',
  'Help',
  'Accessibility'
];

const MENU = {
  bar: BAR,
  insert: [
    'Image i ►',
    'Table t ►',
    'Break k ►',
    'Bookmark b',
    'Page elements Updated p ►',
    'Comment m Ctrl+Alt+M'
  ],
  break: [
    'Break k ►',
    'Page break p Ctrl+Enter',
    'Column break k',
    'Section break (next page) v'
  ],
  elements: [
    'Page elements Updated p ►',
    'Table of contents s ►',
    'Header h Ctrl+Alt+O',
    'Footer f Ctrl+Alt+O',
    'Page numbers g ►'
  ],
  contents: [
    'Table of contents s ►',
    'Row 1. Column 1. Table of contents with black text and page numbers',
    'Row 1. Column 2. Table of contents with a dotted tab leader style'
  ]
};

const noSleep = async () => {};

function fakeDoc({
  counter = '1 of 1',
  lands = true,
  without = []
} = {}) {
  const calls = [];
  const state = {
    open: 'bar',
    counter
  };
  const ids = new Map();
  const boxes = new Map();
  const idOf = (name) => {
    if (ids.has(name)) return ids.get(name);
    const id = ids.size + 1;
    ids.set(name, id);
    const left = id * 100;
    const top = id * 20;
    boxes.set(id, {
      content: [
        left,
        top,
        left + 80,
        top,
        left + 80,
        top + 18,
        left,
        top + 18
      ]
    });
    return id;
  };
  const nameAt = (
    x,
    y
  ) => {
    for (const [
      id,
      box
    ] of boxes.entries()) {
      const xs = box.content.filter((
        _,
        index
      ) => index % 2 === 0);
      const ys = box.content.filter((
        _,
        index
      ) => index % 2 === 1);
      const inside = x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys);
      if (!inside) continue;
      const found = [...ids.entries()].find((
        [
          ,
          value
        ]
      ) => value === id);
      return found ? found[0] : '';
    }
    return '';
  };
  const rowsOf = () => MENU[state.open]
    .filter((name) => !without.includes(name))
    .map((name) => ({
      role: name.startsWith('Row') ? 'gridcell' : 'menuitem',
      name,
      backendDOMNodeId: idOf(name)
    }));

  return {
    calls,
    state,
    front: async () => {
      calls.push({
        what: 'front'
      });
    },
    key: async (name) => {
      calls.push({
        what: 'key',
        name
      });
    },
    evaluate: async (expression) => {
      if (expression.includes('visibilityState')) {
        return {
          visibility: 'visible',
          title: 'Doc - Google Docs'
        };
      }
      return {
        counter: state.counter,
        count: Number(state.counter.split(' ')[0]),
        missing: state.counter.startsWith('0'),
        noBar: false
      };
    },
    hover: async (
      x,
      y
    ) => {
      const name = nameAt(x, y);
      calls.push({
        what: 'hover',
        name
      });
      if (name.startsWith('Break')) state.open = 'break';
      if (name.startsWith('Page elements')) state.open = 'elements';
      if (name.startsWith('Table of contents')) state.open = 'contents';
    },
    clickAt: async (
      x,
      y
    ) => {
      const name = nameAt(x, y);
      calls.push({
        what: 'click',
        name
      });
      if (name === 'Insert') state.open = 'insert';
      const takes = name.startsWith('Page break') || name.includes('black text and page numbers');
      if (lands === true && takes) state.counter = '0 of 0';
    },
    ask: async () => ({
      nodes: rowsOf().map((row) => ({
        role: {
          value: row.role
        },
        name: {
          value: row.name
        },
        backendDOMNodeId: row.backendDOMNodeId
      }))
    }),
    cdp: {
      send: async (
        method,
        params = {}
      ) => {
        if (method === 'DOM.getBoxModel') {
          return {
            model: boxes.get(params.backendNodeId) ?? null
          };
        }
        return null;
      }
    }
  };
}

test('a page break is made by the page: Insert, Break, Page break', async () => {
  const doc = fakeDoc();
  const out = await insertPageBreak({
    doc,
    marker: '[[opera-break-1]]',
    sleep: noSleep
  });
  assert.equal(out.ok, true);
  const clicks = doc.calls
    .filter((call) => call.what === 'click')
    .map((call) => call.name);
  assert.deepEqual(clicks, [
    'Insert',
    'Page break p Ctrl+Enter'
  ]);
  assert.match(out.why, /marker is gone/);
});

test('a table of contents is made by the page: Insert, Page elements, Table of contents, the style with page numbers', async () => {
  const doc = fakeDoc();
  const out = await insertTableOfContents({
    doc,
    marker: '[[opera-toc]]',
    sleep: noSleep
  });
  assert.equal(out.ok, true);
  const hovers = doc.calls
    .filter((call) => call.what === 'hover')
    .map((call) => call.name);
  assert.deepEqual(hovers, [
    'Page elements Updated p ►',
    'Table of contents s ►'
  ]);
  const clicks = doc.calls
    .filter((call) => call.what === 'click')
    .map((call) => call.name);
  assert.deepEqual(clicks, [
    'Insert',
    'Row 1. Column 1. Table of contents with black text and page numbers'
  ]);
});

test('a marker the document does not hold stops the walk before the menu is opened', async () => {
  const doc = fakeDoc({
    counter: '0 of 0'
  });
  const out = await insertPageBreak({
    doc,
    marker: '[[opera-break-1]]',
    sleep: noSleep
  });
  assert.equal(out.ok, false);
  assert.match(out.why, /does not hold the marker/);
  assert.equal(doc.calls.filter((call) => call.what === 'click').length, 0);
});

test('a page that does not take the break says the marker is still there', async () => {
  const doc = fakeDoc({
    lands: false
  });
  const out = await insertPageBreak({
    doc,
    marker: '[[opera-break-1]]',
    sleep: noSleep
  });
  assert.equal(out.ok, false);
  assert.match(out.why, /still holds the marker/);
});

test('a menu that does not offer the command is named in the refusal', async () => {
  const doc = fakeDoc({
    without: [
      'Break k ►'
    ]
  });
  const out = await insertPageBreak({
    doc,
    marker: '[[opera-break-1]]',
    sleep: noSleep
  });
  assert.equal(out.ok, false);
  assert.match(out.why, /Break/);
});
