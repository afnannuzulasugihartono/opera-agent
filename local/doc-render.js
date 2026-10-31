// @last-edited: 2026-10-30 UTC+7.
// @title: doc-render — a document plan turned into the HTML a page can show, with every chart drawn as a picture.
// @state: the chart spec, the canvas expression that draws a chart, and the HTML renderer for a plan's blocks.
// @dependencies: none.

// WHY THE STYLE SITS ON THE ELEMENT.
// Measured on a real Google Doc: a pasted <style> block left the text as it was, while the same rule written inline on the element landed as a heading, a bold run and a bordered table.
// So every rule here sits on the element it belongs to, and the paste has nothing left to resolve.

// WHY A CHART TRAVELS AS A PNG.
// Measured on the same Doc: an inline <svg> pasted as the three text labels inside it, and an <img> holding an SVG data URI pasted as a broken image with a toast saying the image could not be retrieved.
// A PNG pasted as an image arrived whole, so a chart is drawn on a canvas and handed over as a PNG.

const PAPER_FONT = 'Arial, sans-serif';
const TEXT_COLOR = '#202124';
const MUTED_COLOR = '#5f6368';
const RULE_COLOR = '#dadce0';
const HEADING_COLOR = '#0b57d0';
const HEADER_FILL = '#e8f0fe';
const CHART_WIDTH = 720;
const CHART_HEIGHT = 360;
const PALETTE = [
  '#1a73e8',
  '#ea4335',
  '#fbbc04',
  '#34a853',
  '#a142f4',
  '#24c1e0'
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '\u0026amp;')
    .replace(/</g, '\u0026lt;')
    .replace(/>/g, '\u0026gt;')
    .replace(/"/g, '\u0022quot;');
}

/**
 * The key an asset is filed under, so the writer and the renderer agree on which picture belongs to which block.
 * @param {string} kind - 'image' or 'graph'.
 * @param {number} section - the section index the block belongs to.
 * @param {number} index - the block's position among its kind in that section.
 * @returns {string} the asset key, as `kind:section:index`.
 */

export function assetKey(
  kind,
  section,
  index
) {
  return `${kind}:${section}:${index}`;
}

/**
 * Turns a graph block into what a canvas can draw: a kind, a title and labelled numeric points.
 * @param {object} graph - the graph block of a built document, carrying chartKind and data.
 * @param {object} [options] - the size to draw at.
 * @param {number} [options.width] - the picture width in pixels.
 * @param {number} [options.height] - the picture height in pixels.
 * @returns {{kind: string, title: string, data: Array<{label: string, value: number}>, width: number, height: number}} the drawable spec.
 */

export function chartSpec(
  graph,
  {
    width = CHART_WIDTH,
    height = CHART_HEIGHT
  } = {}
) {
  const kind = String(graph?.kind ?? '').trim().toLowerCase();
  if (kind !== 'bar' && kind !== 'line') {
    throw new Error(`a chart of kind "${kind || '(none)'}" cannot be drawn; this renderer draws bar and line.`);
  }
  const data = (Array.isArray(graph?.data) ? graph.data : []).map((point) => ({
    label: String(point?.label ?? '').trim(),
    value: Number(point?.value)
  }));
  if (!data.length) {
    throw new Error('a chart with no data cannot be drawn.');
  }
  if (data.some((point) => point.label === '' || !Number.isFinite(point.value))) {
    throw new Error('a chart with an unnamed point or a non-numeric value cannot be drawn.');
  }
  return {
    kind,
    title: String(graph?.title ?? '').trim(),
    data,
    width,
    height
  };
}

/**
 * The page expression that draws one chart on a canvas that is never attached to the document and answers with a PNG data URI.
 * @param {object} spec - a spec from chartSpec.
 * @returns {string} the expression to evaluate in the page.
 */

