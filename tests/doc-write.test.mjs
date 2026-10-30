// @last-edited: 2026-10-30 UTC+7.
// @title: doc-write — the paper carried into a page, and what the page says about it afterwards.
// @state: the write flow against a fake page, with the clipboard replaced so no test touches the machine's.
// @dependencies: node:test, strict, node:fs, node:os, node:path, ../local/doc-write.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeDocumentToPage } from '../local/doc-write.js';

const PAPER = {
  title: 'Satu Sampel Dingin',
  author: 'Opera Agent',
  sections: [
    {
      heading: 'Pengukuran',
      body: 'Semua angka diambil pada tab yang sama.',
      tables: [
        {
          headers: [
            'Panggilan',
            'Latensi ms'
          ],
          rows: [
            [
              'list_tabs',
              '2'
            ],
            [
              'read_page',
              '54'
            ]
          ]
        }
      ],
      graphs: [
        {
          kind: 'bar',
          title: 'Latensi',
          caption: 'Dari tabel.',
          source: {
            table: 0,
            labelColumn: 'Panggilan',
            aggregate: 'sum',
            valueColumn: 'Latensi ms'
          },
          data: [
            {
              label: 'list_tabs',
              value: 2
            },
            {
              label: 'read_page',
              value: 54
            }
          ]
        }
      ],
      images: [
        {
          alt: 'Tangkapan layar',
          caption: 'Tab yang dipakai.',
          src: 'shot.png'
        }
      ]
    }
  ]
};

function fakeSession({
  text = 'Satu Sampel Dingin Pengukuran',
  headingsAfter = 1
} = {}) {
  const calls = [];
  let pastes = 0;
  return {
    calls,
    evaluate: async (expression) => {
      calls.push({
        what: 'evaluate'
      });
      assert.match(expression, /toDataURL/);
      return 'data:image/png;base64,CHART';
    },
    front: async () => {
      calls.push({
        what: 'front'
      });
    },
    viewport: async () => ({
      width: 1536,
      height: 720,
      dpr: 1
    }),
    clickAt: async (
      x,
      y
    ) => {
      calls.push({
        what: 'clickAt',
        x,
        y
      });
    },
    ask: async () => {
      const nodes = [
        {
          role: {
            value: 'Iframe'
          },
          name: {
            value: ''
          }
        }
      ];
      if (pastes >= headingsAfter) {
        nodes.push({
          role: {
            value: 'generic'
          },
          name: {
            value: 'Pengukuran level 2'
          }
        });
      }
      return {
        nodes
      };
    },
    read: async () => ({
      text,
      strategy: 'ax'
    }),
    cdp: {
      send: async (
        method,
        params = {}
      ) => {
        if (Array.isArray(params?.commands) && params.commands.includes('paste')) pastes += 1;
        return null;
      }
    }
  };
}

function fakeClipboard(cdp = null) {
  const calls = [];
  return {
    calls,
    ensureHtml: (
      html,
      marker
    ) => {
      calls.push({
        what: 'ensureHtml',
        html,
        marker
      });
      return {
        held: true,
        rewrote: false
      };
    },
    pasteHtml: async (page) => {
      calls.push({
        what: 'pasteHtml'
      });
      await (page ?? cdp)?.send('Input.dispatchKeyEvent', {
        commands: ['paste']
      });
    }
  };
}

function paperFile({
  paper = PAPER,
  name = 'paper.json'
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-write-'));
  const source = path.join(dir, name);
  fs.writeFileSync(source, JSON.stringify(paper, null, 2));
  fs.writeFileSync(path.join(dir, 'shot.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  return {
    dir,
    source
  };
}

test('the paper is checked, drawn, put on the clipboard and pasted into the page', async () => {
  const { source } = paperFile();
  const session = fakeSession();
  const clipboard = fakeClipboard(session.cdp);
  const result = await writeDocumentToPage({
    source,
    session,
    clipboard,
    settleMs: 60,
    pollMs: 10
  });

  assert.equal(result.verified.ok, true);
  assert.equal(result.pasted.images, 1);
  assert.equal(result.pasted.charts, 1);
  assert.equal(result.pasted.attempts, 1);
  assert.equal(result.landed.ok, true);
  assert.deepEqual(result.landed.found, ['Pengukuran']);
  assert.equal(result.readBack.titleFound, true);
  assert.ok(result.pasted.bytes > 500, 'the paper that was pasted carries the whole plan');

  const written = clipboard.calls.find((call) => call.what === 'ensureHtml');
  assert.ok(written, 'the paper went to the clipboard just before the paste');
  assert.match(written.html, /^<!-- opera-agent-document:/, 'the paper carries a marker the clipboard can be checked against');
  assert.match(written.html, /<h1/);
  assert.match(written.html, /<table/);
  assert.match(written.html, /data:image\/png;base64,CHART/);
  assert.ok(clipboard.calls.some((call) => call.what === 'pasteHtml'), 'the page was asked to paste');

  const click = session.calls.find((call) => call.what === 'clickAt');
  assert.deepEqual({
    x: click.x,
    y: click.y
  }, {
    x: 768,
    y: 360
  }, 'the caret point is the middle of the page, where a fresh editor takes the click');
});

test('a paste that lands nothing is tried again, and the headings the page names are reported', async () => {
  const { source } = paperFile({
    name: 'paper-retry.json'
  });
  const session = fakeSession({
    headingsAfter: 2
  });
  const clipboard = fakeClipboard(session.cdp);
  const result = await writeDocumentToPage({
    source,
    session,
    clipboard,
    settleMs: 60,
    pollMs: 10
  });

  assert.equal(result.pasted.attempts, 2, 'the first paste left no trace, so the paper was pasted again');
  assert.equal(result.landed.ok, true);
  assert.deepEqual(result.landed.found, ['Pengukuran']);
  assert.equal(
    clipboard.calls.filter((call) => call.what === 'ensureHtml').length,
    2,
    'the clipboard is filled just before each paste, because the buffer belongs to the whole machine'
  );
});

test('a graph that disagrees with its table stops the write before anything is pasted', async () => {
  const broken = structuredClone(PAPER);
  broken.sections[0].graphs[0].data[1].value = 280;
  const { source } = paperFile({
    paper: broken,
    name: 'paper-tampered.json'
  });
  const session = fakeSession();
  const clipboard = fakeClipboard(session.cdp);
  await assert.rejects(() => writeDocumentToPage({
    source,
    session,
    clipboard
  }), /does not match its table source/);
  assert.equal(clipboard.calls.length, 0, 'nothing was put on the clipboard');
});

test('an image with no source stops the write', async () => {
  const broken = structuredClone(PAPER);
  delete broken.sections[0].images[0].src;
  const { source } = paperFile({
    paper: broken,
    name: 'paper-nosrc.json'
  });
  const session = fakeSession();
  const clipboard = fakeClipboard(session.cdp);
  await assert.rejects(() => writeDocumentToPage({
    source,
    session: fakeSession(),
    clipboard
  }), /no source file or url/);
  assert.equal(clipboard.calls.length, 0, 'nothing was put on the clipboard');
});

test('the caret point the caller names is the point that is clicked', async () => {
  const { source } = paperFile({
    name: 'paper-at.json'
  });
  const session = fakeSession();
  await writeDocumentToPage({
    source,
    session,
    at: {
      x: 120,
      y: 240
    },
    clipboard: fakeClipboard(session.cdp),
    settleMs: 60,
    pollMs: 10
  });
  const click = session.calls.find((call) => call.what === 'clickAt');
  assert.deepEqual({
    x: click.x,
    y: click.y
  }, {
    x: 120,
    y: 240
  });
});
