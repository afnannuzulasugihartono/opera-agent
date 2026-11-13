// @last-edited: 2026-11-06 UTC+7.
// @title: docx - a Word document a reader can open: a cover, headings, padded tables, a page footer, and the numbers the plan checked.
// @state: a checked document plan in, one Word file out.
// @dependencies: ./zip.js, ./xml.js, ./palette.js.

// WHY THE WRITER READS A PLAN AND NOT A PAPER.
// The plan is what was already checked against the source rows, so the file cannot carry a number the check would have refused.

// WHY A GRAPH BECOMES A TABLE.
// A picture of a chart cannot be read by a spreadsheet or a screen reader, and the numbers behind it are what the reader checks.
// The table holds the same numbers under the graph's own title.

// WHY AN IMAGE IS EMBEDDED AND NOT NAMED.
// A paper that points at a file on the author's disk is broken the moment the paper leaves the disk.

// WHY THE TABLE FILLS THE PAGE AND ITS CELLS CARRY PADDING.
// A table squeezed into half the page, with the words touching the cell edge, reads as a dump even when the numbers are right.

import { zipBytes } from './zip.js';
import { escapeXml } from './xml.js';
import { PALETTE } from './palette.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RELATION = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATION = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WORD_DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PICTURE = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const CONTENT_TYPES = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

// WHY A NUMBER READS THE INDONESIAN WAY.
// A table of plain digits is a machine's table; a reader of a report expects "12.500.000" and "1,98", and a file that prints "12500000" reads as unfinished.

// One planned block: the writer reads a handful of fields and leaves the rest to the plan that made it.

interface DocBlock {
  kind?: unknown;
  level?: unknown;
  text?: unknown;
  headers?: unknown[];
  rows?: unknown[];
  data?: unknown[];
  caption?: unknown;
  alt?: unknown;
  bytes?: unknown;
  extension?: unknown;
  [key: string]: unknown;
}

interface CellOptions {
  bold?: boolean;
  fill?: string | null;
  colour?: string | null;
}

function readableNumber(value: unknown): string {
  const text = String(value ?? '').trim();
  if (/^-?\d{4,}$/.test(text)) {
    const negative = text.startsWith('-');
    const digits = negative ? text.slice(1) : text;
    const fromRight: string[] = [];
    for (let from = digits.length; from > 0; from -= 3) fromRight.unshift(digits.slice(Math.max(0, from - 3), from));
    return `${negative ? '-' : ''}${fromRight.join('.')}`;
  }
  if (/^-?\d+\.\d+$/.test(text)) return text.replace('.', ',');
  return text;
}

function paragraph(text: unknown, style: string | null = null, runProps = ''): string {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${properties}<w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function cell(value: unknown, { bold = false, fill = null, colour = null }: CellOptions = {}): string {
  const shading = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '';
  const runProperties: string[] = [];
  if (bold) runProperties.push('<w:b/>');
  if (colour) runProperties.push(`<w:color w:val="${colour}"/>`);
  const runProps = runProperties.length > 0 ? `<w:rPr>${runProperties.join('')}</w:rPr>` : '';
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${shading}<w:vAlign w:val="center"/></w:tcPr>${paragraph(readableNumber(value), null, runProps)}</w:tc>`;
}

function tableXml(block: DocBlock): string {
  const headers: unknown[] = Array.isArray(block.headers) ? block.headers : [];
  const rows: unknown[] = Array.isArray(block.rows) ? block.rows : [];
  const border = `<w:${'top'} w:val="single" w:sz="4" w:space="0" w:color="${PALETTE.border}"/>`;
  const borders = `<w:tblBorders>${border}<w:left w:val="single" w:sz="4" w:space="0" w:color="${PALETTE.border}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${PALETTE.border}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${PALETTE.border}"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="${PALETTE.border}"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="${PALETTE.border}"/></w:tblBorders>`;
  const cellMar = '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar>';
  const columns = Math.max(headers.length, ...rows.map((row) => (Array.isArray(row) ? row.length : 0)), 1);
  const grid = Array.from({ length: columns }, () => '<w:gridCol w:w="2400"/>').join('');
  const head = headers.length > 0
    ? `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${headers.map((value) => cell(value, { bold: true, fill: PALETTE.ink, colour: PALETTE.white })).join('')}</w:tr>`
    : '';
  const body = rows.map((row, index) => {
    const fill = index % 2 === 1 ? PALETTE.light : null;
    return `<w:tr>${(Array.isArray(row) ? row : []).map((value) => cell(value, { fill })).join('')}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}${cellMar}<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl><w:p/>`;
}

function imageXml(block: DocBlock, relationId: string, pictureId: number): string {
  const width = 5486400;
  const height = 3200400;
  const caption = block.caption ? paragraph(block.caption, 'Caption') : '';
  const alt = escapeXml(block.alt ?? 'gambar');
  const drawing = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${pictureId}" name="Picture ${pictureId}" descr="${alt}"/><a:graphic><a:graphicData uri="${PICTURE}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${pictureId}" name="Picture ${pictureId}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  return drawing + caption;
}

function graphXml(block: DocBlock): string {
  const rows = (Array.isArray(block.data) ? block.data : []).map((point) => {
    const entry = point && typeof point === 'object' ? point as { label?: unknown; value?: unknown } : {};
    return [entry.label, String(entry.value)];
  });
  const title = block.title ? `${block.title} (data)` : 'Grafik (data)';
  return tableXml({ headers: [title, 'Nilai'], rows }) + (block.caption ? paragraph(block.caption, 'Caption') : '');
}

function footerXml() {
  const runProps = `<w:rPr><w:sz w:val="18"/><w:color w:val="${PALETTE.muted}"/></w:rPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${WORD}"><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="${PALETTE.border}"/></w:pBdr><w:spacing w:before="120"/><w:jc w:val="center"/></w:pPr><w:r>${runProps}<w:t xml:space="preserve">Halaman </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r>${runProps}<w:t>1</w:t></w:r></w:fldSimple><w:r>${runProps}<w:t xml:space="preserve"> dari </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r>${runProps}<w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
}