export function chartExpression(spec) {
  return `(() => {
  const spec = ${JSON.stringify(spec)};
  const palette = ${JSON.stringify(PALETTE)};
  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = (size, weight) => (weight || 'normal') + ' ' + size + 'px Arial, sans-serif';
  const clip = (text, max) => text.length > max ? text.slice(0, max - 1) + '…' : text;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, spec.width, spec.height);
  ctx.fillStyle = '#202124';
  ctx.font = font(16, 'bold');
  ctx.textBaseline = 'alphabetic';
  if (spec.title) ctx.fillText(clip(spec.title, 60), 16, 28);
  const top = 46;
  const bottom = spec.height - 30;
  const max = Math.max(...spec.data.map((point) => point.value), 0);
  const scale = max > 0 ? max : 1;
  if (spec.kind === 'bar') {
    const labelWidth = 180;
    const valueWidth = 90;
    const row = (bottom - top) / spec.data.length;
    const barHeight = Math.min(26, row * 0.6);
    const widthOf = (value) => (value / scale) * (spec.width - labelWidth - valueWidth);
    spec.data.forEach((point, index) => {
      const y = top + row * index + (row - barHeight) / 2;
      ctx.fillStyle = '#202124';
      ctx.font = font(13);
      ctx.textAlign = 'right';
      ctx.fillText(clip(point.label, 26), labelWidth - 10, y + barHeight * 0.72);
      ctx.fillStyle = palette[index % palette.length];
      ctx.fillRect(labelWidth, y, widthOf(point.value), barHeight);
      ctx.fillStyle = '#202124';
      ctx.font = font(12);
      ctx.textAlign = 'left';
      ctx.fillText(String(point.value), labelWidth + widthOf(point.value) + 8, y + barHeight * 0.72);
    });
  } else {
    const left = 44;
    const right = spec.width - 24;
    const step = spec.data.length > 1 ? (right - left) / (spec.data.length - 1) : 0;
    const yOf = (value) => bottom - (value / scale) * (bottom - top);
    ctx.strokeStyle = '#dadce0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    spec.data.forEach((point, index) => {
      const x = left + step * index;
      const y = yOf(point.value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    spec.data.forEach((point, index) => {
      const x = left + step * index;
      const y = yOf(point.value);
      ctx.fillStyle = '#1a73e8';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#202124';
      ctx.font = font(11);
      ctx.textAlign = 'center';
      ctx.fillText(clip(point.label, 16), x, bottom + 16);
      ctx.fillText(String(point.value), x, y - 10);
    });
  }
  ctx.textAlign = 'left';
  return canvas.toDataURL('image/png');
})()`;
}

function headingHtml(text) {
  return `<h2 style="font-family:${PAPER_FONT};font-size:18px;font-weight:bold;color:${TEXT_COLOR};border-bottom:1px solid ${RULE_COLOR};padding-bottom:4px;margin:22px 0 10px 0">${escapeHtml(text)}</h2>`;
}

// WHY THE TITLE IS A PARAGRAPH AND NOT A HEADING.
// Measured on a real Doc: the table of contents the page makes lists every heading, and a paper whose own title is a heading is listed in its own contents.
// So the title stands on the cover as a title, and only the sections are headings.

function titleHtml(text) {
  return `<p style="font-family:${PAPER_FONT};font-size:26px;font-weight:bold;color:${HEADING_COLOR};text-align:center;margin:48px 0 6px 0">${escapeHtml(text)}</p>`;
}

function coverLineHtml(text) {
  return `<p style="font-family:${PAPER_FONT};font-size:12px;color:${TEXT_COLOR};text-align:center;margin:0 0 4px 0">${escapeHtml(text)}</p>`;
}

function coverLabelHtml(text) {
  return `<p style="font-family:${PAPER_FONT};font-size:12px;font-weight:bold;color:${TEXT_COLOR};text-align:left;margin:18px 0 4px 0">${escapeHtml(text)}</p>`;
}

function referenceHtml(
  number,
  text
) {
  return `<p style="font-family:${PAPER_FONT};font-size:11px;line-height:1.5;color:${TEXT_COLOR};margin:0 0 6px 0">[${number}] ${escapeHtml(text)}</p>`;
}

function paragraphHtml(text) {
  return `<p style="font-family:${PAPER_FONT};font-size:12px;line-height:1.55;color:${TEXT_COLOR};margin:0 0 10px 0">${escapeHtml(text)}</p>`;
}

