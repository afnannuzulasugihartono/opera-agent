// @last-edited: 2026-11-06 UTC+7.
// @title: pptx - a deck PowerPoint opens: a cover, one slide per point, and every slide carries its own words.
// @state: slides in, one presentation out.
// @dependencies: ./zip.js, ./xml.js, ./palette.js.

// WHY THE DECK CARRIES ITS OWN MASTER, LAYOUT AND THEME.
// PowerPoint reads those three parts before it draws anything, and a presentation without them opens as a repair request.
// The master here is the smallest one that satisfies the format: one blank layout, one colour scheme, no placeholders to fill in.

// WHY THE SLIDE TEXT IS WRITTEN AS TEXT BOXES.
// A slide with a title placeholder and a body placeholder waits for the customer to fill them in.
// A slide with two boxes is finished when the file is written, which is what a deck handed to a client has to be.

// WHY EVERY SLIDE LOOKS THE SAME.
// One shape layout for every slide keeps the writer small and keeps the deck readable: a reader who opens slide nine sees the same frame as slide two.

// WHY THE DECK OPENS ON A COVER.
// A deck that starts on a bullet list is a document someone printed onto slides, and the first page is where a client decides whether the rest is worth reading.

import { zipBytes } from './zip.js';
import { escapeXml } from './xml.js';
import { PALETTE } from './palette.js';

const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATION = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const RELATION = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATION = 'http://schemas.openxmlformats.org/package/2006/relationships';
const PRESENTATION_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml';

const SLIDE_WIDTH = 12192000;
const SLIDE_HEIGHT = 6858000;
const MARGIN = 685800;
const TITLE_TOP = 457200;
const TITLE_HEIGHT = 914400;
const RULE_TOP = 1500000;
const RULE_WIDTH = 1371600;
const RULE_HEIGHT = 76200;
const BODY_TOP = 1828800;
const BODY_HEIGHT = 2743200;
const CARD_TOP = 4800000;
const CARD_HEIGHT = 1188720;
const FOOTER_TOP = 6172200;
const FOOTER_HEIGHT = 365760;
const FOOTER_NUMBER_WIDTH = 1200000;

const BULLET = String.fromCharCode(8226);

// A deck is written from three shapes: a run of styled text, a paragraph of runs, and the slide that carries them.

interface RunOptions {
  size?: number;
  bold?: boolean;
  colour?: string;
}

interface ParagraphOptions {
  bullet?: boolean;
  align?: string | null;
  lineSpacing?: number;
}

interface TextBoxOptions {
  left?: number;
  width?: number;
}

interface DeckFigure {
  label: string;
  display: string;
}

interface DeckSlide {
  title?: unknown;
  bullets?: unknown;
  figure?: unknown;
}

function run(text: unknown, { size = 1600, bold = false, colour = PALETTE.ink }: RunOptions = {}): string {
  const boldAttribute = bold ? ' b="1"' : '';
  return `<a:r><a:rPr lang="id-ID" sz="${size}"${boldAttribute} dirty="0"><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill></a:rPr><a:t>${escapeXml(text)}</a:t></a:r>`;
}

function paragraph(runs: string, { bullet = false, align = null, lineSpacing = 150000 }: ParagraphOptions = {}): string {
  const alignAttribute = align === null ? '' : ` algn="${align}"`;
  const bulletXml = bullet
    ? `<a:buClr><a:srgbClr val="${PALETTE.accent}"/></a:buClr><a:buSzPct val="100000"/><a:buFont typeface="Arial"/><a:buChar char="${BULLET}"/>`
    : '<a:buNone/>';
  return `<a:p><a:pPr marL="${bullet ? 342900 : 0}" indent="${bullet ? -342900 : 0}"${alignAttribute}><a:lnSpc><a:spcPct val="${lineSpacing}"/></a:lnSpc>${bulletXml}</a:pPr>${runs}</a:p>`;
}

function textBox(id: number, name: string, top: number, height: number, paragraphs: string[], { left = MARGIN, width = SLIDE_WIDTH - (MARGIN * 2) }: TextBoxOptions = {}): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${left}" y="${top}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs.join('')}</p:txBody></p:sp>`;
}

function shape(id: number, name: string, left: number, top: number, width: number, height: number, colour: string, geometry = 'rect'): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${left}" y="${top}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function slideXml(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${DRAWING}" xmlns:r="${RELATION}" xmlns:p="${PRESENTATION}"><p:cSld>${content}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function tree(shapes: string): string {
  return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree>`;
}

function coverSlide(title: string): string {
  const background = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${PALETTE.ink}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
  const shapes = [
    shape(2, 'Accent bar', MARGIN, 2286000, RULE_WIDTH, RULE_HEIGHT, PALETTE.accent),
    textBox(3, 'Cover title', 2514600, 1600200, [paragraph(run(title, { size: 4000, bold: true, colour: PALETTE.white }), { lineSpacing: 120000 })]),
    textBox(4, 'Wordmark', 5486400, 457200, [paragraph(run('Opera Agent', { size: 1200, colour: PALETTE.light }))])
  ].join('');
  return slideXml(`${background}${tree(shapes)}`);
}

