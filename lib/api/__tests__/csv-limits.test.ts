/**
 * CSV uploads are bounded before Papa Parse builds every row in memory
 * (code review: ten million short lines took 1.6 GB of heap, enough to stop
 * the server for every company): the accounting import keeps the Excel row
 * limit, the bank statement import its own, and both a cell budget.
 */

import { describe, expect, it } from 'vitest'
import { assertCsvWithinLimits, MAX_CSV_CELLS } from '../files'
import { parseCSV } from '@/lib/import/csv'
import { ACCOUNTING_IMPORT_MAX_ROWS } from '@/lib/import/excel'
import { splitCsv } from '@/lib/banking/import/tabular'
import { STATEMENT_MAX_ROWS } from '@/lib/banking/import/limits'

describe('CSV limits', () => {
  it('refuses the accounting CSV over the Excel row limit, before parsing', () => {
    const text = 'a\n' + 'x\n'.repeat(ACCOUNTING_IMPORT_MAX_ROWS + 1)
    const started = Date.now()
    expect(() => parseCSV(text)).toThrow(/Fichier trop long/)
    // Counted, not parsed: well under a second
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('refuses the bank statement CSV over its row limit (the review case: "a;b" repeated)', () => {
    expect(() => splitCsv('a;b\n'.repeat(STATEMENT_MAX_ROWS + 2))).toThrow(/Fichier trop long/)
  })

  it('refuses a file with too many cells even on few lines', () => {
    expect(() => assertCsvWithinLimits(';'.repeat(MAX_CSV_CELLS), 100)).toThrow(/cellules au plus/)
  })

  it('accepts an ordinary file at the limit', () => {
    const rows = ['Date;Libellé;Montant', ...Array.from({ length: 1000 }, (_, i) => `01/03/2026;Ligne ${i};-1,00`)]
    expect(splitCsv(rows.join('\n')).rows).toHaveLength(1001)
    expect(() => assertCsvWithinLimits('x\n'.repeat(STATEMENT_MAX_ROWS - 1), STATEMENT_MAX_ROWS)).not.toThrow()
  })
})
