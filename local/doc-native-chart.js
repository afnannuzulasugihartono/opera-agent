// @last-edited: 2026-10-31 UTC+7.
// @title: doc-native-chart — a chart the page itself draws: built in a scratch sheet, released by a dialog, carried into a document as a chart.
// @state: the sheet that builds it, the dialog that releases it, and the page that says it landed.
// @dependencies: ./clipboard.js, ./doc-native-page.js.

// WHY THE CHART IS BUILT IN A SHEET AND NOT DRAWN ON THE PAGE.
// Measured live on a real Google Doc: a pasted <svg> arrives as the three text labels inside it, and an <img> holding an SVG data URI arrives as a broken image.
// A picture is what a page can carry, and a picture is not a chart: it cannot be edited and it holds no data.
// The only chart a document accepts is one Google made, and Google makes those in a sheet.
// So the chart is built there, copied as a chart, and pasted as a chart.

// WHY THE DIALOG IS ANSWERED BY CLICKING WHAT IT SHOWS.
// Measured live: pasting a copied chart into a document opens a "Paste chart" dialog with two answers, "Link to spreadsheet" and "Paste unlinked", and the default is the one that ties the chart to a scratch file that is about to be thrown away.
// So the unlinked radio is clicked, the choice is read back from the radio itself, and only then is the dialog answered.

// WHY THE PAGE IS ASKED WHETHER THE CHART LANDED.
// Measured live: the document names an inserted chart in its own accessibility tree, so a chart the page names is a chart that landed.

import {
  pasteHtml,
  readChartClip,
  writeText
} from './clipboard.js';
import {
  ensureVisible,
  selectMarker
} from './doc-native-page.js';

// WHY THE DIALOG IS READ BY WHAT IT SAYS.
// Measured live on a real Doc: the paste dialog puts its two answers in radio buttons, and each radio sits in a row whose text names the answer.
// Measured live on the same Doc: a pasted range opens the very same dialog under the title "Paste table", so the title is what says whether this is a chart.
// So the unlinked radio is the one whose row says "unlinked", the dialog is only a chart dialog when it says "Paste chart", and the choice is read back from the radio itself.

const DIALOG_PROBE = `(() => {
  const dialogs = [...document.querySelectorAll('div, section')].filter((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 120) return false;
    const text = String(el.innerText || '');
    return /Paste (chart|table)/i.test(text) && /Link to spreadsheet/i.test(text);
  }).map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      el,
      area: rect.width * rect.height
    };
  }).sort((a, b) => a.area - b.area);
  const dialog = dialogs[0]?.el ?? null;
  const title = dialog ? (String(dialog.innerText || '').match(/Paste (chart|table)/i) || [''])[0] : '';
  const labelOf = (input) => {
    let el = input.parentElement;
    for (let depth = 0; depth < 6 && el; depth += 1) {
      const text = String(el.innerText || '').replace(/\\s+/g, ' ').trim();
      if (text.length > 3) return text;
      el = el.parentElement;
    }
    return '';
  };
  const radios = dialog
    ? [...dialog.querySelectorAll('input[type="radio"]')].map((input) => ({
      input,
      label: labelOf(input)
    }))
    : [];
  const unlinked = radios.find((entry) => /unlinked/i.test(entry.label));
  const linked = radios.find((entry) => /link to spreadsheet/i.test(entry.label));
  const radio = unlinked?.input ?? null;
  const button = dialog
    ? [...dialog.querySelectorAll('button')].find((el) => String(el.innerText || '').trim() === 'Paste')
    : null;
  const cancel = dialog
    ? [...dialog.querySelectorAll('button')].find((el) => String(el.innerText || '').trim() === 'Cancel')
    : null;
  const point = (rect) => (rect ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) } : null);
  return {
    title,
    radio: point(radio ? radio.getBoundingClientRect() : null),
    radioChecked: radio ? radio.checked === true : false,
    paste: point(button ? button.getBoundingClientRect() : null),
    cancel: point(cancel ? cancel.getBoundingClientRect() : null),
    isChartDialog: /^Paste chart$/i.test(title) && Boolean(unlinked && linked)
  };
})()`;

// WHY THE SHEET IS WAITED FOR BY ITS NAME BOX.
// Measured live: a fresh sheet answers with an empty page first, and the grid only exists once the name box and the cell input are on it.
// So the sheet is ready when the name box is there and the page has become a spreadsheet, and a paste sent before that lands nowhere.

