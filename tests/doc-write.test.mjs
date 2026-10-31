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
      if (expression.includes('visibilityState')) {
        return {
          visibility: 'visible',
          title: 'Doc - Google Docs'
        };
      }
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
  assert.match(written.html, /<h2/, 'the sections of the paper are headings');
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

test('a paper asked for native charts pastes markers and puts a real chart where each marker stood', async () => {
  const { source } = paperFile({
    name: 'paper-native.json'
  });
  const session = fakeSession();
  const clipboard = fakeClipboard(session.cdp);
  const built = [];
  const placed = [];
  const result = await writeDocumentToPage({
    source,
    session,
    clipboard,
    nativeCharts: true,
    openSheet: async () => ({}),
    native: {
      build: async ({
        block
      }) => {
        built.push(block.title);
        return {
          copied: true
        };
      },
      place: async ({
        marker
      }) => {
        placed.push(marker);
        return {
          ok: true,
          charts: 1,
          why: 'the page names it'
        };
      },
      pasteOver: async () => ({
        pasted: true
      }),
      trash: async () => ({
        trashed: true,
        why: 'the page says so'
      })
    },
    settleMs: 60,
    pollMs: 10
  });

  assert.deepEqual(built, [
    'Latensi'
  ]);
  assert.deepEqual(placed, [
    '[[opera-chart-1]]'
  ]);
  const written = clipboard.calls.find((call) => call.what === 'ensureHtml');
  assert.match(written.html, /\[\[opera-chart-1\]\]/, 'the paper carries the marker where the chart belongs');
  assert.ok(!written.html.includes('data:image/png;base64,CHART'), 'the chart is not pasted as a picture');
  assert.equal(result.native.charts[0].kind, 'native');
  assert.equal(result.native.charts[0].ok, true);
  assert.equal(result.native.sheet.trashed, true);
});

test('a document whose accessibility tree is cold still gets its charts, because the page finds its own marker', async () => {
  const { source } = paperFile({
    name: 'paper-native-cold.json'
  });
  const session = fakeSession({
    headingsAfter: 99
  });
  const clipboard = fakeClipboard(session.cdp);
  const placed = [];
  const result = await writeDocumentToPage({
    source,
    session,
    clipboard,
    nativeCharts: true,
    openSheet: async () => ({}),
    native: {
      build: async () => ({
        copied: true
      }),
      place: async ({
        marker
      }) => {
        placed.push(marker);
        return {
          ok: true,
          charts: 1,
          why: 'the page names it'
        };
      },
      pasteOver: async () => ({
        pasted: true
      }),
      trash: async () => ({
        trashed: true,
        why: 'the page says so'
      })
    },
    settleMs: 60,
    pollMs: 10
  });

  assert.equal(result.landed.ok, false, 'the page names no heading, and the report says so');
  assert.deepEqual(placed, [
    '[[opera-chart-1]]'
  ], 'the chart was placed anyway, because the marker is found in the page itself');
  assert.equal(result.native.charts[0].kind, 'native');
});

test('a graph that cannot be made native falls back to the picture, and the result says so', async () => {
  const { source } = paperFile({
    name: 'paper-native-fallback.json'
  });
  const session = fakeSession();
  const clipboard = fakeClipboard(session.cdp);
  const pasted = [];
  const result = await writeDocumentToPage({
    source,
    session,
    clipboard,
    nativeCharts: true,
    openSheet: async () => ({}),
    native: {
      build: async () => {
        throw new Error('the sheet did not answer');
      },
      place: async () => ({
        ok: false,
        why: 'never reached'
      }),
      pasteOver: async ({
        html
      }) => {
        pasted.push(html);
        return {
          pasted: true
        };
      },
      trash: async () => ({
        trashed: true,
        why: 'the page says so'
      })
    },
    settleMs: 60,
    pollMs: 10
  });

  assert.equal(result.native.charts[0].kind, 'picture');
  assert.equal(result.native.charts[0].ok, true);
  assert.match(result.native.charts[0].why, /sheet did not answer/);
  assert.match(pasted[0], /data:image\/png;base64,CHART/, 'the picture stands in for the chart that could not be made');
});

