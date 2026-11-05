// @last-edited: 2026-11-05 UTC+7.
// @title: pptx - a deck PowerPoint opens: one slide per point, and every slide carries its own words.
// @state: slides in, one presentation out.
// @dependencies: ./zip.js, ./xml.js.

// WHY THE DECK CARRIES ITS OWN MASTER, LAYOUT AND THEME.
// PowerPoint reads those three parts before it draws anything, and a presentation without them opens as a repair request.
// The master here is the smallest one that satisfies the format: one blank layout, one colour scheme, no placeholders to fill in.

// WHY THE SLIDE TEXT IS WRITTEN AS TEXT BOXES.
// A slide with a title placeholder and a body placeholder waits for the customer to fill them in.
// A slide with two boxes is finished when the file is written, which is what a deck handed to a client has to be.

// WHY THE TITLE SLIDE IS NOT SPECIAL.
// One shape layout for every slide keeps the writer small and keeps the deck readable: a reader who opens slide nine sees the same frame as slide two.

import { zipBytes } from './zip.js';
import { escapeXml } from './xml.js';

const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATION = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const RELATION = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATION = 'http://schemas.openxmlformats.org/package/2006/relationships';
const PRESENTATION_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml';

const SLIDE_WIDTH = 12192000;
const SLIDE_HEIGHT = 6858000;
const MARGIN = 685800;
const TITLE_TOP = 457200;
const TITLE_HEIGHT = 1143000;
const BODY_TOP = 1828800;
const BODY_HEIGHT = 4114800;

const BULLET = String.fromCharCode(8226);

function textBox(id, name, top, height, paragraphs) {
  const body = paragraphs.map((paragraph) => {
    const bullet = paragraph.bullet === true
      ? `<a:pPr marL="342900" indent="-342900"><a:buChar char="${BULLET}"/></a:pPr>`
      : '<a:pPr/>';
    return `<a:p>${bullet}<a:r><a:rPr lang="id-ID" dirty="0"/><a:t>${escapeXml(paragraph.text)}</a:t></a:r></a:p>`;
  }).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${MARGIN}" y="${top}"/><a:ext cx="${SLIDE_WIDTH - (MARGIN * 2)}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${body}</p:txBody></p:sp>`;
}

function slideXml(slide) {
  const title = String(slide?.title ?? '').trim();
  if (title === '') throw new Error('a slide needs a title; a slide without one is a picture of nothing.');
  const bullets = (Array.isArray(slide?.bullets) ? slide.bullets : [])
    .map((bullet) => String(bullet ?? '').trim())
    .filter((bullet) => bullet !== '')
    .map((text) => ({ text, bullet: true }));

  const shapes = [
    textBox(2, 'Title', TITLE_TOP, TITLE_HEIGHT, [{ text: title, bullet: false }]),
    textBox(3, 'Body', BODY_TOP, BODY_HEIGHT, bullets)
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${DRAWING}" xmlns:r="${RELATION}" xmlns:p="${PRESENTATION}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function themeXml() {
  const accents = ['3ECF8E', '6B7280', '8B5CF6', 'F59E0B', 'EF4444', '06B6D4']
    .map((colour) => `<a:accent${accentIndex(colour)}><a:srgbClr val="${colour}"/></a:accent${accentIndex(colour)}>`)
    .join('');
  const fills = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3);
  const lines = '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'.repeat(3);
  const effects = '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${DRAWING}" name="Opera"><a:themeElements><a:clrScheme name="Opera"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="17181C"/></a:dk2><a:lt2><a:srgbClr val="F4F5F6"/></a:lt2>${accents}<a:hlink><a:srgbClr val="3ECF8E"/></a:hlink><a:folHlink><a:srgbClr val="6B7280"/></a:folHlink></a:clrScheme><a:fontScheme name="Opera"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Opera"><a:fillStyleLst>${fills}</a:fillStyleLst><a:lnStyleLst>${lines}</a:lnStyleLst><a:effectStyleLst>${effects}</a:effectStyleLst><a:bgFillStyleLst>${fills}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function accentIndex(colour) {
  return ['3ECF8E', '6B7280', '8B5CF6', 'F59E0B', 'EF4444', '06B6D4'].indexOf(colour) + 1;
}

function masterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="${DRAWING}" xmlns:r="${RELATION}" xmlns:p="${PRESENTATION}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
}

function layoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="${DRAWING}" xmlns:r="${RELATION}" xmlns:p="${PRESENTATION}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

export function buildDeck({ title = null, slides = [] } = {}) {
  const list = Array.isArray(slides) ? slides : [];
  if (list.length === 0) throw new Error('a deck needs at least one slide.');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="${PRESENTATION_TYPE}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${PRESENTATION_TYPE}.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${PRESENTATION_TYPE}.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${list.map((slide, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="${PRESENTATION_TYPE}.slide+xml"/>`).join('')}</Types>`;

  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;

  const slideIds = list.map((slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('');
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${DRAWING}" xmlns:r="${RELATION}" xmlns:p="${PRESENTATION}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

  const presentationRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${list.map((slide, index) => `<Relationship Id="rId${index + 2}" Type="${RELATION}/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 2}" Type="${RELATION}/theme" Target="theme/theme1.xml"/></Relationships>`;

  const masterRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RELATION}/theme" Target="../theme/theme1.xml"/></Relationships>`;

  const layoutRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: root },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', data: presentationRelations },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: masterXml() },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: masterRelations },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: layoutXml() },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: layoutRelations },
    { name: 'ppt/theme/theme1.xml', data: themeXml() }
  ];

  list.forEach((slide, index) => {
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: slideXml(slide) });
    entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>` });
  });

  return zipBytes(entries);
}