const SHEET_READY_PROBE = `(() => ({
  ready: Boolean(document.querySelector('input.waffle-name-box') && document.querySelector('.cell-input')),
  focused: document.hasFocus(),
  url: String(location.href)
}))()`;

// WHY THE PASTE IS READ BACK FROM THE NAME BOX.
// Measured live: the name box holds the range the paste selected, so a paste that landed reads "A1:B4" and a paste that landed nowhere still reads "A1".
// So the data is only taken as landed when the box names a range that starts at A1, and a paste that did not land is tried again.

const NAME_BOX_PROBE = `(() => ({
  range: String(document.querySelector('input.waffle-name-box')?.value || '').trim()
}))()`;

// WHY THE CHART IS LOOKED FOR IN THE SHEET.
// Measured live: a chart the sheet made sits in the grid as a chart object, and a chart that was never made leaves the grid as it was.
// So the chart is only copied when the sheet holds one.

const SHEET_CHART_PROBE = `(() => Boolean(document.querySelector('.waffle-objwrap-gvizchart')))()`;

// WHY THE CHART EDITOR IS WAITED FOR.
// Measured live: the chart object appears in the grid before the sheet has finished drawing it, and a copy taken in between copies the cell under the cursor instead of the chart.
// The editor panel is the sheet's own sign that the chart is drawn and selected, so the copy waits for it.

const SHEET_CHART_EDITOR_PROBE = `(() => Boolean(document.querySelector('.docs-charts-editor-chart-type-select')))()`;

const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForChart({
  sheet,
  sleep,
  timeoutMs,
  intervalMs
}) {
  const started = Date.now();
  for (;;) {
    const editor = await sheet.evaluate(SHEET_CHART_EDITOR_PROBE).catch(() => false);
    const chart = await sheet.evaluate(SHEET_CHART_PROBE).catch(() => false);
    if (chart === true && editor === true) {
      return {
        ready: true,
        waitedMs: Date.now() - started
      };
    }
    if (Date.now() - started >= timeoutMs) {
      return {
        ready: chart === true,
        waitedMs: Date.now() - started,
        why: editor === true
          ? 'the sheet drew no chart'
          : 'the sheet never finished drawing the chart'
      };
    }
    await sleep(intervalMs);
  }
}

async function waitForSheet({
  sheet,
  sleep,
  timeoutMs,
  intervalMs
}) {
  const started = Date.now();
  for (;;) {
    const state = await sheet.evaluate(SHEET_READY_PROBE).catch(() => null);
    if (state?.ready === true && String(state?.url ?? '').includes('/spreadsheets/d/')) {
      return {
        ready: true,
        waitedMs: Date.now() - started
      };
    }
    if (Date.now() - started >= timeoutMs) {
      return {
        ready: false,
        waitedMs: Date.now() - started,
        why: 'the sheet grid never appeared'
      };
    }
    await sleep(intervalMs);
  }
}

// WHY THE DATA IS PASTED AT A1 AND READ BACK.
// Measured live: the grid takes the paste where the cell cursor is, and a chart left selected moves that cursor away from the first cell.
// So the chart object is dropped, the cursor is sent home, the data is pasted, and the name box is read to see whether the paste landed at all.

// WHY THE SHEET IS PASTED WITH THE KEY AND NOT ONLY WITH THE BROWSER'S PASTE COMMAND.
// Measured live on the same machine: the paste command landed the data once and pasted nothing the next time, while the Ctrl+V key press landed it every time.
// So the key goes first and the command is the second way in, and the name box decides which one worked.

function landedRange(
  range
) {
  return String(range ?? '').startsWith('A1') && String(range ?? '') !== 'A1';
}

async function pasteChartData({
  sheet,
  tsv,
  clipboard,
  sleep,
  settleMs,
  attempts
}) {
  let range = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await sheet.key('Escape');
    await sleep(300);
    await sheet.key('Home', [
      'Control'
    ]);
    await sleep(500);
    clipboard.writeText(tsv);
    await sleep(300);
    await sheet.key('v', [
      'Control'
    ]);
    await sleep(settleMs);
    const read = await sheet.evaluate(NAME_BOX_PROBE).catch(() => null);
    range = String(read?.range ?? '');
    if (landedRange(range)) {
      return {
        landed: true,
        range,
        attempts: attempt
      };
    }
    await pasteHtml(sheet.cdp);
    await sleep(settleMs);
    const again = await sheet.evaluate(NAME_BOX_PROBE).catch(() => null);
    range = String(again?.range ?? '');
    if (landedRange(range)) {
      return {
        landed: true,
        range,
        attempts: attempt
      };
    }
  }
  return {
    landed: false,
    range,
    attempts
  };
}