test('native charts without a sheet to build them in are refused before anything is pasted', async () => {
  const { source } = paperFile({
    name: 'paper-native-nosheet.json'
  });
  const session = fakeSession();
  const clipboard = fakeClipboard(session.cdp);
  await assert.rejects(() => writeDocumentToPage({
    source,
    session,
    clipboard,
    nativeCharts: true
  }), /sheet/);
  assert.equal(clipboard.calls.length, 0, 'nothing was put on the clipboard');
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

const COMPLETE_PAPER = {
  title: 'Paper Lengkap',
  author: 'Opera Agent',
  cover: {
    subtitle: 'Membaca kanvas',
    affiliation: 'Laboratorium Opera',
    date: '31 Oktober 2026',
    abstract: 'Ringkasan satu paragraf.',
    keywords: [
      'accessibility tree'
    ]
  },
  toc: true,
  sections: [
    {
      heading: 'Pengantar',
      body: 'Isi pengantar.',
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
            }
          ]
        }
      ]
    }
  ],
  references: [
    'Opera Agent. 2026. Paper lengkap.'
  ]
};

function fakeStructure({
  order = [],
  contents = {
    ok: true,
    why: 'the page made it'
  }
} = {}) {
  const breaks = [];
  const made = [];
  const pasted = [];
  return {
    breaks,
    made,
    pasted,
    calls: {
      pageBreak: async ({
        marker
      }) => {
        order.push(`break:${marker}`);
        breaks.push(marker);
        return {
          ok: true,
          why: 'the page broke the page'
        };
      },
      tableOfContents: async ({
        marker
      }) => {
        order.push(`contents:${marker}`);
        made.push(marker);
        return contents;
      },
      pasteOver: async ({
        html
      }) => {
        order.push('contents:list');
        pasted.push(html);
        return {
          pasted: true
        };
      }
    }
  };
}

test('a complete paper breaks its pages, charts its graphs, and ends with a table of contents the page made', async () => {
  const { source } = paperFile({
    paper: COMPLETE_PAPER,
    name: 'paper-complete.json'
  });
  const session = fakeSession();
  const clipboard = fakeClipboard(session.cdp);
  const order = [];
  const structure = fakeStructure({
    order
  });
  const result = await writeDocumentToPage({
    source,
    session,
    clipboard,
    nativeCharts: true,
    openSheet: async () => ({}),
    native: {
      build: async () => ({
        copied: true
      }),
      place: async () => {
        order.push('chart');
        return {
          ok: true,
          charts: 1,
          why: 'the page names it'
        };
      },
      pasteOver: async () => ({
        pasted: true
      }),
      trash: async () => ({
        trashed: true,
        why: 'the page says so'
      })
    },
    structure: structure.calls,
    settleMs: 60,
    pollMs: 10
  });

  assert.deepEqual(structure.breaks, [
    '[[opera-break-1]]',
    '[[opera-break-2]]'
  ]);
  assert.deepEqual(structure.made, [
    '[[opera-toc]]'
  ]);
  assert.deepEqual(order, [
    'break:[[opera-break-1]]',
    'break:[[opera-break-2]]',
    'chart',
    'contents:[[opera-toc]]'
  ], 'the breaks come first, the charts before the contents, so the numbers in the contents are the numbers of the finished paper');
  assert.equal(result.structure.toc.kind, 'native');
  assert.equal(result.structure.toc.ok, true);
});

test('a table of contents the page will not make falls back to the list of headings', async () => {
  const { source } = paperFile({
    paper: COMPLETE_PAPER,
    name: 'paper-complete-fallback.json'
  });
  const session = fakeSession();
  const clipboard = fakeClipboard(session.cdp);
  const structure = fakeStructure({
    contents: {
      ok: false,
      why: 'the page does not offer it'
    }
  });
  const result = await writeDocumentToPage({
    source,
    session,
    clipboard,
    structure: structure.calls,
    settleMs: 60,
    pollMs: 10
  });

  assert.equal(result.structure.toc.kind, 'list');
  assert.equal(result.structure.toc.ok, true);
  assert.match(structure.pasted[0], /Pengantar/);
  assert.match(structure.pasted[0], /Referensi/);
});

test('a paper with no cover and no contents asks the page for nothing', async () => {
  const { source } = paperFile({
    name: 'paper-plain.json'
  });
  const session = fakeSession();
  const clipboard = fakeClipboard(session.cdp);
  const structure = fakeStructure();
  const result = await writeDocumentToPage({
    source,
    session,
    clipboard,
    structure: structure.calls,
    settleMs: 60,
    pollMs: 10
  });

  assert.deepEqual(structure.breaks, []);
  assert.deepEqual(structure.made, []);
  assert.equal(result.structure.toc, null);
});
