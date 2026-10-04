/**
 * Report arithmetic in cents: subtotals, variations, spreadsheet cells and
 * the balance checks never add euros as floating point numbers.
 *
 * Rounding rule: to the nearest cent, a half cent away from zero, as
 * Regulation (EC) No 1103/97, art. 5 sets for amounts in euros (rounded to
 * the nearest cent, an exact half rounded up).
 */

import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { addEuros, roundEuros, subtractEuros } from '../amounts'
import { buildBalanceSheet, validateBalanceSheetBalance, type BalanceSheetRule } from '../statements/balance-sheet'
import type { AccountTotals } from '../statements/allocation'
import { generateJournalExcel } from '../journal/generate-excel-export.service'
import type { JournalReportData } from '../journal/get-journal-report.service'

describe('report amount helpers', () => {
  it('adds and subtracts in cents', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(addEuros(0.1, 0.2)).toBe(0.3)
    expect(subtractEuros(0.3, 0.1)).toBe(0.2)
    expect(subtractEuros(1000, 999.99)).toBe(0.01)
  })

  it('rounds half a cent away from zero (Regulation (EC) 1103/97, art. 5)', () => {
    expect(roundEuros(1.005)).toBe(1.01)
    expect(roundEuros(2.675)).toBe(2.68) // 2.675 is 2.67499999... as a double
    expect(roundEuros(-1.005)).toBe(-1.01)
    expect(roundEuros(1.004)).toBe(1)
    expect(roundEuros(1234567.891)).toBe(1234567.89)
  })
})

describe('balance sheet subtotals', () => {
  const acc = (code: string, debitCents: number, creditCents = 0): AccountTotals => ({
    accountId: `id-${code}`,
    code,
    label: code,
    debitCents,
    creditCents,
  })
  const rule = (id: string, section: 'actif' | 'passif', accountCodes: string[], extra: Partial<BalanceSheetRule> = {}): BalanceSheetRule => ({
    id,
    lineLabel: id,
    section,
    lineType: 'line',
    accountCodes,
    excludedAccountCodes: [],
    amortissementAccountCodes: [],
    balanceType: section === 'actif' ? 'debit' : 'credit',
    displayType: 'net',
    order: 0,
    ...extra,
  })

  const rules: BalanceSheetRule[] = [
    rule('creances', 'actif', [], { lineType: 'group' }),
    rule('clients', 'actif', ['411'], { parentId: 'creances', order: 1 }),
    rule('autres', 'actif', ['467'], { parentId: 'creances', order: 2 }),
    rule('actif-immobilise', 'actif', [], { lineType: 'group' }),
    rule('immo', 'actif', ['21'], {
      parentId: 'actif-immobilise',
      amortissementAccountCodes: ['281'],
      displayType: 'brut_amort_net',
    }),
    rule('dispo', 'actif', ['51'], { parentId: 'actif-immobilise', order: 3 }),
    rule('capital', 'passif', ['10']),
  ]

  const sheet = buildBalanceSheet({
    companyId: 'c',
    fiscalYearId: 'fy',
    reportVariant: 'complete',
    rules,
    accounts: [
      acc('411', 10),
      acc('467', 20),
      acc('2154', 30),
      acc('28154', 0, 10),
      acc('512', 10),
      acc('101', 0, 60),
    ],
  })
  const line = (id: string) => sheet.actif.lines.find((l) => l.id === id)!

  it('sums the children of a line in cents (10 + 20 cents is 0.30, not 0.30000000000000004)', () => {
    expect(line('creances').net).toBe(0.3)
    expect(line('creances').brut).toBeUndefined()
  })

  it('carries gross and depreciation up when a child shows them, net for the others', () => {
    // immo: brut 0.30, amort 0.10, net 0.20; dispo: net 0.10 counted as gross
    expect(line('actif-immobilise').net).toBe(0.3)
    expect(line('actif-immobilise').brut).toBe(0.4)
    expect(line('actif-immobilise').amortissements).toBe(0.1)
  })

  it('balances to the cent', () => {
    expect(sheet.actifTotal).toBe(0.6)
    expect(sheet.passifTotal).toBe(0.6)
    expect(validateBalanceSheetBalance(sheet)).toEqual({ isValid: true })
  })
})

describe('validateBalanceSheetBalance', () => {
  it('compares totals in cents and writes the difference the French way', () => {
    expect(validateBalanceSheetBalance({ actifTotal: 0.1 + 0.2, passifTotal: 0.3 })).toEqual({ isValid: true })
    expect(validateBalanceSheetBalance({ actifTotal: 1234.56, passifTotal: 1234.5 })).toEqual({
      isValid: false,
      imbalance: 0.06,
      error: "Le bilan n'est pas équilibré : écart de 0,06 € (Actif : 1 234,56 €, Passif : 1 234,50 €)",
    })
  })
})

describe.each(['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC'])('journal spreadsheet with TZ=%s', (zone) => {
  it('writes the calendar day of each entry and amounts to the cent', async () => {
    const original = process.env.TZ
    process.env.TZ = zone
    try {
      const data: JournalReportData = {
        journals: [
          {
            journal: { id: 'j', code: 'BQ', label: 'Banque' },
            entries: [
              {
                id: 'e1',
                entryNumber: 'BQ-1',
                date: '2025-12-31T00:00:00.000Z',
                description: 'Frais',
                reference: null,
                totalDebit: 0.3,
                totalCredit: 0.3,
                lines: [
                  { id: 'l1', accountCode: '627', accountLabel: 'Frais', description: null, debit: 0.1 + 0.2, credit: 0 },
                  { id: 'l2', accountCode: '512', accountLabel: 'Banque', description: null, debit: 0, credit: 0.3 },
                ],
              },
            ],
            totals: { debit: 0.3, credit: 0.3 },
          },
        ],
        grandTotals: { debit: 0.3, credit: 0.3 },
      } as unknown as JournalReportData

      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load((await generateJournalExcel(data)) as unknown as ArrayBuffer)
      const row = workbook.getWorksheet('Journal')!.getRow(3)
      expect(row.getCell(2).value).toBe('31/12/2025')
      expect(row.getCell(9).value).toBe(0.3)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
})
