// @last-edited: 2026-10-27 UTC+7.
// @title: local-canvas — a surface that is not a page full of text, read through the ladder with the caret-moving step gated.
// @state: the ladder walk on a canvas surface, the gate in front of the borrow, and the caret line read.
// @dependencies: node:test, strict, ../local/primitives.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SETTLE_POLL_MS } from '../local/page-expressions.js';
import { createPrimitives } from '../local/primitives.js';
import { createCanvasMethods } from '../local/canvas.js';
import { DOC_URL } from './helpers/local-page.mjs';

// A canvas surface: no text in the DOM, a canvas over most of the viewport, an editable host, and the page has focus.

const CANVAS_PROBE = {
  textInDom: {
    value: false,
    evidence: 0
  },
  canvas: {
    value: true,
    evidence: 0.61
  },
  editable: {
    value: true,
    evidence: 'true'
  },
  focused: {
    value: true,
    evidence: 'document.hasFocus() is true'
  }
};

// A rich accessibility tree whose document frame carries the text.

const RICH_AX = [
  'PROPOSAL PENAWARAN',
  'Kepada Yth.',
  'Tim Pengembangan Lokasi',
  'PT Indomarco Prismatama',
  'Perihal penawaran lokasi',
  '1. Identitas Pengusul',
  '2. Latar Belakang',
  '3. Rincian Penawaran',
  '4. Nilai Investasi',
  '5. Jadwal'
];

const POOR_AX = ['Share'];

// Ten toolbar labels: rich enough to clear the text-box bar, and none of them the document.
// This is what a canvas document answers before it has built its accessibility tree.

const CHROME_AX = [
  '100%',
  '100%',
  'Heading 1',
  'Heading 1',
  'Arial',
  'Arial',
  '11',
  '11',
  'Bold',
  'Italic'
];

const axTree = (texts) => {
  const nodes = [
    {
      nodeId: 'root',
      parentId: undefined,
      childIds: [
        'chromeRoot',
        'docRoot'
      ],
      role: { value: 'RootWebArea' },
      name: { value: '' }
    },
    {
      nodeId: 'chromeRoot',
      parentId: 'root',
      childIds: [],
      role: { value: 'toolbar' },
      name: { value: '' }
    },
    {
      nodeId: 'docRoot',
      parentId: 'root',
      childIds: [],
      role: { value: 'generic' },
      name: { value: '' }
    }
  ];
  texts.forEach((
    text,
    i
  ) => nodes.push({
    nodeId: `doc${i}`,
    parentId: 'docRoot',
    childIds: [],
    role: { value: 'InlineTextBox' },
    name: { value: text }
  }));
  return { nodes };
};


// WHY THE FAKE ANSWERS ONE SELECTION SHAPE.
// The copy, the caret mark and the caret verdict all read the same page expression now, so a fake that answers them with different shapes would be testing a page that no longer exists.
// One answer per fake therefore carries both the text and the caret position, which is what the real page returns.

const CANVAS_CARET = {
  frame: 0,
  hostPath: '0/3/2:1',
  rangeCount: 1,
  collapsed: true,
  anchorOffset: 0,
  text: '',
  hostTextLength: 0
};

const canvasCdp = ({
  probe = CANVAS_PROBE,
  ax = RICH_AX,
  copy = null,
  caret = CANVAS_CARET,
  domText = '',
  line = null,
  noCaret = false
} = {}) => {
  const calls = [];
  return {
    calls,
    setAx(next) {
      ax = next;
    },
    send: async (
      method,
      params = {}
    ) => {
      calls.push({
        method,
        params
      });
      const expression = String(params.expression ?? '');
      if (method === 'Runtime.evaluate' && expression.includes('window.innerHeight')) {
        return { result: { value: probe } };
      }
      if (method === 'Accessibility.getFullAXTree') return axTree(ax);

      // A page that can name the line the caret is on answers the caret read in one go, and only a page that cannot falls through to the selection.

      if (method === 'Runtime.evaluate' && expression.includes('opera-settle-probe')) {
        return { result: { value: {
          changes: 0,
          quietMs: 40,
          elapsedMs: 40,
          visibility: 'visible'
        } } };
      }
      if (method === 'Runtime.evaluate' && expression.includes('opera-caret-line')) {
        if (noCaret) {
          return { result: { value: {
            found: false,
            noCaret: true,
            why: 'the page holds no caret to read a line from'
          } } };
        }
        if (line === null) {
          return { result: { value: {
            found: false,
            why: 'the block around the caret holds more than one line'
          } } };
        }
        return { result: { value: {
          found: true,
          line,
          why: 'the line came from the page, so the caret did not move'
        } } };
      }

      // The one selection state: the text the copy reads and the caret position the guard measures, from the same frame.

      if (method === 'Runtime.evaluate' && expression.includes('richest')) {
        return { result: { value: {
          ...caret,
          text: typeof copy === 'string' ? copy : ''
        } } };
      }
      if (method === 'Runtime.evaluate' && expression.includes('innerText')) {
        return { result: { value: {
          title: 'Doc',
          url: DOC_URL,
          text: domText
        } } };
      }
      return { result: { value: null } };
    }
  };
};

