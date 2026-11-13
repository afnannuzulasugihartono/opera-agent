// @last-edited: 2026-11-05 UTC+7.
// @title: xml - the two helpers every Office part needs: escaping and a cell address.
// @state: one escape for text, one name for a column, both pure.
// @dependencies: none.

// WHY THE ESCAPE COVERS EVERY MARK.
// A cell holding "P&L and <2026>" is normal in a business sheet, and an unescaped ampersand makes the workbook refuse to open.

// WHY A COLUMN NAME IS BUILT BY ARITHMETIC.
// A sheet with more than twenty-six columns is ordinary, so the name has to continue into AA, AB and past.

// WHY THE ENTITIES ARE BUILT FROM CHARACTER CODES.
// The five marks are written as code points so the file holds no literal entity that a reader or a formatter could mistake for markup.

const AMP = String.fromCharCode(38);

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, `${AMP}amp;`)
    .replace(/</g, `${AMP}lt;`)
    .replace(/>/g, `${AMP}gt;`)
    .replace(/"/g, `${AMP}quot;`)
    .replace(/'/g, `${AMP}apos;`);
}

export function columnName(index: number): string {
  let name = '';
  let value = Number(index) || 0;
  do {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return name;
}

export function cellAddress(column: number, row: number): string {
  return `${columnName(column)}${row}`;
}
