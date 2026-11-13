// @last-edited: 2026-11-06 UTC+7.
// @title: xlsx - a workbook Excel opens: named sheets, numbers that stay numbers, and a ledger of where each figure came from.
// @state: sheets in, one workbook out, and nothing on a sheet that was not put there.
// @dependencies: ./zip.js, ./xml.js, ./palette.js.

// WHY THE CELLS HOLD NUMBERS AND NOT TEXT.
// A bookkeeper opens the total, adds it to another sheet, and expects it to be a number.
// Money written as "Rp 1.250.000" is a sentence in a spreadsheet, and every formula that touches it fails.

// WHY THE FILL AND THE FONT ARE DECLARED.
// Excel refuses a workbook whose styles part is missing, and it fills the missing fonts with its own idea of a typeface.

// WHY THE SHEET NAME IS CHECKED.
// Excel forbids a name longer than thirty-one characters or one holding a bracket, a colon or a slash, and it refuses the whole file when it finds one.

// WHY THE SHEET CARRIES A TITLE, A HEADER, A FROZEN ROW AND A WIDTH.
// A sheet of bare cells is a dump; a sheet that names its report, marks its header, keeps that header in view while the rows scroll and gives every column the width of its content is a page a bookkeeper can read.
// The money column needs its own width, because a column too narrow for the number shows hashes instead of the number.

import { zipBytes } from './zip.js';
import { cellAddress, escapeXml } from './xml.js';
import { PALETTE } from './palette.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATION = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATION = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

const FORBIDDEN_IN_NAME = /[[\]:*?/\\]/;

const AMP = String.fromCharCode(38);

const MONEY_FORMAT_ID = 164;
const MONEY_FORMAT = `[$-id-ID]${AMP}quot;Rp ${AMP}quot;#,##0;${AMP}quot;-Rp ${AMP}quot;#,##0`;
const MONEY_WIDTH = 16;

const STYLE = {
  body: 0,
  bodyMoney: 1,
  zebra: 2,
  zebraMoney: 3,
  header: 4,
  title: 5,
  subtitle: 6,
  total: 7,
  totalMoney: 8
};

// A cell is either a bare value or a value with the two flags that choose its style; both shapes are legal input.

interface SheetCell {
  value?: unknown;
  bold?: boolean;
  money?: boolean;
}

interface SheetDef {
  name?: unknown;
  title?: unknown;
  subtitle?: unknown;
  rows?: unknown[];
}

function sheetName(name: unknown, index: number, taken: Set<string>): string {
  const text = String(name ?? '').trim() || `Sheet${index + 1}`;
  if (text.length > 31) throw new Error(`the sheet name "${text}" is longer than 31 characters; Excel refuses the whole file for one bad name.`);
  if (FORBIDDEN_IN_NAME.test(text)) throw new Error(`the sheet name "${text}" holds a character Excel does not allow in a sheet name.`);
  if (taken.has(text)) throw new Error(`two sheets are named "${text}"; every sheet needs its own name.`);
  taken.add(text);
  return text;
}

// A cell object is the caller's own shape; a bare value is wrapped so every later read has one form.

function cellOf(raw: unknown): SheetCell {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as SheetCell) : { value: raw };
}

function isFilled(cell: SheetCell): boolean {
  return cell.value !== null && cell.value !== undefined && cell.value !== '';
}

function allBold(cells: SheetCell[]): boolean {
  const filled = cells.filter(isFilled);
  return filled.length > 0 && filled.every((cell) => cell.bold === true);
}

function styleFor(cell: SheetCell, role: string): number {
  if (role === 'header') return STYLE.header;
  if (role === 'total') return cell.money === true ? STYLE.totalMoney : STYLE.total;
  if (role === 'zebra') return cell.money === true ? STYLE.zebraMoney : STYLE.zebra;
  return cell.money === true ? STYLE.bodyMoney : STYLE.body;
}

