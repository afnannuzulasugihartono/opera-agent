// @last-edited: 2026-10-30 UTC+7.
// @title: doc-write — a paper planned on disk, carried into a live page and read back.
// @state: the asset resolver, the chart rasterizer, and the write that pastes the paper and checks what landed.
// @dependencies: node:fs, node:path, ./documents.js, ./doc-render.js, ./clipboard.js.

// WHY THE WRITE REFUSES A PAPER IT CANNOT SHOW WHOLE.
// A picture with no source and a chart that was never drawn are the two ways a paper reaches a page missing what it promised.
// So both stop the write, and the reason says which one it was.

// WHY THE CARET POINT IS THE CALLER'S CALL.
// Measured on a real Google Doc: the editor is drawn on a canvas, the caret is in the application's model, and a paste with no click lands nothing.
// Where the page is drawn is not something a generic reader can measure, so the point is given.
// The default is the middle of the viewport: measured on a fresh document, a click in the page's top margin left the editor unfocused and the paste landed nothing, while a click in the middle of the page landed the whole paper in 48 ms.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { documentFromFile } from './documents.js';
import {
  assetKey,
  chartExpression,
  chartMarker,
  chartSpec,
  graphFigureHtml,
  renderPaperHtml
} from './doc-render.js';
import {
  buildNativeChart,
  ensureVisible,
  pasteOverMarker,
  placeNativeChart,
  trashSheet
} from './doc-native-chart.js';
import {
  ensureHtml,
  pasteHtml,
  readChartClip,
  writeText
} from './clipboard.js';