function figureCard(figure: DeckFigure, id: number): string {
  const width = SLIDE_WIDTH - (MARGIN * 2);
  const textLeft = MARGIN + 274320;
  const textWidth = width - 457200;
  return [
    shape(id, 'Figure card', MARGIN, CARD_TOP, width, CARD_HEIGHT, PALETTE.light, 'roundRect'),
    shape(id + 1, 'Figure accent', MARGIN, CARD_TOP, 68580, CARD_HEIGHT, PALETTE.accent),
    textBox(id + 2, 'Figure value', CARD_TOP + 182880, 457200, [paragraph(run(figure.display, { size: 2400, bold: true, colour: PALETTE.ink }))], { left: textLeft, width: textWidth }),
    textBox(id + 3, 'Figure label', CARD_TOP + 731520, 365760, [paragraph(run(figure.label, { size: 1200, colour: PALETTE.muted }))], { left: textLeft, width: textWidth })
  ].join('');
}

function contentSlide(slide: DeckSlide, index: number, deckTitle: string): string {
  const title = String(slide.title ?? '').trim();
  if (title === '') throw new Error('a slide needs a title; a slide without one is a picture of nothing.');
  const bullets = (Array.isArray(slide.bullets) ? slide.bullets : [])
    .map((bullet) => String(bullet ?? '').trim())
    .filter((bullet) => bullet !== '');
  const figure = slide.figure && typeof slide.figure === 'object'
    ? { label: String((slide.figure as DeckFigure).label ?? '').trim(), display: String((slide.figure as DeckFigure).display ?? '').trim() }
    : null;

  const shapes = [
    textBox(2, 'Title', TITLE_TOP, TITLE_HEIGHT, [paragraph(run(title, { size: 2800, bold: true, colour: PALETTE.ink }), { lineSpacing: 120000 })]),
    shape(3, 'Rule', MARGIN, RULE_TOP, RULE_WIDTH, RULE_HEIGHT, PALETTE.accent),
    textBox(4, 'Body', BODY_TOP, figure === null ? 4114800 : BODY_HEIGHT, bullets.map((text) => paragraph(run(text, { size: 1600 }), { bullet: true }))),
    textBox(6, 'Footer', FOOTER_TOP, FOOTER_HEIGHT, [paragraph(run(deckTitle, { size: 1000, colour: PALETTE.muted }))]),
    textBox(7, 'Number', FOOTER_TOP, FOOTER_HEIGHT, [paragraph(run(String(index + 2).padStart(2, '0'), { size: 1000, colour: PALETTE.muted }), { align: 'r' })], { left: SLIDE_WIDTH - MARGIN - FOOTER_NUMBER_WIDTH, width: FOOTER_NUMBER_WIDTH })
  ];
  if (figure !== null) shapes.splice(3, 0, figureCard(figure, 8));

  return slideXml(tree(shapes.join('')));
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

function accentIndex(colour: string): number {
  return ['3ECF8E', '6B7280', '8B5CF6', 'F59E0B', 'EF4444', '06B6D4'].indexOf(colour) + 1;
}

function masterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="${DRAWING}" xmlns:r="${RELATION}" xmlns:p="${PRESENTATION}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
}

function layoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="${DRAWING}" xmlns:r="${RELATION}" xmlns:p="${PRESENTATION}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

export function buildDeck({ title = null, slides = [] }: { title?: unknown; slides?: unknown[] } = {}) {
  const list = Array.isArray(slides) ? slides : [];
  if (list.length === 0) throw new Error('a deck needs at least one slide.');

  const deckTitle = String(title ?? '').trim();
  const pages: string[] = deckTitle === '' ? [] : [coverSlide(deckTitle)];
  list.forEach((value, index) => {
    const slide = value && typeof value === 'object' ? value as DeckSlide : {};
    pages.push(contentSlide(slide, index, deckTitle));
  });

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="${PRESENTATION_TYPE}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${PRESENTATION_TYPE}.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${PRESENTATION_TYPE}.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${pages.map((_slide, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="${PRESENTATION_TYPE}.slide+xml"/>`).join('')}</Types>`;

  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;

  const slideIds = pages.map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('');
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${DRAWING}" xmlns:r="${RELATION}" xmlns:p="${PRESENTATION}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

  const presentationRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${pages.map((_slide, index) => `<Relationship Id="rId${index + 2}" Type="${RELATION}/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}<Relationship Id="rId${pages.length + 2}" Type="${RELATION}/theme" Target="theme/theme1.xml"/></Relationships>`;

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

  pages.forEach((slide, index) => {
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: slide });
    entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>` });
  });

  return zipBytes(entries);
}