function tableHtml(block) {
  const cellStyle = `border:1px solid ${RULE_COLOR};padding:6px 8px;font-family:${PAPER_FONT};font-size:12px;color:${TEXT_COLOR}`;
  const headStyle = `${cellStyle};background-color:${HEADER_FILL};font-weight:bold`;
  const heads = block.headers.map((header) => `<th style="${headStyle}">${escapeHtml(header)}</th>`).join('');
  const rows = block.rows.map((row) => {
    const cells = row.map((cell) => `<td style="${cellStyle}">${escapeHtml(cell)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;width:100%;margin:0 0 14px 0"><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>`;
}

function figureHtml({
  src,
  alt,
  caption
}) {
  const image = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:560px;height:auto">`;
  const label = caption
    ? `<figcaption style="font-family:${PAPER_FONT};font-size:11px;color:${MUTED_COLOR};margin-top:6px">${escapeHtml(caption)}</figcaption>`
    : '';
  return `<figure style="margin:12px 0 16px 0">${image}${label}</figure>`;
}

function captionHtml(text) {
  return `<p style="font-family:${PAPER_FONT};font-size:11px;color:${MUTED_COLOR};margin:0 0 10px 0">${escapeHtml(text)}</p>`;
}

function markerHtml(marker) {
  return `<p style="font-family:${PAPER_FONT};font-size:12px;line-height:1.55;color:${TEXT_COLOR};margin:0 0 10px 0">${escapeHtml(marker)}</p>`;
}

/**
 * The text that stands where a chart belongs when the chart is made by the page itself and pasted in afterwards.
 * @param {number} index - the chart's position in the paper, counted from one.
 * @returns {string} the marker the document can find, as `[[opera-chart-N]]`.
 */

export function chartMarker(index) {
  return `[[opera-chart-${Number(index)}]]`;
}

/**
 * The text that stands where a page break belongs, so the page can break the page itself.
 * @param {number} index - the break's position in the paper, counted from one.
 * @returns {string} the marker the document can find, as `[[opera-break-N]]`.
 */

export function breakMarker(index) {
  return `[[opera-break-${Number(index)}]]`;
}

/**
 * The text that stands where the table of contents belongs, so the page can make it itself.
 * @returns {string} the marker the document can find, as `[[opera-toc]]`.
 */

export function tocMarker() {
  return '[[opera-toc]]';
}

const REFERENCES_HEADING = 'Referensi';

const asArray = (value) => Array.isArray(value) ? value : [];

/**
 * The markers the paper asks the page to make, so the writer and the renderer agree on where each one stands.
 * @param {object} args - the read inputs.
 * @param {object} args.document - a document from buildDocument, carrying the docplan.
 * @returns {{breaks: string[], toc: string|null}} the page break markers and the table of contents marker.
 */

export function paperMarkers({ document } = {}) {
  const docplan = document?.docplan ?? {};
  const breaks = [];
  let index = 0;
  if (docplan.cover) {
    index += 1;
    breaks.push(breakMarker(index));
  }
  if (docplan.toc) {
    index += 1;
    breaks.push(breakMarker(index));
  }
  return {
    breaks,
    toc: docplan.toc ? tocMarker() : null
  };
}

/**
 * The list of headings that stands in for a table of contents the page refused to make.
 * @param {object} args - the read inputs.
 * @param {object} args.document - a document from buildDocument, carrying the docplan.
 * @returns {string} the HTML of the list.
 */

export function tocListHtml({ document } = {}) {
  const docplan = document?.docplan ?? {};
  const headings = asArray(docplan.blocks)
    .filter((block) => block?.kind === 'heading')
    .map((block) => String(block.text ?? '').trim())
    .filter((text) => text !== '');
  if (asArray(docplan.references).length) headings.push(REFERENCES_HEADING);
  return headings.map((
    text,
    index
  ) => `<p style="font-family:${PAPER_FONT};font-size:12px;line-height:1.55;color:${TEXT_COLOR};margin:0 0 6px 0">${index + 1}. ${escapeHtml(text)}</p>`).join('');
}

/**
 * Renders one graph block as the picture a page can carry, with the caption the plan gave it.
 * @param {object} args - the figure inputs.
 * @param {object} args.block - the graph block of a built document.
 * @param {string} args.src - the source of the picture.
 * @returns {string} the HTML of the figure.
 */

export function graphFigureHtml({
  block,
  src
}) {
  const caption = [
    block?.title,
    block?.caption
  ].filter((part) => part && String(part).trim() !== '').join(' — ');
  return figureHtml({
    src,
    alt: block?.title || 'grafik',
    caption
  });
}

/**
 * Renders a built document into the HTML a page pastes as a styled document: headings, paragraphs, tables, figures and charts.
 * @param {object} args - the render inputs.
 * @param {object} args.document - a document from buildDocument, carrying the docplan blocks.
 * @param {object} [args.assets] - the pictures to place.
 * @param {Record<string, string>} [args.assets.images] - image block keys to source urls or data URIs.
 * @param {Record<string, string>} [args.assets.charts] - graph block keys to PNG data URIs.
 * @param {boolean} [args.nativeCharts] - when true, a graph is rendered as a marker the page can find and a chart can be pasted over.
 * @returns {string} the HTML of the whole paper.
 */

export function renderPaperHtml({
  document,
  assets = {},
  nativeCharts = false
} = {}) {
  const docplan = document?.docplan;
  if (!docplan || !Array.isArray(docplan.blocks)) {
    throw new Error('renderPaperHtml needs a built document that carries a docplan.');
  }
  const images = assets.images ?? {};
  const charts = assets.charts ?? {};
  const markers = paperMarkers({
    document
  });
  const parts = [];

  parts.push(titleHtml(docplan.title));
  if (docplan.cover?.subtitle) parts.push(coverLineHtml(docplan.cover.subtitle));
  if (docplan.author) parts.push(coverLineHtml(docplan.author));
  if (docplan.cover?.affiliation) parts.push(coverLineHtml(docplan.cover.affiliation));
  if (docplan.cover?.date) parts.push(coverLineHtml(docplan.cover.date));
  if (docplan.cover?.abstract) {
    parts.push(coverLabelHtml('Abstrak'));
    parts.push(paragraphHtml(docplan.cover.abstract));
  }
  if (docplan.cover?.keywords?.length) {
    parts.push(coverLabelHtml(`Kata kunci: ${docplan.cover.keywords.join(', ')}`));
  }
  if (docplan.cover) parts.push(markerHtml(markers.breaks[0]));

  // WHY THE CONTENTS STAND BETWEEN TWO PAGE BREAKS.
  // Measured on a real Doc: a page break is a command the page runs where the text stands, so the break is a marker and the page breaks it itself.
  // The cover ends with one, and the contents end with another, so the paper opens with a cover, lists itself, and starts its body on a fresh page.

  if (docplan.toc) {
    parts.push(coverLabelHtml(docplan.toc.title));
    parts.push(markerHtml(markers.toc));
    parts.push(markerHtml(markers.breaks[markers.breaks.length - 1]));
  }

  const imageCounts = new Map();
  const graphCounts = new Map();
  let graphTotal = 0;
  const nextIndex = (
    counts,
    section
  ) => {
    const index = counts.get(section) ?? 0;
    counts.set(section, index + 1);
    return index;
  };

  for (const block of docplan.blocks) {
    if (block.kind === 'heading') {
      parts.push(headingHtml(block.text));
      continue;
    }
    if (block.kind === 'paragraph') {
      parts.push(paragraphHtml(block.text));
      continue;
    }
    if (block.kind === 'table') {
      parts.push(tableHtml(block));
      continue;
    }
    if (block.kind === 'image') {
      const index = nextIndex(imageCounts, block.section);
      const key = assetKey('image', block.section, index);
      const src = images[key];
      if (!src) {
        throw new Error(`section ${block.section + 1} image ${index + 1} has no source to place; a picture cannot be pasted without one.`);
      }
      parts.push(figureHtml({
        src,
        alt: block.alt,
        caption: block.caption
      }));
      continue;
    }
    if (block.kind === 'graph') {
      graphTotal += 1;

      // WHY A NATIVE CHART IS RENDERED AS A MARKER.
      // Measured on a real Doc: a chart pasted from a sheet arrives as a chart only when the page answers the paste dialog, and the chart must stand where it belongs.
      // So the paper carries a marker there, the marker is found in the document, and the chart is pasted over it.

      if (nativeCharts === true) {
        parts.push(markerHtml(chartMarker(graphTotal)));
        const caption = [
          block.title,
          block.caption
        ].filter((part) => part && String(part).trim() !== '').join(' — ');
        if (caption) parts.push(captionHtml(caption));
        continue;
      }
      const key = assetKey('graph', block.section, nextIndex(graphCounts, block.section));
      const src = charts[key];
      if (!src) {
        throw new Error(`section ${block.section + 1} graph "${block.title || '(untitled)'}" has no picture; a chart that was not drawn cannot be pasted.`);
      }
      parts.push(graphFigureHtml({
        block,
        src
      }));
    }
  }

  // WHY THE REFERENCES ARE A HEADING AND A NUMBERED LIST.
  // A reference list is part of the paper, so it is a heading the table of contents lists, and every entry carries the number a reader cites it by.

  const references = asArray(docplan.references);
  if (references.length) {
    parts.push(headingHtml(REFERENCES_HEADING));
    references.forEach((
      text,
      index
    ) => {
      parts.push(referenceHtml(index + 1, text));
    });
  }
  return parts.join('');
}