function cellXml(column: number, row: number, cell: SheetCell, style: number): string {
  const address = cellAddress(column, row);
  const styleAttribute = style === STYLE.body ? '' : ` s="${style}"`;
  const value = cell.value;

  if (!isFilled(cell)) return `<c r="${address}"${styleAttribute}/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${address}"${styleAttribute}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${address}"${styleAttribute} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${address}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

// WHY THE WIDTH FOLLOWS THE CONTENT.
// A column wider than its content wastes the page, and a column narrower than its content hides the number behind hashes, so the width is the longest line in the column plus a little air.

function columnWidths(rows: unknown[]): number[] {
  const widths: number[] = [];
  for (const raw of rows) {
    const cells = Array.isArray(raw) ? raw : [];
    cells.forEach((rawCell, index) => {
      const cell = cellOf(rawCell);
      const length = cell.money === true ? MONEY_WIDTH : String(cell.value ?? '').length;
      widths[index] = Math.max(widths[index] ?? 0, length);
    });
  }
  return widths.map((length) => Math.min(Math.max((length ?? 0) + 2, 10), 42));
}

function colsXml(widths: number[]): string {
  if (widths.length === 0) return '';
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  return `<cols>${cols}</cols>`;
}

function sheetXml(sheet: SheetDef): string {
  const rows: unknown[] = Array.isArray(sheet?.rows) ? sheet.rows : [];
  const title = String(sheet?.title ?? '').trim();
  const subtitle = String(sheet?.subtitle ?? '').trim();
  const widths = columnWidths(rows);

  const parts: string[] = [];
  let rowNumber = 0;
  let headerRow: number | null = null;
  let bodyRows = 0;

  const addRow = (cells: string, height: number | null) => {
    rowNumber += 1;
    const heightAttribute = height === null ? '' : ` ht="${height}" customHeight="1"`;
    parts.push(`<row r="${rowNumber}"${heightAttribute}>${cells}</row>`);
  };

  if (title !== '') {
    addRow(cellXml(0, rowNumber + 1, { value: title }, STYLE.title), 24);
  }
  if (subtitle !== '') {
    addRow(cellXml(0, rowNumber + 1, { value: subtitle }, STYLE.subtitle), 16);
  }
  if (title !== '' || subtitle !== '') addRow('', null);

  rows.forEach((raw, index) => {
    const cells = (Array.isArray(raw) ? raw : []).map(cellOf);
    const bold = allBold(cells);
    const role = index === 0 && bold ? 'header' : (bold ? 'total' : (bodyRows % 2 === 1 ? 'zebra' : 'body'));
    if (role === 'header') headerRow = rowNumber + 1;
    if (role === 'body' || role === 'zebra') bodyRows += 1;
    const cellsXml = cells.map((cell, columnIndex) => cellXml(columnIndex, rowNumber + 1, cell, styleFor(cell, role))).join('');
    addRow(cellsXml, role === 'header' ? 20 : null);
  });

  const freeze = headerRow === null
    ? ''
    : `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><sheetPr><tabColor rgb="FF${PALETTE.accent}"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0">${freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml(widths)}<sheetData>${parts.join('')}</sheetData></worksheet>`;
}

function contentTypes(sheets: Array<{ name: string }>): string {
  const overrides = sheets.map((_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="${CONTENT_TYPE}.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CONTENT_TYPE}.styles+xml"/>${overrides}</Types>`;
}

function stylesXml() {
  const fonts = [
    `<font><sz val="11"/><color rgb="FF${PALETTE.ink}"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="11"/><color rgb="FF${PALETTE.ink}"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="11"/><color rgb="FF${PALETTE.white}"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="14"/><color rgb="FF${PALETTE.ink}"/><name val="Calibri"/></font>`,
    `<font><sz val="10"/><color rgb="FF${PALETTE.muted}"/><name val="Calibri"/></font>`
  ].join('');
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${PALETTE.ink}"/><bgColor indexed="64"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${PALETTE.light}"/><bgColor indexed="64"/></patternFill></fill>`
  ].join('');
  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border><left style="thin"><color rgb="FF${PALETTE.border}"/></left><right style="thin"><color rgb="FF${PALETTE.border}"/></right><top style="thin"><color rgb="FF${PALETTE.border}"/></top><bottom style="thin"><color rgb="FF${PALETTE.border}"/></bottom><diagonal/></border>`,
    `<border><left/><right/><top/><bottom style="medium"><color rgb="FF${PALETTE.accent}"/></bottom><diagonal/></border>`,
    `<border><left/><right/><top style="medium"><color rgb="FF${PALETTE.ink}"/></top><bottom/><diagonal/></border>`
  ].join('');
  const xfs = [
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>`,
    `<xf numFmtId="${MONEY_FORMAT_ID}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>`,
    `<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>`,
    `<xf numFmtId="${MONEY_FORMAT_ID}" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>`,
    `<xf numFmtId="0" fontId="2" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>`,
    `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>`,
    `<xf numFmtId="0" fontId="1" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>`,
    `<xf numFmtId="${MONEY_FORMAT_ID}" fontId="1" fillId="3" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>`
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="${MONEY_FORMAT_ID}" formatCode="${MONEY_FORMAT}"/></numFmts><fonts count="5">${fonts}</fonts><fills count="4">${fills}</fills><borders count="4">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

export function buildWorkbook({ sheets = [] }: { sheets?: unknown[] } = {}) {
  const list = Array.isArray(sheets) ? sheets : [];
  if (list.length === 0) throw new Error('a workbook needs at least one sheet.');

  const taken = new Set<string>();
  const named = list.map((value, index) => {
    const sheet = value && typeof value === 'object' ? value as SheetDef : {};
    return { name: sheetName(sheet.name, index, taken), sheet };
  });

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${RELATION}"><sheets>${named.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;

  const workbookRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}">${named.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="${RELATION}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="${RELATION}/styles" Target="styles.xml"/></Relationships>`;

  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes(named) },
    { name: '_rels/.rels', data: root },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelations },
    { name: 'xl/styles.xml', data: stylesXml() }
  ];

  named.forEach((sheet, index) => {
    entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet.sheet) });
  });

  return zipBytes(entries);
}
