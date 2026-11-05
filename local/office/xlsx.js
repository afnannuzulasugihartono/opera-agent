// @last-edited: 2026-11-05 UTC+7.
// @title: xlsx - a workbook Excel opens: named sheets, numbers that stay numbers, and a ledger of where each figure came from.
// @state: sheets in, one workbook out, and nothing on a sheet that was not put there.
// @dependencies: ./zip.js, ./xml.js.

// WHY THE CELLS HOLD NUMBERS AND NOT TEXT.
// A bookkeeper opens the total, adds it to another sheet, and expects it to be a number.
// Money written as "Rp 1.250.000" is a sentence in a spreadsheet, and every formula that touches it fails.

// WHY THE FILL AND THE FONT ARE DECLARED.
// Excel refuses a workbook whose styles part is missing, and it fills the missing fonts with its own idea of a typeface.

// WHY THE SHEET NAME IS CHECKED.
// Excel forbids a name longer than thirty-one characters or one holding a bracket, a colon or a slash, and it refuses the whole file when it finds one.

import { zipBytes } from './zip.js';
import { cellAddress, escapeXml } from './xml.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATION = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATION = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

const AMP = String.fromCharCode(38);
const QUOT = String.fromCharCode(34);

const FORBIDDEN_IN_NAME = /[[\]:*?/\\]/;

const STYLE_NORMAL = 0;
const STYLE_BOLD = 1;
const STYLE_MONEY = 2;
const STYLE_BOLD_MONEY = 3;

function styleOf(cell) {
  const bold = cell.bold === true;
  const money = cell.money === true;
  if (bold && money) return STYLE_BOLD_MONEY;
  if (bold) return STYLE_BOLD;
  if (money) return STYLE_MONEY;
  return STYLE_NORMAL;
}

function sheetName(name, index, taken) {
  const text = String(name ?? '').trim() || `Sheet${index + 1}`;
  if (text.length > 31) throw new Error(`the sheet name "${text}" is longer than 31 characters; Excel refuses the whole file for one bad name.`);
  if (FORBIDDEN_IN_NAME.test(text)) throw new Error(`the sheet name "${text}" holds a character Excel does not allow in a sheet name.`);
  if (taken.has(text)) throw new Error(`two sheets are named "${text}"; every sheet needs its own name.`);
  taken.add(text);
  return text;
}

function cellXml(column, row, cell) {
  const address = cellAddress(column, row);
  const style = styleOf(cell);
  const styleAttribute = style === STYLE_NORMAL ? '' : ` s="${style}"`;
  const value = cell.value;

  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${address}"${styleAttribute}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${address}"${styleAttribute} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${address}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const cells = (Array.isArray(row) ? row : [])
      .map((raw, columnIndex) => {
        const cell = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { value: raw };
        return cellXml(columnIndex, rowIndex + 1, cell);
      })
      .join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><sheetData>${body}</sheetData></worksheet>`;
}

function contentTypes(sheets) {
  const overrides = sheets.map((sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="${CONTENT_TYPE}.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CONTENT_TYPE}.styles+xml"/>${overrides}</Types>`;
}

function stylesXml() {
  const moneyFormat = `${AMP}quot;Rp ${AMP}quot;#,##0;${AMP}quot;-Rp ${AMP}quot;#,##0`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="${moneyFormat}"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

export function buildWorkbook({ sheets = [] } = {}) {
  const list = Array.isArray(sheets) ? sheets : [];
  if (list.length === 0) throw new Error('a workbook needs at least one sheet.');

  const taken = new Set();
  const named = list.map((sheet, index) => ({ name: sheetName(sheet?.name, index, taken), rows: sheet?.rows ?? [] }));

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${RELATION}"><sheets>${named.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;

  const workbookRelations = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}">${named.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="${RELATION}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="${RELATION}/styles" Target="styles.xml"/></Relationships>`;

  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATION}"><Relationship Id="rId1" Type="${RELATION}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes(named) },
    { name: '_rels/.rels', data: root },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelations },
    { name: 'xl/styles.xml', data: stylesXml() }
  ];

  named.forEach((sheet, index) => {
    entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet.rows) });
  });

  return zipBytes(entries);
}