async function chartCount(doc) {
  const tree = await doc.ask('Accessibility.getFullAXTree', {
    maxDepth: 60
  }).catch(() => null);
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  return nodes.filter((node) => String(node?.name?.value ?? '').includes('Inserted chart')).length;
}

/**
 * Turns a graph block into the tab separated text a spreadsheet reads as rows and columns.
 * @param {object} block - a graph block of a built document, carrying its label column, value column and data.
 * @returns {string} the sheet's text, one header line and one line per point.
 */

export function chartTsv(block) {
  const data = Array.isArray(block?.data) ? block.data : [];
  if (!data.length) {
    throw new Error('a chart with no data cannot be built in a sheet.');
  }
  const labelColumn = String(block?.source?.labelColumn ?? block?.labelColumn ?? '').trim() || 'Label';
  const valueColumn = String(block?.source?.valueColumn ?? block?.valueColumn ?? '').trim() || 'Value';
  const rows = data.map((point) => `${String(point?.label ?? '').trim()}\t${Number(point?.value)}`);
  return [
    `${labelColumn}\t${valueColumn}`,
    ...rows
  ].join('\r\n');
}

// WHY THE DATA LANDS AT A1 EVERY TIME.
// Measured live: the grid takes the paste where the cell cursor is, and a chart left selected moves that cursor away from the first cell.
// So the chart object is dropped and the cursor is sent home before the data is pasted.

/**
 * Builds one chart in a sheet and leaves it on the clipboard: the data is pasted, the sheet charts it, and the chart is copied as a chart.
 * @param {object} args - the build inputs.
 * @param {object} args.sheet - the sheet session to drive.
 * @param {object} args.block - the graph block whose data the chart shows.
 * @param {object} [args.clipboard] - the text writer to use, replaced in tests.
 * @param {Function} [args.sleep] - the wait between two steps, replaced in tests.
 * @param {number} [args.settleMs] - how long the sheet is given to take the pasted data.
 * @param {number} [args.chartMs] - how long the sheet is given to draw the chart.
 * @param {number} [args.timeoutMs] - how long the sheet is given to show its grid.
 * @param {number} [args.intervalMs] - the gap between two asks of the sheet.
 * @param {number} [args.attempts] - how many times the data is pasted before the chart is given up on.
 * @returns {Promise<{copied: boolean, tsv: string, range: string, clip: string}>} that the chart was copied, the text it was built from, the range it landed in, and what the buffer held.
 */

export async function buildNativeChart({
  sheet,
  block,
  clipboard = {
    writeText,
    readChartClip
  },
  sleep = sleepDefault,
  settleMs = 2500,
  chartMs = 6000,
  timeoutMs = 30000,
  intervalMs = 500,
  attempts = 3
} = {}) {
  if (!sheet) {
    throw new Error('a native chart needs a sheet to be built in.');
  }
  const tsv = chartTsv(block);
  await sheet.front();
  const ready = await waitForSheet({
    sheet,
    sleep,
    timeoutMs,
    intervalMs
  });
  if (ready.ready !== true) {
    throw new Error('the scratch sheet never showed its grid, so no chart could be built in it.');
  }
  const shown = await ensureVisible(
    sheet,
    sleep
  );
  if (shown.visible !== true) {
    throw new Error(`the scratch sheet stayed out of sight (${shown.why || 'the window would not come forward'}), so the clipboard could not reach it.`);
  }
  const data = await pasteChartData({
    sheet,
    tsv,
    clipboard,
    sleep,
    settleMs,
    attempts
  });
  if (data.landed !== true) {
    throw new Error(`the scratch sheet never took the data (the name box reads "${data.range}"), so no chart could be built from it.`);
  }
  await sheet.openMenu({
    path: [
      'Insert',
      'Chart'
    ],
    clickLeaf: true,
    limit: 200
  });
  await sleep(chartMs);
  const drawn = await waitForChart({
    sheet,
    sleep,
    timeoutMs,
    intervalMs
  });
  if (drawn.ready !== true) {
    throw new Error(`the sheet took the data but made no chart from it (${drawn.why}).`);
  }
  const copy = await copyChart({
    sheet,
    clipboard,
    sleep
  });
  if (copy.copied !== true) {
    throw new Error(`the sheet made a chart but would not put it on the clipboard (the buffer holds "${copy.clip}"), so the document had nothing native to take.`);
  }
  return {
    copied: true,
    tsv,
    range: data.range,
    clip: copy.clip
  };
}