test('a canvas surface is read through the accessibility tree and the caret is not touched', async () => {
  const cdp = canvasCdp({ ax: RICH_AX });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read();

  assert.equal(out.strategy, 'ax');
  assert.equal(out.harm, 'none');
  assert.equal(out.caretMoved, false, 'the accessibility read moves nothing');
  assert.ok(out.text.includes('PROPOSAL PENAWARAN'));
  assert.ok(!out.text.includes('Share'), 'chrome text stays in its own frame');
  assert.equal(cdp.calls.some((c) => c.method === 'Input.dispatchKeyEvent'), false,
    'no key is pressed on a surface that answered without one');
});

test('a cold sample cannot answer for the session: every read measures the tree again', async () => {
  const cdp = canvasCdp({ ax: CHROME_AX });
  const primitives = createPrimitives(cdp, { sleep: async () => {} });

  const cold = await primitives.read();
  assert.equal(cold.strategy, 'ax');
  assert.ok(cold.text.includes('Heading 1'), 'a cold tree answers with the toolbar');

  cdp.setAx(RICH_AX);
  const warm = await primitives.read();
  assert.equal(warm.strategy, 'ax');
  assert.ok(warm.text.includes('PROPOSAL PENAWARAN'), 'the second read sees the document the tree grew');
  assert.ok(!warm.text.includes('Heading 1'), 'the toolbar text does not survive into the second read');
  assert.equal(
    cdp.calls.filter((call) => call.method === 'Accessibility.getFullAXTree').length,
    2,
    'one tree measurement per read, and never one for the session'
  );
});

test('a caret-moving read is refused without consent and the refusal is named', async () => {
  const cdp = canvasCdp({ ax: POOR_AX });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read({ allowCaretMove: false });

  const skipped = out.skipped.find((entry) => entry.harm === 'caret-move');
  assert.ok(skipped, 'the borrow is reported as skipped');
  assert.match(skipped.why, /consent/i);
  assert.equal(cdp.calls.some((c) => c.method === 'Input.dispatchKeyEvent'), false,
    'the selection is never borrowed when the gate refuses');
});

test('a caret-moving read with consent borrows, copies, and reports the verdict honestly', async () => {
  const cdp = canvasCdp({
    ax: POOR_AX,
    copy: 'First line\nSecond line'
  });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read({ allowCaretMove: true });

  assert.equal(out.strategy, 'select-all');
  assert.equal(out.harm, 'caret-move');
  assert.equal(out.text, 'First line\nSecond line');
  assert.equal(out.caretMoved, true, 'the read does move the caret, and says so');
  assert.equal(out.caretRestored, false, 'and the verdict never claims a restore it did not measure');
  assert.equal(out.caret.restored, false);
  const keys = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.deepEqual(keys.map((k) => [
    k.params.key,
    k.params.modifiers ?? 0
  ]),
    [
      [
        'a',
        2
      ],
      [
        'a',
        2
      ],
      [
        'End',
        0
      ],
      [
        'End',
        0
      ]
    ], 'select-all on both edges, then the collapse on both');
});

test('a canvas surface no read can answer names the picture instead of returning nothing', async () => {
  const bare = {
    textInDom: {
      value: false,
      evidence: 0
    },
    canvas: {
      value: true,
      evidence: 0.4
    },
    editable: {
      value: false,
      evidence: 'no editable host'
    },
    focused: {
      value: false,
      evidence: 'document.hasFocus() is false'
    }
  };
  const cdp = canvasCdp({
    probe: bare,
    ax: POOR_AX,
    copy: null
  });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read();

  assert.equal(out.strategy, 'vision');
  assert.match(out.visionWhy, /capture_page/);
  assert.equal(out.text, '');
});

