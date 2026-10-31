// @last-edited: 2026-10-31 UTC+7.
// @title: doc-native-chart — the chart a sheet builds, the dialog that releases it, and the page that says it landed.
// @state: the sheet steps, the dialog probe, and the paste that carries a chart into a document.
// @dependencies: node:test, strict, ../local/doc-native-chart.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNativeChart,
  chartTsv,
  pasteOverMarker,
  placeNativeChart,
  trashSheet
} from '../local/doc-native-chart.js';

const GRAPH = {
  kind: 'graph',
  chartKind: 'bar',
  title: 'Latensi',
  caption: 'Dari tabel.',
  source: {
    table: 0,
    labelColumn: 'Panggilan',
    valueColumn: 'Latensi ms',
    aggregate: 'sum'
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
};

const RADIO = {
  x: 616,
  y: 401
};
const PASTE = {
  x: 902,
  y: 469
};
const CANCEL = {
  x: 810,
  y: 469
};
const CHART = {
  x: 347,
  y: 404
};

const noSleep = async () => {};

function fakeSheet() {
  const calls = [];
  return {
    calls,
    front: async () => {
      calls.push({
        what: 'front'
      });
    },
    read: async () => ({
      text: 'This spreadsheet has been trashed'
    }),
    evaluate: async (expression) => {
      calls.push({
        what: 'evaluate'
      });
      if (expression.includes('getBoundingClientRect')) return CHART;
      if (expression.includes('gvizchart')) return true;
      if (expression.includes('chart-type-select')) return true;
      if (expression.includes('range:')) return {
        range: 'A1:B3'
      };
      if (expression.includes('visibilityState')) return {
        visibility: 'visible',
        title: 'Untitled spreadsheet - Google Sheets'
      };
      return {
        ready: true,
        url: 'https://docs.google.com/spreadsheets/d/1'
      };
    },
    key: async (
      name,
      mods = []
    ) => {
      calls.push({
        what: 'key',
        name,
        mods
      });
    },
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
    openMenu: async (options) => {
      calls.push({
        what: 'openMenu',
        path: options.path,
        clickLeaf: options.clickLeaf
      });
      return {
        action: {
          opened: true
        }
      };
    },
    cdp: {
      send: async (
        method,
        params = {}
      ) => {
        calls.push({
          what: 'cdp',
          method,
          paste: Array.isArray(params?.commands) && params.commands.includes('paste')
        });
        return null;
      }
    }
  };
}

function fakeDoc({
  dialog = true,
  title = 'Paste chart',
  charts = 1,
  namesChart = true,
  markerGone = false
} = {}) {
  const calls = [];
  let radioClicked = false;
  let pasteClicked = false;
  return {
    calls,
    front: async () => {
      calls.push({
        what: 'front'
      });
    },
    key: async (
      name,
      mods = []
    ) => {
      calls.push({
        what: 'key',
        name,
        mods
      });
    },
    clickAt: async (
      x,
      y
    ) => {
      calls.push({
        what: 'clickAt',
        x,
        y
      });
      if (x === RADIO.x && y === RADIO.y) radioClicked = true;
      if (x === PASTE.x && y === PASTE.y) pasteClicked = true;
    },
    evaluate: async (expression) => {
      calls.push({
        what: 'evaluate'
      });
      if (expression.includes('visibilityState')) return {
        visibility: 'visible',
        title: 'Doc - Google Docs'
      };
      if (expression.includes('FindInputCounter')) {
        const gone = markerGone === true && pasteClicked;
        return {
          counter: gone ? '0 of 0' : '1 of 1',
          count: gone ? 0 : 1,
          missing: gone,
          noBar: false
        };
      }
      if (dialog) {
        return {
          title,
          radio: RADIO,
          radioChecked: radioClicked,
          paste: PASTE,
          cancel: CANCEL,
          isChartDialog: title === 'Paste chart'
        };
      }
      return {
        title: '',
        radio: null,
        radioChecked: false,
        paste: null,
        cancel: null,
        isChartDialog: false
      };
    },
    ask: async () => ({
      nodes: Array.from({
        length: radioClicked && pasteClicked && namesChart ? charts : 0
      }, () => ({
        role: {
          value: 'StaticText'
        },
        name: {
          value: 'Inserted chart'
        }
      }))
    }),
    cdp: {
      send: async (
        method,
        params = {}
      ) => {
        calls.push({
          what: 'cdp',
          method,
          paste: Array.isArray(params?.commands) && params.commands.includes('paste')
        });
        return null;
      }
    }
  };
}

test('the chart data travels as a sheet wants it: one header and tab separated rows', () => {
  const tsv = chartTsv(GRAPH);
  assert.equal(tsv, 'Panggilan\tLatensi ms\r\nlist_tabs\t2\r\nread_page\t54');
});

test('a graph that counts rows names its columns plainly', () => {
  const tsv = chartTsv({
    source: {
      labelColumn: 'Panggilan',
      aggregate: 'count'
    },
    data: [
      {
        label: 'list_tabs',
        value: 3
      }
    ]
  });
  assert.equal(tsv, 'Panggilan\tValue\r\nlist_tabs\t3');
});

test('a graph with no data is refused before a sheet is opened', () => {
  assert.throws(() => chartTsv({
    data: []
  }), /no data/);
});

test('the sheet fills, charts and copies, in that order', async () => {
  const sheet = fakeSheet();
  const written = [];
  const out = await buildNativeChart({
    sheet,
    block: GRAPH,
    clipboard: {
      writeText: (text) => {
        written.push(text);
        return {
          bytes: text.length
        };
      },
      readChartClip: () => 'chart'
    },
    sleep: noSleep
  });

  assert.equal(out.copied, true);
  assert.deepEqual(written, [
    'Panggilan\tLatensi ms\r\nlist_tabs\t2\r\nread_page\t54'
  ]);
  const order = sheet.calls
    .filter((call) => call.what !== 'cdp' || call.paste)
    .filter((call) => call.what !== 'evaluate')
    .map((call) => call.what === 'openMenu' ? `menu:${call.path.join('>')}` : call.what === 'key' ? `key:${call.name}` : call.what === 'clickAt' ? 'click:chart' : call.what === 'cdp' ? 'paste' : call.what);
  assert.deepEqual(order, [
    'front',
    'key:Escape',
    'key:Home',
    'key:v',
    'menu:Insert>Chart',
    'key:Escape',
    'click:chart',
    'key:c'
  ], 'the cursor goes home first, the data lands, the chart is made from it, the chart is picked, and the chart is copied last');
  assert.equal(sheet.calls.filter((call) => call.what === 'evaluate').length, 6, 'the sheet was asked whether it was ready, whether it was in sight, whether the data landed, whether it had drawn the chart, and where the chart is');
  assert.deepEqual(sheet.calls.find((call) => call.what === 'key' && call.name === 'Home').mods, [
    'Control'
  ]);
  assert.deepEqual(sheet.calls.find((call) => call.what === 'key' && call.name === 'v').mods, [
    'Control'
  ]);
  assert.deepEqual(sheet.calls.find((call) => call.what === 'key' && call.name === 'c').mods, [
    'Control'
  ]);
});

test('a sheet that never shows its grid is refused, so the chart can fall back to a picture', async () => {
  const sheet = fakeSheet();
  sheet.evaluate = async () => ({
    ready: false
  });
  await assert.rejects(() => buildNativeChart({
    sheet,
    block: GRAPH,
    clipboard: {
      writeText: () => ({
        bytes: 0
      })
    },
    sleep: noSleep,
    timeoutMs: 20,
    intervalMs: 5
  }), /grid/);
});

test('a sheet that never takes the data is refused, so the chart can fall back to a picture', async () => {
  const sheet = fakeSheet();
  sheet.evaluate = async (expression) => {
    if (expression.includes('range:')) return {
      range: 'A1'
    };
    if (expression.includes('gvizchart')) return true;
    if (expression.includes('visibilityState')) return {
      visibility: 'visible',
      title: 'Untitled spreadsheet - Google Sheets'
    };
    return {
      ready: true,
      url: 'https://docs.google.com/spreadsheets/d/1'
    };
  };
  await assert.rejects(() => buildNativeChart({
    sheet,
    block: GRAPH,
    clipboard: {
      writeText: () => ({
        bytes: 0
      })
    },
    sleep: noSleep,
    attempts: 2
  }), /never took the data/);
});

test('a clipboard that cannot be read leaves the copy unjudged, and the chart is handed over', async () => {
  const sheet = fakeSheet();
  const out = await buildNativeChart({
    sheet,
    block: GRAPH,
    clipboard: {
      writeText: () => ({
        bytes: 0
      })
    },
    sleep: noSleep
  });

  assert.equal(out.copied, true, 'the document is the one that can say the chart did not land');
});

test('a sheet that copies the cells instead of the chart is refused, so the chart can fall back to a picture', async () => {
  const sheet = fakeSheet();
  await assert.rejects(() => buildNativeChart({
    sheet,
    block: GRAPH,
    clipboard: {
      writeText: () => ({
        bytes: 0
      }),
      readChartClip: () => 'range'
    },
    sleep: noSleep
  }), /would not put it on the clipboard \(the buffer holds "range"\)/);
});

test('a sheet that stays out of sight is refused, because the clipboard cannot reach it', async () => {
  const sheet = fakeSheet();
  sheet.evaluate = async (expression) => {
    if (expression.includes('visibilityState')) return {
      visibility: 'hidden',
      title: ''
    };
    if (expression.includes('range:')) return {
      range: 'A1:B3'
    };
    if (expression.includes('gvizchart')) return true;
    return {
      ready: true,
      url: 'https://docs.google.com/spreadsheets/d/1'
    };
  };
  await assert.rejects(() => buildNativeChart({
    sheet,
    block: GRAPH,
    clipboard: {
      writeText: () => ({
        bytes: 0
      })
    },
    sleep: noSleep
  }), /out of sight/);
});

test('the document finds the marker, pastes the chart and answers the dialog with an unlinked chart', async () => {
  const doc = fakeDoc();
  const out = await placeNativeChart({
    doc,
    marker: '[[opera-chart-1]]',
    clipboard: {
      readChartClip: () => 'chart'
    },
    sleep: noSleep
  });

  assert.equal(out.ok, true);
  assert.equal(out.charts, 1);
  const keys = doc.calls.filter((call) => call.what === 'key').map((call) => `${call.name}${call.mods.length ? `+${
    call.mods.join('')
  }` : ''}`);
  assert.deepEqual(keys, [
    'f+Control',
    'Enter',
    'Escape'
  ], 'the marker is found and left selected before the chart is pasted over it');
  assert.ok(doc.calls.some((call) => call.what === 'cdp' && call.paste), 'the chart was pasted');
  assert.ok(doc.calls.some((call) => call.what === 'clickAt' && call.x === RADIO.x), 'the unlinked radio was chosen');
  assert.ok(doc.calls.some((call) => call.what === 'clickAt' && call.x === PASTE.x), 'the dialog was answered');
});

test('a cold accessibility tree does not hide a chart that landed, because the marker is gone', async () => {
  const doc = fakeDoc({
    namesChart: false,
    markerGone: true
  });
  const out = await placeNativeChart({
    doc,
    marker: '[[opera-chart-1]]',
    clipboard: {
      readChartClip: () => 'chart'
    },
    sleep: noSleep,
    timeoutMs: 20,
    intervalMs: 5
  });

  assert.equal(out.ok, true, 'the chart took the marker\'s place, so it landed even though the tree is cold');
  assert.equal(out.markerGone, true);
  assert.match(out.why, /took the marker/);
});

test('a clipboard that holds the cells instead of the chart is refused before the document is touched', async () => {
  const doc = fakeDoc();
  const out = await placeNativeChart({
    doc,
    marker: '[[opera-chart-1]]',
    clipboard: {
      readChartClip: () => 'range'
    },
    sleep: noSleep
  });

  assert.equal(out.ok, false);
  assert.match(out.why, /holds "range" instead of the chart/);
  assert.ok(!doc.calls.some((call) => call.what === 'cdp' && call.paste), 'nothing was pasted, so the marker is still there for the picture');
});

test('a dialog that offers a table instead of a chart is cancelled, so the marker is kept', async () => {
  const doc = fakeDoc({
    title: 'Paste table'
  });
  const out = await placeNativeChart({
    doc,
    marker: '[[opera-chart-1]]',
    clipboard: {
      readChartClip: () => 'chart'
    },
    sleep: noSleep
  });

  assert.equal(out.ok, false);
  assert.match(out.why, /offered "Paste table" instead of a chart/);
  assert.ok(doc.calls.some((call) => call.what === 'clickAt' && call.x === CANCEL.x), 'the dialog was cancelled');
  assert.ok(!doc.calls.some((call) => call.what === 'clickAt' && call.x === PASTE.x), 'the table was not pasted');
});

test('a document that never asks how to paste the chart says so instead of claiming it landed', async () => {
  const doc = fakeDoc({
    dialog: false
  });
  const out = await placeNativeChart({
    doc,
    marker: '[[opera-chart-1]]',
    clipboard: {
      readChartClip: () => 'chart'
    },
    sleep: noSleep,
    timeoutMs: 30,
    intervalMs: 10
  });

  assert.equal(out.ok, false);
  assert.match(out.why, /did not ask/);
});

test('a picture stands in for a chart that could not be made, pasted over the same marker', async () => {
  const doc = fakeDoc();
  const written = [];
  const out = await pasteOverMarker({
    doc,
    marker: '[[opera-chart-1]]',
    html: '<figure><img src="data:image/png;base64,CHART"></figure>',
    clipboard: {
      ensureHtml: (
        html,
        marker
      ) => {
        written.push([
          html,
          marker
        ]);
        return {
          held: true,
          rewrote: false
        };
      },
      pasteHtml: async (cdp) => {
        await cdp.send('Input.dispatchKeyEvent', {
          commands: [
            'paste'
          ]
        });
      }
    },
    sleep: noSleep
  });

  assert.equal(out.pasted, true);
  assert.deepEqual(written, [
    [
      '<figure><img src="data:image/png;base64,CHART"></figure>',
      '[[opera-chart-1]]'
    ]
  ]);
  assert.ok(doc.calls.some((call) => call.what === 'cdp' && call.paste), 'the picture was pasted over the marker');
});

test('the scratch sheet is thrown away through its own File menu', async () => {
  const sheet = fakeSheet();
  const out = await trashSheet({
    sheet,
    sleep: noSleep
  });

  assert.equal(out.trashed, true);
  const menu = sheet.calls.find((call) => call.what === 'openMenu');
  assert.deepEqual(menu.path, [
    'File',
    'Move to trash'
  ]);
  assert.equal(menu.clickLeaf, true);
});
