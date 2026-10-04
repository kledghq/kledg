/**
 * CSV output that is safe to open in a spreadsheet.
 *
 * Two problems, both fixed here:
 * - Formula injection: a cell whose first character is = + - @ (or a tab /
 *   carriage return that a spreadsheet trims to one of those) is treated as a
 *   formula by Excel, LibreOffice and Google Sheets. We prefix such a cell
 *   with a single quote so it is shown as text.
 * - Delimiter / newline breakage: a cell containing the separator, a double
 *   quote or a newline is wrapped in double quotes (RFC 4180), with internal
 *   quotes doubled.
 *
 * Pure module (no imports): usable from client components and the server.
 */

const FORMULA_LEADERS = new Set(['=', '+', '-', '@', '\t', '\r'])
/** A negative amount ("-1234,56", "-12.5"): a spreadsheet reads it as a number, never as a formula. */
const NEGATIVE_NUMBER = /^-\d+(?:[.,]\d+)?$/

/** Neutralises one cell value for CSV output. */
export function csvCell(value: string | number | null | undefined, separator = ';'): string {
  let cell = value == null ? '' : String(value)
  if (cell.length > 0 && FORMULA_LEADERS.has(cell[0]!) && !NEGATIVE_NUMBER.test(cell)) cell = `'${cell}`
  if (cell.includes(separator) || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
    cell = `"${cell.replaceAll('"', '""')}"`
  }
  return cell
}

/** A CSV row from already-ordered cells. */
export function buildCsvRow(cells: Array<string | number | null | undefined>, separator = ';'): string {
  return cells.map((cell) => csvCell(cell, separator)).join(separator)
}

/** A full CSV document (no trailing newline). The caller adds a BOM if needed. */
export function buildCsv(rows: Array<Array<string | number | null | undefined>>, separator = ';'): string {
  return rows.map((row) => buildCsvRow(row, separator)).join('\n')
}
