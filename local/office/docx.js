// @last-edited: 2026-11-05 UTC+7.
// @title: docx - a Word document a reader can open: headings, paragraphs, tables, and the numbers the plan checked.
// @state: a checked document plan in, one Word file out.
// @dependencies: ./zip.js, ./xml.js.

// WHY THE WRITER READS A PLAN AND NOT A PAPER.
// The plan is what was already checked against the source rows, so the file cannot carry a number the check would have refused.

// WHY A GRAPH BECOMES A TABLE.
// A picture of a chart cannot be read by a spreadsheet or a screen reader, and the numbers behind it are what the reader checks.
// The table holds the same numbers under the graph's own title.

// WHY AN IMAGE IS EMBEDDED AND NOT NAMED.
// A paper that points at a file on the author's disk is broken the moment the paper leaves the disk.

import { zipBytes } from './zip.js';
import { escapeXml } from './xml.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RELATION = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATION = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WORD_DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PICTURE = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const CONTENT_TYPES = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

function paragraph(text, style = null) {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(block) {
  const headers = Array.isArray(block.headers) ? block.headers : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const borders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders>';
  const cell = (value, bold) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p></w:tc>`;
  const head = headers.length > 0
    ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((value) => cell(value, true)).join('')}</w:tr>`
    : '';
  const body = rows.map((row) => `<w:tr>${(Array.isArray(row) ? row : []).map((value) => cell(value, false)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>${head}${body}</w:tbl><w:p/>`;
}

function imageXml(block, relationId, pictureId) {
  const width = 5486400;
  const height = 3200400;
  const caption = block.caption ? paragraph(block.caption) : '';
  const alt = escapeXml(block.alt ?? 'gambar');
  const drawing = `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${pictureId}" name="Picture ${pictureId}" descr="${alt}"/><a:graphic><a:graphicData uri="${PICTURE}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${pictureId}" name="Picture ${pictureId}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  return drawing + caption;
}

function graphXml(block) {
  const rows = (Array.isArray(block.data) ? block.data : []).map((point) => [point.label, String(point.value)]);
  const title = block.title ? `${block.title} (data)` : 'Grafik (data)';
  return tableXml({ headers: [title, 'Nilai'], rows }) + (block.caption ? paragraph(block.caption) : '');
}

export function buildDocumentFile({ title, blocks = [] } = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (list.length === 0) throw new Error('a document needs at least one block.');

  const media = [];
  const relations = [];
  const body = [];
  let pictureId = 1;

  for (const block of list) {
    const kind = String(block?.kind ?? '');
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

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD}" xmlns:r="${RELATION}" xmlns:wp="${WORD_DRAWING}" xmlns:a="${DRAWING}" xmlns:pic="${PICTURE}"><w:body>${title ? paragraph(title, 'Title') : ''}${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WORD}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`;

  const imageDefaults = [...new Set(media.map((part) => part.extension))]
    .map((extension) => `<Default Extension="${extension}" ContentType="image/${extension === 'jpg' ? 'jpeg' : extension}"/>`)
    .join('');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${CONTENT_TYPES}.styles+xml"/></Types>`;

  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/officeDocument" Target="word/document.xml"/></Relationships>`;

  const documentRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rIdStyles" Type="${RELATION}/styles" Target="styles.xml"/>${relations.join('')}</Relationships>`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: root },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: documentRelations }
  ];

  for (const part of media) entries.push({ name: part.name, data: part.data });

  return zipBytes(entries);
}