const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};
const DEFAULT_CARET = {
  x: 0.5,
  y: 0.5
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function imageSource(
  block,
  base
) {
  const src = String(block?.src ?? '').trim();
  if (src === '') {
    throw new Error(`section ${Number(block?.section ?? 0) + 1} image "${block?.alt || '(untitled)'}" has no source file or url; a picture cannot be placed without one.`);
  }
  if (src.startsWith('data:')) return src;
  if (/^https?:\/\//i.test(src)) return src;
  const file = path.resolve(base, src);
  const mime = MIME_BY_EXTENSION[path.extname(file).toLowerCase()];
  if (!mime) {
    throw new Error(`the image at ${file} is not a png, jpeg, gif or webp, so a page cannot be asked to place it.`);
  }
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

async function chartPicture(
  session,
  block
) {
  const picture = await session.evaluate(chartExpression(chartSpec(block)));
  const src = String(picture ?? '');
  if (!src.startsWith('data:image/png;base64,')) {
    throw new Error(`the page could not draw the chart "${block?.title || '(untitled)'}", so it has no picture to paste.`);
  }
  return src;
}

// WHY THE PAGE IS ASKED FOR THE HEADINGS IT NAMES.
// A canvas editor holds its text as pixels, and the body of a document is not always in the accessibility tree.
// The headings are: a document editor keeps a table of contents of them, and that table is built by the page itself, so a heading the page names is a heading that landed.
// Measured on a real Doc: the outline held all six headings of a pasted paper while the body of the page stayed out of the tree.
// The name of the browser tab is left out, because a tab named after the paper would answer every heading with itself.

async function pageNames(
  session
) {
  const tree = await session.ask('Accessibility.getFullAXTree', { maxDepth: 60 }).catch(() => null);
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  return nodes
    .filter((node) => String(node?.role?.value ?? '') !== 'RootWebArea')
    .map((node) => String(node?.name?.value ?? ''));
}

async function landedHeadings(
  session,
  wanted
) {
  if (!wanted.length) return [];
  const names = await pageNames(session);
  return wanted.filter((heading) => names.some((name) => name.includes(heading)));
}

// WHY THE PAGE IS ASKED REPEATEDLY AFTER A PASTE.
// Measured on a real Doc: a document that was still opening did not name the pasted headings at once, and named all six of them a moment later.
// One answer too early would read as a paste that landed nothing, so the page is asked again until it answers or the budget runs out.

async function pollForHeadings(
  session,
  wanted,
  {
    timeoutMs = 20000,
    intervalMs = 1000
  } = {}
) {
  const started = Date.now();
  for (;;) {
    const found = await landedHeadings(session, wanted);
    if (found.length === wanted.length || Date.now() - started >= timeoutMs) {
      return {
        found,
        waitedMs: Date.now() - started
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// WHY THE WRITE WAITS FOR THE EDITOR'S OWN FRAME.
// Measured on a real Doc: a paste into a document that was still opening landed nothing, and the same paste landed the whole paper once the editor's frame showed up in the accessibility tree.
// So the write waits for that frame, and pastes into a page that is ready to hold it.

async function waitForEditor(
  session,
  {
    timeoutMs = 8000
  } = {}
) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  for (;;) {
    const tree = await session.ask('Accessibility.getFullAXTree', { maxDepth: 60 }).catch(() => null);
    const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    const frames = nodes.filter((node) => String(node?.role?.value ?? '') === 'Iframe').length;
    if (frames > 0) {
      return {
        ready: true,
        ms: Date.now() - started
      };
    }
    if (Date.now() > deadline) {
      return {
        ready: false,
        ms: Date.now() - started,
        why: 'the page showed no editor frame before the wait ran out, so the paste was tried anyway'
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Carries a paper from a JSON file into a live page: checks the plan against its own tables, draws every graph as a picture, fills the clipboard, pastes into the tab, and asks the page which headings it now holds.
 * @param {object} args - the write inputs.
 * @param {string} args.source - the JSON file describing the paper.
 * @param {object} args.session - the page session to write into.
 * @param {{x: number, y: number}} [args.at] - where to put the caret before the paste, in CSS pixels.
 * @param {number} [args.settleMs] - how long to keep asking the page after a paste before trying again.
 * @param {number} [args.pollMs] - the gap between two asks of the page.
 * @param {boolean} [args.nativeCharts] - when true, every graph is made by the page itself as a chart and pasted in as a chart, with a picture as the fallback.
 * @param {Function} [args.openSheet] - opens the sheet the charts are built in, replaced in tests.
 * @param {object} [args.native] - the chart making and placing calls, replaced in tests.
 * @param {object} [args.clipboard] - the clipboard writer to use, replaced in tests.
 * @returns {Promise<object>} what was pasted, what the page says it holds, and the read back afterwards.
 */

export async function writeDocumentToPage({
  source,
  session,
  at = null,
  settleMs = 20000,
  pollMs = 1000,
  nativeCharts = false,
  openSheet = null,
  native = {
    build: buildNativeChart,
    place: placeNativeChart,
    pasteOver: pasteOverMarker,
    trash: trashSheet
  },
  clipboard = {
    ensureHtml,
    pasteHtml,
    readChartClip,
    writeText
  }
} = {}) {
  if (!session) {
    throw new Error('document_write needs a page to write into.');
  }
  const marker = `opera-agent-document:${randomUUID()}`;
  const built = documentFromFile({ source });
  const blocks = built.document?.docplan?.blocks ?? [];
  const graphs = blocks.filter((block) => block.kind === 'graph');
  const base = path.dirname(path.resolve(String(source)));

  // WHY THE REFUSAL COMES BEFORE THE PASTE.
  // A native chart needs a sheet to be built in, and a paper pasted with markers and no chart to put in them is a paper with holes in it.
  // So the write stops while the page still holds nothing of ours.

  if (nativeCharts === true && typeof openSheet !== 'function') {
    throw new Error('document_write cannot make native charts without a sheet to build them in.');
  }

  const images = {};
  const charts = {};
  const imageCounts = new Map();
  const graphCounts = new Map();
  const nextIndex = (
    counts,
    section
  ) => {
    const index = counts.get(section) ?? 0;
    counts.set(section, index + 1);
    return index;
  };

  for (const block of blocks) {
    if (block.kind === 'image') {
      images[assetKey('image', block.section, nextIndex(imageCounts, block.section))] = imageSource(block, base);
      continue;
    }
    if (block.kind === 'graph' && nativeCharts !== true) {
      charts[assetKey('graph', block.section, nextIndex(graphCounts, block.section))] = await chartPicture(session, {
        ...block,
        kind: block.chartKind ?? block.kind
      });
    }
  }

  const html = `<!-- ${marker} -->${renderPaperHtml({
    document: built.document,
    assets: {
      images,
      charts
    },
    nativeCharts: nativeCharts === true
  })}`;

  await session.front();
  const view = await session.viewport().catch(() => null);
  const width = Number(view?.width) || 1536;
  const height = Number(view?.height) || 720;
  const point = at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y))
    ? {
      x: Number(at.x),
      y: Number(at.y)
    }
    : {
      x: Math.round(width * DEFAULT_CARET.x),
      y: Math.round(height * DEFAULT_CARET.y)
    };

  const wanted = blocks
    .filter((block) => block.kind === 'heading')
    .map((block) => String(block.text ?? '').trim())
    .filter((text) => text !== '');
  const title = String(built.document?.docplan?.title ?? '');
  const editor = await waitForEditor(session);

  // WHY THE PASTE IS TRIED TWICE AND THE PAGE IS ASKED UNTIL IT ANSWERS.
  // Measured on a real Doc: a paste into a document that was still opening landed nothing at once, and the same document held the whole paper a moment later, while a small paste landed at once.
  // So after each paste the page is asked again until it names the headings it now holds, and a second paste is sent only when the first one left no trace.

  // WHY THE CLIPBOARD IS FILLED JUST BEFORE EACH PASTE.
  // The clipboard belongs to the whole machine: measured on this one, a buffer this flow had filled held another agent's picture a minute later.
  // Writing it right before the paste keeps that window to the paste itself, and the marker says whether our paper was still the one on the buffer.

  // WHY THE PAGE IS BROUGHT FORWARD BEFORE THE PAPER IS PASTED.
  // Measured live on this machine: a paste into a page whose window sits behind another one lands nothing at all, and the very same paste lands the whole paper as soon as that window is in front.
  // So the page is asked whether it is visible, its window is brought forward when it is not, and the answer travels with the report so a write that left nothing says why.

  const shown = await ensureVisible(session);

  let landed = {
    found: [],
    waitedMs: 0
  };
  const held = [];
  let attempts = 0;
  while (attempts < 2 && landed.found.length < wanted.length) {
    attempts += 1;
    await session.clickAt(point.x, point.y);
    await sleep(500);
    const placed = clipboard.ensureHtml(html, marker);
    held.push(placed);
    await clipboard.pasteHtml(session.cdp);
    landed = await pollForHeadings(session, wanted, {
      timeoutMs: settleMs,
      intervalMs: pollMs
    });
  }
  const found = landed.found;

  // WHY THE CHARTS ARE PLACED AFTER THE PAPER IS IN.
  // A chart is pasted over a marker, so the marker has to be in the document first, and the paste is what puts it there.
  // The charts are not held back by the heading check, because a document draws its accessibility tree lazily and a cold tree names no heading while the paper is plainly there.
  // Each chart asks the document for its own marker, so a marker that is missing is caught where it is missing.

  let nativeReport = null;
  if (nativeCharts === true) {
    nativeReport = await writeNativeCharts({
      session,
      graphs,
      builder: native,
      clipboard,
      openSheet
    });
  }

  const read = await session.read({ allowCaretMove: false });
  const text = String(read.text ?? '');
  return {
    source: built.source,
    plan: built.out,
    verified: built.verified,
    pasted: {
      bytes: Buffer.byteLength(html, 'utf8'),
      at: point,
      images: Object.keys(images).length,
      charts: graphs.length,
      attempts,
      editor,
      clipboard: held
    },
    landed: {
      title,
      headings: wanted,
      found,
      waitedMs: landed.waitedMs,
      visible: shown.visible,
      ok: wanted.length === 0 ? false : found.length === wanted.length,
      why: found.length === wanted.length
        ? 'the page names these headings in its own accessibility tree, which is where a document editor keeps its table of contents'
        : shown.visible === false
          ? `the page was out of sight (${shown.why || 'its window would not come forward'}), so the paste had nowhere to land`
          : 'the page named none of these headings, so the paper was not found in it'
    },
    native: nativeReport,
    readBack: {
      chars: text.length,
      titleFound: title !== '' && text.includes(title),
      strategy: read.strategy ?? null,
      why: text.length > 0 && !text.includes(title)
        ? 'the page answered with other text, so the paper was not found in it'
        : 'the page was read after the paste'
    }
  };
}

// WHY A CHART THAT CANNOT BE MADE FALLS BACK TO A PICTURE.
// The paper promised a graph in that spot, and a paper with a hole where a graph should be is not the paper that was asked for.
// So the picture is pasted over the same marker, and the report says which graph is a chart and which is a picture.

async function pictureOverMarker({
  session,
  block,
  marker,
  builder,
  clipboard
}) {
  try {
    const src = await chartPicture(session, {
      ...block,
      kind: block.chartKind ?? block.kind
    });
    const html = `<!-- ${marker} -->${graphFigureHtml({
      block,
      src
    })}`;
    const out = await builder.pasteOver({
      doc: session,
      marker,
      html,
      clipboard
    });
    return {
      pasted: out?.pasted === true,
      why: out?.why ?? ''
    };
  } catch (error) {
    return {
      pasted: false,
      why: String(error?.message ?? error).split('\n')[0]
    };
  }
}

async function writeNativeCharts({
  session,
  graphs,
  builder,
  clipboard,
  openSheet
}) {
  const sheet = await openSheet();
  const charts = [];
  let sheetReport = {
    trashed: false,
    why: 'the sheet was not thrown away'
  };
  try {
    for (let index = 0; index < graphs.length; index += 1) {
      const block = graphs[index];
      const marker = chartMarker(index + 1);
      let placed = {
        ok: false,
        why: 'the chart was never built'
      };
      try {
        await builder.build({
          sheet,
          block,
          clipboard
        });
        placed = await builder.place({
          doc: session,
          marker,
          clipboard
        });
      } catch (error) {
        placed = {
          ok: false,
          why: String(error?.message ?? error).split('\n')[0]
        };
      }
      if (placed.ok === true) {
        charts.push({
          index: index + 1,
          title: block.title ?? '',
          kind: 'native',
          ok: true,
          why: placed.why ?? ''
        });
        continue;
      }
      const picture = await pictureOverMarker({
        session,
        block,
        marker,
        builder,
        clipboard
      });
      charts.push({
        index: index + 1,
        title: block.title ?? '',
        kind: picture.pasted ? 'picture' : 'missing',
        ok: picture.pasted,
        why: picture.pasted
          ? placed.why
          : `${placed.why}; the picture that stood in for it did not land either: ${picture.why}`
      });
    }
    sheetReport = await builder.trash({
      sheet
    }).catch((error) => ({
      trashed: false,
      why: String(error?.message ?? error).split('\n')[0]
    }));
  } finally {
    sheet.close?.();
  }
  return {
    charts,
    sheet: sheetReport
  };
}