// WHY A CANVAS WITHOUT AN EDITOR STILL READS THE DOM.
// The veto used to cover every canvas page, so a chart, a map or a viewer beside a canvas came back with no text at all - the one text the page has is the text around the picture.
// Measured on a real page while writing this: the same fake, with the editable host removed, returned an empty string before and the page's own words after.

test('a canvas page with no editor reads the text around the picture', async () => {
  const probe = {
    textInDom: {
      value: true,
      evidence: 38
    },
    canvas: {
      value: true,
      evidence: 0.4
    },
    editable: {
      value: false,
      evidence: 'no editable host'
    },
    focused: {
      value: false,
      evidence: 'document.hasFocus() is false'
    }
  };
  const cdp = canvasCdp({
    probe,
    ax: POOR_AX,
    domText: 'The legend sits under the chart.'
  });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read();

  assert.equal(out.strategy, 'dom');
  assert.equal(out.text, 'The legend sits under the chart.');
  assert.equal(out.skipped.length, 0, 'nothing is vetoed on a page whose text is its own');
});

// WHY AN ORDINARY PAGE NEVER PAYS FOR THE TREE.
// Measured on the owner's profile: one innerText answers a DOM page in a single call, and a full accessibility tree costs 19-30ms on top of it.
// The tree can reorder the ladder only where a canvas leads with it, so on any other page it is measured only if the DOM answered nothing.

test('a DOM page is read without paying for an accessibility tree', async () => {
  const domProbe = {
    textInDom: {
      value: true,
      evidence: 4200
    },
    canvas: {
      value: false,
      evidence: 0
    },
    editable: {
      value: false,
      evidence: 'no editable host'
    },
    focused: {
      value: false,
      evidence: 'document.hasFocus() is false'
    }
  };
  const cdp = canvasCdp({
    probe: domProbe,
    ax: [],
    domText: 'A page that already holds its own words.'
  });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read();

  assert.equal(out.text, 'A page that already holds its own words.');
  assert.equal(cdp.calls.some((call) => call.method === 'Accessibility.getFullAXTree'), false,
    'the tree is not measured when the DOM already answered');
});

test('a page whose DOM is empty is read from the tree it left behind', async () => {
  const domProbe = {
    textInDom: {
      value: false,
      evidence: 0
    },
    canvas: {
      value: false,
      evidence: 0
    },
    editable: {
      value: false,
      evidence: 'no editable host'
    },
    focused: {
      value: false,
      evidence: 'document.hasFocus() is false'
    }
  };
  const cdp = canvasCdp({
    probe: domProbe,
    ax: [
      'A late dialog',
      'with two rows'
    ],
    domText: ''
  });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read();

  assert.equal(out.strategy, 'ax');
  assert.equal(out.text, 'A late dialogwith two rows', 'the tree holds the text the DOM has not filled yet');
});

test('the accessibility answer carries the page it stands on', async () => {
  const cdp = canvasCdp({ ax: RICH_AX });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read();

  assert.equal(out.strategy, 'ax');
  assert.equal(out.title, 'Doc', 'a read that answers with no title looks like a read that failed');
  assert.equal(out.url, DOC_URL);
  assert.equal(out.settled, null, 'one sample of a tree cannot say the text stopped moving');
  assert.match(out.settledWhy, /wait_still/, 'and the answer names what can');
});

// WHY AN EMPTY COPY IS NOT AN EMPTY DOCUMENT.
// A canvas editor that selects and copies nothing either has an empty document or a mirror that did not fill, and the two are not the same thing.
// Reporting the empty string as the read would call both of them an empty page.

test('a consent that borrows nothing does not come back as an empty document', async () => {
  const cdp = canvasCdp({
    ax: POOR_AX,
    copy: null
  });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read({ allowCaretMove: true });

  assert.equal(out.strategy, 'vision');
  assert.equal(out.text, '');
  assert.equal(out.caretMoved, true, 'the borrow happened, and the answer says so');
  assert.equal(out.caretRestored, false, 'and the verdict it measured');
  const skipped = out.skipped.find((entry) => entry.strategy === 'select-all');
  assert.match(skipped.why, /no text/i, 'the ladder says why it moved on');
});

