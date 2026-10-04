/**
 * `accept` values of the import file pickers. Extensions alone are not enough
 * on phones: Android file pickers filter by media type, and iOS greys out a
 * file whose type it cannot match. Each list names the extensions and the
 * media types the same files usually carry; the server still detects the
 * format from the content.
 */

const CSV = ['.csv', 'text/csv', 'application/csv', 'application/vnd.ms-excel']
const TEXT = ['.txt', 'text/plain']
const TSV = ['.tsv', 'text/tab-separated-values']
const XLSX = ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
const XLS = ['.xls', 'application/vnd.ms-excel']
const OFX = ['.ofx', '.qfx', 'application/x-ofx', 'application/ofx', 'application/vnd.intu.qfx']
const XML = ['.xml', 'application/xml', 'text/xml']

const join = (...groups: string[][]) => [...new Set(groups.flat())].join(',')

/** Bank statements: CSV, text, Excel, OFX/QFX, camt.053 (XML). */
export const STATEMENT_FILE_ACCEPT = join(CSV, TEXT, TSV, XLSX, OFX, XML)

/** Accounting imports by file type: FEC (text), CSV or Excel. */
export function accountingImportAccept(type: 'fec' | 'csv' | 'excel'): string {
  if (type === 'fec') return join(['.fec'], TEXT)
  if (type === 'csv') return join(CSV)
  return join(XLSX, XLS)
}