// WHY THE CHART IS PICKED BEFORE IT IS COPIED.
// Measured live on a real sheet: the copy takes whatever the sheet has selected, and Escape after the chart is drawn leaves the cells behind it selected.
// So Escape alone copied the cells - the document then asked "Paste table" and put a plain grid on the page.
// The chart is picked with a click first, and the buffer is asked whether it holds a chart, because only the chart travels as a chart.

const CHART_POINT_PROBE = `(() => {
  const chart = document.querySelector('.waffle-objwrap-gvizchart');
  const rect = chart?.getBoundingClientRect();
  return rect
    ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
    : null;
})()`;

async function copyChart({
  sheet,
  clipboard,
  sleep
}) {
  let clip = 'unknown';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await sheet.key('Escape');
    await sleep(1000);
    const point = await sheet.evaluate(CHART_POINT_PROBE).catch(() => null);
    if (point?.x && point?.y) {
      await sheet.clickAt(point.x, point.y);
      await sleep(1200);
    }
    await sheet.key('c', [
      'Control'
    ]);
    await sleep(1400);
    clip = clipboard.readChartClip?.() ?? 'unknown';
    if (clip === 'chart') {
      return {
        copied: true,
        clip,
        attempts: attempt
      };
    }
    if (clip === 'unknown') {
      return {
        copied: true,
        clip,
        attempts: attempt
      };
    }
  }
  return {
    copied: false,
    clip,
    attempts: 3
  };
}

/**
 * Carries a copied chart into a document: the marker is found and left selected, the chart is pasted over it, and the paste dialog is answered with an unlinked chart.
 * @param {object} args - the placement inputs.
 * @param {object} args.doc - the document session to paste into.
 * @param {string} args.marker - the text that stands where the chart belongs.
 * @param {Function} [args.sleep] - the wait between two steps, replaced in tests.
 * @param {number} [args.timeoutMs] - how long the page is given to answer.
 * @param {number} [args.intervalMs] - the gap between two asks of the page.
 * @returns {Promise<{ok: boolean, charts: number, why: string}>} whether the page names an inserted chart, and why.
 */

export async function placeNativeChart({
  doc,
  marker,
  clipboard = {
    readChartClip
  },
  sleep = sleepDefault,
  timeoutMs = 15000,
  intervalMs = 500
} = {}) {
  if (!doc) {
    throw new Error('a native chart needs a document to be placed in.');
  }
  const before = await chartCount(doc);
  const found = await selectMarker({
    doc,
    marker,
    sleep
  });
  if (found?.noBar === true) {
    return {
      ok: false,
      charts: before,
      why: 'the document did not open its find bar, so the marker could not be found'
    };
  }
  if (found?.missing === true) {
    return {
      ok: false,
      charts: before,
      why: `the document does not hold the marker "${marker}" (the find bar reads "${found.counter}"), so the chart had nowhere to go`
    };
  }
  if (found?.visible === false) {
    return {
      ok: false,
      charts: before,
      why: `the document stayed out of sight (${found.focusWhy || 'the window would not come forward'}), so the clipboard could not reach it`
    };
  }

  // WHY THE BUFFER IS CHECKED BEFORE THE PASTE.
  // Measured live on a real Doc: a pasted range opens a "Paste table" dialog and lands a plain grid, and the marker it took is gone for good.
  // So the buffer is asked what it holds, and anything but a chart is refused here, while the marker is still there for the picture to take.

  const clip = clipboard.readChartClip?.() ?? 'unknown';
  if (clip !== 'chart' && clip !== 'unknown') {
    return {
      ok: false,
      charts: before,
      why: `the clipboard holds "${clip}" instead of the chart, so the document was left alone`
    };
  }
  await pasteHtml(doc.cdp);
  const started = Date.now();
  let dialog = null;
  for (;;) {
    dialog = await doc.evaluate(DIALOG_PROBE).catch(() => null);
    if (dialog?.title) break;
    if (Date.now() - started >= timeoutMs) {
      return {
        ok: false,
        charts: before,
        why: 'the document did not ask how to paste the chart, so nothing was placed'
      };
    }
    await sleep(intervalMs);
  }
  if (dialog.isChartDialog !== true) {
    if (dialog.cancel) {
      await doc.clickAt(dialog.cancel.x, dialog.cancel.y);
      await sleep(700);
    }
    return {
      ok: false,
      charts: before,
      why: `the document offered "${dialog.title || 'no dialog'}" instead of a chart, so the paste was cancelled and the marker kept`
    };
  }
  await doc.clickAt(dialog.radio.x, dialog.radio.y);
  await sleep(700);
  const chosen = await doc.evaluate(DIALOG_PROBE).catch(() => null);
  if (chosen?.radioChecked !== true) {
    return {
      ok: false,
      charts: before,
      why: 'the dialog did not take "Paste unlinked", so the chart would stay tied to the scratch sheet'
    };
  }
  const paste = chosen?.paste ?? dialog.paste;
  await doc.clickAt(paste.x, paste.y);
  const deadline = Date.now() + timeoutMs;
  let charts = before;
  for (;;) {
    charts = await chartCount(doc);
    if (charts > before || Date.now() >= deadline) break;
    await sleep(intervalMs);
  }

  // WHY THE MARKER IS ASKED ABOUT WHEN THE TREE IS COLD.
  // Measured live on a real Doc: a document draws its accessibility tree lazily, and a tree that was still cold after the paste named no chart for fifteen seconds - while the chart itself was plainly on the page, and the marker it was pasted over was gone.
  // The marker is the other half of the same question: a chart pasted over it takes its place, so the find bar no longer finding the marker is the chart having landed.

  let markerGone = false;
  if (charts <= before) {
    const after = await selectMarker({
      doc,
      marker,
      sleep
    });
    markerGone = after?.missing === true;
  }
  const landed = charts > before || markerGone;
  return {
    ok: landed,
    charts,
    markerGone,
    why: charts > before
      ? 'the page names the inserted chart in its own accessibility tree'
      : markerGone
        ? 'the chart took the marker\'s place and the find bar no longer finds the marker'
        : 'the page does not name an inserted chart, so the paste did not land'
  };
}