function stylesXml() {
  const accentRule = `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${PALETTE.accent}"/></w:pBdr>`;
  const headingRule = `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${PALETTE.accent}"/></w:pBdr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WORD}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="${PALETTE.ink}"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto" w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="276" w:lineRule="auto" w:after="120"/></w:pPr><w:rPr><w:sz w:val="22"/><w:color w:val="${PALETTE.ink}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr>${accentRule}<w:spacing w:before="0" w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="${PALETTE.ink}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:sz w:val="20"/><w:color w:val="${PALETTE.muted}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr>${headingRule}<w:spacing w:before="320" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="${PALETTE.ink}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="${PALETTE.ink}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="60" w:after="200"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="${PALETTE.muted}"/></w:rPr></w:style></w:styles>`;
}

export function buildDocumentFile({ title, subtitle = null, blocks = [] }: { title?: unknown; subtitle?: unknown; blocks?: DocBlock[] } = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (list.length === 0) throw new Error('a document needs at least one block.');

  const media: Array<{ name: string; data: unknown; extension: string }> = [];
  const relations: string[] = [];
  const body: string[] = [];
  let pictureId = 1;

  for (const block of list) {
    const kind = String(block.kind ?? '');
    if (kind === 'heading') {
      const level = Number(block.level) === 2 ? 'Heading2' : 'Heading1';
      body.push(paragraph(block.text, level));
      continue;
    }
    if (kind === 'paragraph') {
      body.push(paragraph(block.text));
      continue;
    }
    if (kind === 'table') {
      body.push(tableXml(block));
      continue;
    }
    if (kind === 'graph') {
      body.push(graphXml(block));
      continue;
    }
    if (kind === 'image') {
      const bytes = block.bytes;
      if (!bytes) {
        body.push(paragraph(`[gambar: ${block.alt ?? 'tanpa keterangan'}]`));
        continue;
      }
      const extension = String(block.extension ?? 'png');
      const relationId = `rId${media.length + 1}`;
      media.push({ name: `word/media/image${media.length + 1}.${extension}`, data: bytes, extension });
      relations.push(`<Relationship Id="${relationId}" Type="${RELATION}/image" Target="media/image${media.length + 1}.${extension}"/>`);
      body.push(imageXml(block, relationId, pictureId));
      pictureId += 1;
      continue;
    }
    throw new Error(`the document plan holds a block this writer does not know: "${kind}".`);
  }

  const cover = [
    title ? paragraph(title, 'Title') : '',
    subtitle ? paragraph(subtitle, 'Subtitle') : ''
  ].join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD}" xmlns:r="${RELATION}" xmlns:wp="${WORD_DRAWING}" xmlns:a="${DRAWING}" xmlns:pic="${PICTURE}"><w:body>${cover}${body.join('')}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const imageDefaults = [...new Set(media.map((part) => part.extension))]
    .map((extension) => `<Default Extension="${extension}" ContentType="image/${extension === 'jpg' ? 'jpeg' : extension}"/>`)
    .join('');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${CONTENT_TYPES}.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="${CONTENT_TYPES}.footer+xml"/></Types>`;

  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/officeDocument" Target="word/document.xml"/></Relationships>`;

  const documentRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rIdStyles" Type="${RELATION}/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="${RELATION}/footer" Target="footer1.xml"/>${relations.join('')}</Relationships>`;

  const entries: Array<{ name: string; data: unknown }> = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: root },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: stylesXml() },
    { name: 'word/footer1.xml', data: footerXml() },
    { name: 'word/_rels/document.xml.rels', data: documentRelations }
  ];

  for (const part of media) entries.push({ name: part.name, data: part.data });

  return zipBytes(entries);
}