test('a page that holds its own text is read through the DOM and nothing is gated', async () => {
  const domProbe = {
    textInDom: {
      value: true,
      evidence: 4200
    },
    canvas: {
      value: false,
      evidence: 0
    },
    editable: {
      value: false,
      evidence: 'no editable host'
    },
    focused: {
      value: false,
      evidence: 'document.hasFocus() is false'
    }
  };
  const cdp = canvasCdp({
    probe: domProbe,
    ax: [],
    domText: 'A page that already holds its own words.'
  });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).read();

  assert.equal(out.strategy, 'dom');
  assert.equal(out.harm, 'none');
  assert.equal(out.text, 'A page that already holds its own words.');
  assert.equal(out.skipped.length, 0);
});

test('createCanvasMethods exposes read and caretLine', () => {
  const methods = createCanvasMethods({
    cdp: { send: async () => ({}) },
    primitives: {
      evaluate: async () => null,
      ask: async () => ({ nodes: [] }),
      key: async () => ({}),
      settle: async () => ({})
    },
    readState: async () => ({
      url: 'https://example.com',
      title: '',
      text: ''
    })
  });

  assert.deepEqual(Object.keys(methods).sort(), [
    'caretLine',
    'read'
  ]);
});

// WHY THE CHEAP ROAD IS THE ONE THAT SHIPS.
// Measured live over the extension bridge: the key road cost 187 ms and moved the caret the caller was reading from, while a page that can name its line costs one read and moves nothing.
// The key road stays for the surface that keeps its text as pixels, so this test holds the cheap road to its two promises: the line, and no key at all.

test('a caret line the page can name costs one read and moves nothing', async () => {
  const cdp = canvasCdp({
    line: 'Kajian pustaka mencakup'
  });
  const p = createPrimitives(cdp, { sleep: async () => {} });

  const out = await p.caretLine();

  assert.equal(out.line, 'Kajian pustaka mencakup');
  assert.equal(out.caretMoved, false);
  assert.equal(out.caretRestored, true);
  assert.equal(out.viewRestored, true);
  assert.equal(cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent').length, 0,
    'no key was pressed to read a line the page already knew');
  assert.equal(cdp.calls.filter((c) => String(c.params?.expression ?? '').includes('opera-caret-line')).length, 1,
    'one read answers it');
});


// WHY A PAGE WITH NO CARET GETS AN EMPTY ANSWER AND NO KEYS.
// The key road creates a selection to read, so on a page with no caret it would move one that was never there and answer with whatever the first key touched.
// Measured live over the extension bridge: that road cost 138 ms and scrolled the page to its end on the way.

test('a page with no caret has no line, and no key is pressed to invent one', async () => {
  const cdp = canvasCdp({
    noCaret: true
  });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).caretLine();

  assert.equal(out.line, '');
  assert.equal(out.caretMoved, false);
  assert.match(out.caretWhy, /no caret/);
  assert.equal(cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent').length, 0,
    'nothing was pressed on a page with no caret');
});


test('a caret line reads the selection, collapses, and reports its verdict', async () => {
  const cdp = canvasCdp({ copy: 'Kajian pustaka mencakup' });
  const slept = [];
  const out = await createPrimitives(cdp, { sleep: async (ms) => {
    slept.push(ms);
  } }).caretLine();

  assert.equal(out.line, 'Kajian pustaka mencakup');
  assert.equal(out.caretMoved, true);
  assert.equal(out.caretRestored, false, 'the verdict is what was measured, not what was hoped');
  const keys = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.deepEqual(keys.map((k) => [
    k.params.key,
    k.params.modifiers ?? 0
  ]),
    [
      [
        'Home',
        0
      ],
      [
        'Home',
        0
      ],
      [
        'End',
        8
      ],
      [
        'End',
        8
      ],
      [
        'End',
        0
      ],
      [
        'End',
        0
      ]
    ],
    'home, shift-end, then the collapse, each on both edges');
  assert.equal(
    cdp.calls.filter((c) => String(c.params?.expression ?? '').includes('opera-settle-probe')).length,
    2,
    'a settle after each selection move, and each is one question to the watcher the page keeps'
  );
});

test('an unreadable line is empty, and the caret still collapses', async () => {
  const cdp = canvasCdp({ copy: null });
  const out = await createPrimitives(cdp, { sleep: async () => {} }).caretLine();

  assert.equal(out.line, '');
  const keys = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.equal(keys.at(-1).params.key, 'End', 'the collapse is not skipped on failure');
  assert.equal(keys.at(-1).params.modifiers, 0);
});