/**
 * Pastes something over a marker, which is how a picture stands in for a chart that could not be made.
 * @param {object} args - the paste inputs.
 * @param {object} args.doc - the document session to paste into.
 * @param {string} args.marker - the text that stands where the picture belongs.
 * @param {string} args.html - the HTML to put on the clipboard.
 * @param {object} [args.clipboard] - the clipboard writer to use, replaced in tests.
 * @param {Function} [args.sleep] - the wait between two steps, replaced in tests.
 * @returns {Promise<{pasted: boolean}>} that the paste was sent.
 */

export async function pasteOverMarker({
  doc,
  marker,
  html,
  clipboard,
  sleep = sleepDefault
} = {}) {
  const found = await selectMarker({
    doc,
    marker,
    sleep
  });
  if (found?.noBar === true) {
    return {
      pasted: false,
      why: 'the document did not open its find bar, so the marker could not be found'
    };
  }
  if (found?.missing === true) {
    return {
      pasted: false,
      why: `the document does not hold the marker "${marker}" (the find bar reads "${found.counter}"), so the picture had nowhere to go`
    };
  }
  if (found?.visible === false) {
    return {
      pasted: false,
      why: `the document stayed out of sight (${found.focusWhy || 'the window would not come forward'}), so the clipboard could not reach it`
    };
  }
  const held = clipboard.ensureHtml(html, marker);
  await clipboard.pasteHtml(doc.cdp);
  await sleep(1500);
  return {
    pasted: true,
    held
  };
}

/**
 * Throws the scratch sheet away, so a paper does not leave a spreadsheet behind it.
 * @param {object} args - the cleanup inputs.
 * @param {object} args.sheet - the sheet session to clean up.
 * @param {Function} [args.sleep] - the wait between two steps, replaced in tests.
 * @returns {Promise<{trashed: boolean, why: string}>} whether the page says the file is in the trash, and why.
 */

export async function trashSheet({
  sheet,
  sleep = sleepDefault
} = {}) {
  await sheet.openMenu({
    path: [
      'File',
      'Move to trash'
    ],
    clickLeaf: true,
    limit: 200
  });
  await sleep(2500);
  const read = await sheet.read({
    allowCaretMove: false
  }).catch(() => null);
  const text = String(read?.text ?? '');
  const trashed = /trash/i.test(text);
  return {
    trashed,
    why: trashed
      ? 'the page says the file is in the trash'
      : `the page did not say so: ${text.slice(0, 80)}`
  };
}
