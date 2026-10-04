/**
 * CSV / formula injection in exports.
 *
 * Any user-controlled cell (asset label, account label, counterparty, entry
 * description) that begins with = + - @ must be neutralised so a spreadsheet
 * does not evaluate it as a formula, and separators/newlines must not break
 * the column layout.
 *
 * - CSV (depreciation export): fixed via lib/reports/csv-safe (KLEDG-SEC-003).
 * - xlsx (ExcelJS): the library stores a plain string as a text cell, not a
 *   formula; pinned here so a future refactor cannot regress it.
 * - FEC (.txt): sanitizeFecField strips separators/control chars; the tax
 *   format forbids an added quote prefix, so formula leaders are left as-is by
 *   design (documented, not neutralised).
 */

import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { buildCsv, buildCsvRow, csvCell } from '@/lib/reports/csv-safe'
import { sanitizeFecField } from '@/lib/fec/format'

const FORMULA_PAYLOADS = [
  '=1+1',
  '=HYPERLINK("http://evil.example","clic")',
  '+1+1',
  '-1+1',
  '@SUM(A1:A9)',
  '=cmd|\'/c calc\'!A1',
  '\t=1+1',
  '\r=1+1',
]

describe('CSV formula injection neutralisation (lib/reports/csv-safe)', () => {
  it.each(FORMULA_PAYLOADS)('prefixes a formula leader: %j', (payload) => {
    const cell = csvCell(payload)
    // Unwrap RFC-4180 quoting (some payloads also contain a quote/newline) to
    // see the value a spreadsheet will display.
    let inner = cell
    if (inner.startsWith('"') && inner.endsWith('"')) inner = inner.slice(1, -1).replaceAll('""', '"')
    expect(inner.startsWith("'")).toBe(true)
    expect(['=', '+', '-', '@', '\t', '\r']).not.toContain(inner[0])
  })

  it('quotes separators, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('Dupont;Martin')).toBe('"Dupont;Martin"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('leaves a plain label untouched', () => {
    expect(csvCell('Ordinateur portable')).toBe('Ordinateur portable')
    expect(csvCell(1234.56)).toBe('1234.56')
    expect(csvCell(null)).toBe('')
  })

  it('builds rows and a document without letting a payload break out', () => {
    const row = buildCsvRow(['=2+5', 'Normal', 'a;b'])
    expect(row).toBe(`'=2+5;Normal;"a;b"`)
    const csv = buildCsv([
      ['Libellé', 'Montant'],
      ['=cmd', '10'],
    ])
    expect(csv).toBe("Libellé;Montant\n'=cmd;10")
  })
})

describe('xlsx (ExcelJS) stores user text as a text cell, not a formula', () => {
  it.each(FORMULA_PAYLOADS)('cell value stays a plain string for %j', async (payload) => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    ws.addRow([payload])
    const cell = ws.getRow(1).getCell(1)
    // A formula cell would expose .formula / be an object; a text cell is the string.
    expect(typeof cell.value).toBe('string')
    expect(cell.value).toBe(payload)
    expect((cell.value as { formula?: string })?.formula).toBeUndefined()
  })
})

describe('FEC field sanitisation (lib/fec/format)', () => {
  it('replaces tabs, newlines, pipes and control characters with a space', () => {
    expect(sanitizeFecField('a\tb')).toBe('a b')
    expect(sanitizeFecField('a\nb\r\nc')).toBe('a b c')
    expect(sanitizeFecField('a|b')).toBe('a b')
    expect(sanitizeFecField('a\u0000b')).toBe('a b')
  })

  it('does not break a column by leaking the FEC tab separator', () => {
    expect(sanitizeFecField('Vente\tfrauduleuse')).not.toContain('\t')
  })
})
