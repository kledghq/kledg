import { describe, expect, it } from 'vitest'
import {
  bankLineOf,
  checkEntryDate,
  checkVat,
  fiscalYearForDate,
  MESSAGES,
  splitInclusiveAmount,
  validateReconciliation,
  vatOnBase,
  type FiscalYearPeriod,
  type ReconciliationDraft,
  type ReconciliationLine,
} from '../validation'
import { vatIncludedCents } from '@/lib/expense-reports/vat-recovery'

const FY_2025: FiscalYearPeriod = { id: 'fy25', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: true }
const FY_2026: FiscalYearPeriod = { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const fiscalYears = [FY_2025, FY_2026]

const line = (code: string, debit: number | null, credit: number | null = null): ReconciliationLine => ({
  accountId: `acc-${code}`,
  accountCode: code,
  debitCents: debit,
  creditCents: credit,
})

/** A 120,00 € card payment (money out): bank credited. */
const purchase = (lines: ReconciliationLine[], overrides: Partial<ReconciliationDraft> = {}): ReconciliationDraft => ({
  journalId: 'bq',
  date: '2026-03-05',
  transaction: { amountCents: 12000, side: 'debit' },
  lines,
  ...overrides,
})

const validate = (draft: ReconciliationDraft, transactionVatCents?: number | null) =>
  validateReconciliation(draft, { fiscalYears, transactionVatCents })
const messages = (draft: ReconciliationDraft) => validate(draft).errors.map((e) => `${e.path}: ${e.message}`)

describe('VAT split helpers', () => {
  it('splits an amount including VAT so base + VAT is exactly the amount', () => {
    expect(splitInclusiveAmount(12000, 20)).toEqual({ baseCents: 10000, vatCents: 2000 })
    expect(splitInclusiveAmount(10000, 20)).toEqual({ baseCents: 8333, vatCents: 1667 })
    expect(splitInclusiveAmount(10550, 5.5)).toEqual({ baseCents: 10000, vatCents: 550 })
    expect(splitInclusiveAmount(1, 20)).toEqual({ baseCents: 1, vatCents: 0 })
    for (let ttc = 0; ttc < 5000; ttc += 7) {
      for (const rate of [20, 10, 5.5, 2.1]) {
        const { baseCents, vatCents } = splitInclusiveAmount(ttc, rate)
        expect(baseCents + vatCents).toBe(ttc)
        // The VAT is the VAT of the base, give or take a rounding cent
        expect(Math.abs(vatCents - vatOnBase(baseCents, rate))).toBeLessThanOrEqual(1)
      }
    }
  })

  it('computes VAT on a base, half up', () => {
    expect(vatOnBase(10000, 20)).toBe(2000)
    expect(vatOnBase(1003, 20)).toBe(201) // 200,6
    expect(vatOnBase(1002, 20)).toBe(200) // 200,4
    expect(vatOnBase(10000, 5.5)).toBe(550)
  })

  // R3 QUAL-21: one rounding rule for the VAT inside a TTC amount, negatives handled
  it('rounds the VAT inside a TTC amount as simple mode and the expense reports do', () => {
    // 10,05 € TTC at 20 %: 1,675 € of VAT, rounded half away from zero to 1,68 € everywhere
    expect(splitInclusiveAmount(1_005, 20)).toEqual({ baseCents: 837, vatCents: 168 })
    expect(vatIncludedCents(1_005, 2000)).toBe(168)
    for (let ttc = 0; ttc < 5000; ttc += 3) {
      for (const rate of [20, 10, 5.5, 2.1]) {
        expect(splitInclusiveAmount(ttc, rate).vatCents).toBe(vatIncludedCents(ttc, Math.round(rate * 100)))
      }
    }
  })

  it('splits a negative TTC as the opposite of the positive one, half away from zero', () => {
    // -1,20 € TTC at 20 %: base -1,00 €, VAT -0,20 €
    expect(splitInclusiveAmount(-120, 20)).toEqual({ baseCents: -100, vatCents: -20 })
    expect(splitInclusiveAmount(-1_005, 20)).toEqual({ baseCents: -837, vatCents: -168 })
    // VAT on -0,50 € at 20 %: -0,10 €
    expect(vatOnBase(-50, 20)).toBe(-10)
    expect(vatOnBase(-1_003, 20)).toBe(-201)
    expect(vatIncludedCents(-1_005, 2000)).toBe(-168)
  })
})

describe('bank line', () => {
  it('credits the bank for money out and debits it for money in', () => {
    expect(bankLineOf({ amountCents: 12000, side: 'debit' })).toEqual({ debitCents: 0, creditCents: 12000 })
    expect(bankLineOf({ amountCents: 12000, side: 'credit' })).toEqual({ debitCents: 12000, creditCents: 0 })
    // Some providers store outflows as negative amounts
    expect(bankLineOf({ amountCents: -12000, side: 'debit' })).toEqual({ debitCents: 0, creditCents: 12000 })
  })
})

describe('validateReconciliation', () => {
  it('accepts a balanced purchase with VAT', () => {
    const result = validate(purchase([line('606100', 10000), line('445660', 2000)]))
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.totals).toEqual({ debitCents: 12000, creditCents: 12000, differenceCents: 0 })
    expect(result.fiscalYear?.id).toBe('fy26')
  })

  it('accepts a customer payment (money in) credited to 411', () => {
    const draft = purchase([line('411000', null, 50000)], { transaction: { amountCents: 50000, side: 'credit' } })
    expect(validate(draft).valid).toBe(true)
  })

  it('requires an account on every line', () => {
    const draft = purchase([{ ...line('606100', 12000), accountId: '' }])
    expect(messages(draft)).toContain(`lines.0.account: ${MESSAGES.account}`)
  })

  it('requires the entry to balance against the bank amount, to the cent', () => {
    const errors = messages(purchase([line('606100', 11999)]))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^lines: L'écriture n'est pas équilibrée/)
    expect(errors[0]).toMatch(/écart 0,01/)
  })

  it('is exact where float sums drift (0,10 + 0,20 = 0,30)', () => {
    const draft = purchase([line('606100', 10), line('606200', 20)], { transaction: { amountCents: 30, side: 'debit' } })
    expect(validate(draft).valid).toBe(true)
  })

  it('refuses lines without amount, with both sides, or negative', () => {
    expect(messages(purchase([line('606100', 12000), line('606200', null)]))).toContain(
      `lines.1.amount: ${MESSAGES.amountMissing}`,
    )
    expect(messages(purchase([line('606100', 12000, 5)]))).toContain(`lines.0.amount: ${MESSAGES.amountBoth}`)
    expect(messages(purchase([line('606100', -100)]))).toContain(`lines.0.amount: ${MESSAGES.amountNegative}`)
    expect(messages(purchase([line('606100', 0.5)]))).toContain(`lines.0.amount: ${MESSAGES.amountNegative}`)
  })

  it('needs at least one counterpart line', () => {
    expect(messages(purchase([]))).toEqual([`lines: ${MESSAGES.noLines}`])
  })

  it('needs a journal', () => {
    expect(messages(purchase([line('606100', 12000)], { journalId: '' }))).toEqual([`journalId: ${MESSAGES.journal}`])
  })

  describe('date', () => {
    it('refuses an invalid date', () => {
      expect(messages(purchase([line('606100', 12000)], { date: '2026-02-30' }))).toEqual([`date: ${MESSAGES.date}`])
      expect(messages(purchase([line('606100', 12000)], { date: '05/03/2026' }))).toEqual([`date: ${MESSAGES.date}`])
    })

    it('refuses a date in a closed fiscal year', () => {
      expect(messages(purchase([line('606100', 12000)], { date: '2025-12-31' }))).toEqual([
        "date: L'exercice 2025 est clôturé : choisissez une date dans un exercice ouvert.",
      ])
    })

    it('refuses a date outside every fiscal year', () => {
      expect(messages(purchase([line('606100', 12000)], { date: '2027-01-01' }))).toEqual([
        "date: Aucun exercice comptable ne couvre le 01/01/2027 : créez l'exercice avant de rapprocher.",
      ])
    })

    it('includes both bounds of the fiscal year', () => {
      expect(fiscalYearForDate(fiscalYears, '2026-01-01')?.id).toBe('fy26')
      expect(fiscalYearForDate(fiscalYears, '2026-12-31')?.id).toBe('fy26')
      expect(checkEntryDate(fiscalYears, '2026-12-31').error).toBeNull()
    })
  })

  describe('VAT', () => {
    it('refuses VAT without a tax-free base line', () => {
      expect(messages(purchase([line('445660', 12000)]))).toEqual([`lines: ${MESSAGES.vatWithoutBase}`])
    })

    it('refuses VAT above 20 % of the base', () => {
      const errors = messages(purchase([line('606100', 9000), line('445660', 3000)]))
      expect(errors).toEqual([
        expect.stringMatching(/^lines: La TVA \(30,00\s€\) dépasse 20 % de la base hors taxe \(90,00\s€\)/),
      ])
    })

    it('allows one cent of rounding per VAT line', () => {
      // 100,04 HT at 20 % = 20,008: 20,01 is a correct rounding
      const draft = purchase([line('606100', 10004), line('445660', 2001)], { transaction: { amountCents: 12005, side: 'debit' } })
      expect(validate(draft).valid).toBe(true)
    })

    it('accepts mixed rates (10 % and 20 %) and partial deduction', () => {
      const mixed = purchase([line('625700', 5000), line('606300', 5000), line('445660', 1500)], {
        transaction: { amountCents: 11500, side: 'debit' },
      })
      expect(validate(mixed).valid).toBe(true)
    })

    it('checks collected VAT on sales the same way', () => {
      const sale = (vat: number) =>
        purchase([line('706000', null, 10000), line('445710', null, vat)], {
          transaction: { amountCents: 10000 + vat, side: 'credit' },
        })
      expect(validate(sale(2000)).valid).toBe(true)
      expect(validate(sale(2500)).valid).toBe(false)
    })

    it('accepts a refund (VAT on the other side)', () => {
      const refund = purchase([line('606100', null, 10000), line('445660', null, 2000)], {
        transaction: { amountCents: 12000, side: 'credit' },
      })
      expect(validate(refund).valid).toBe(true)
    })

    it('accepts an intra-EU purchase with self-assessed VAT', () => {
      const intracom = purchase([line('607000', 12000), line('445662', 2400), line('445200', null, 2400)])
      expect(validate(intracom).valid).toBe(true)
    })

    it('does not treat VAT settlements as taxed operations', () => {
      const payment = purchase([line('445510', 12000)])
      expect(validate(payment).valid).toBe(true)
      expect(checkVat([line('445670', null, 500)]).errors).toEqual([])
    })

    it('warns, without blocking, when the VAT differs from the VAT detected by the bank', () => {
      const result = validate(purchase([line('606100', 10000), line('445660', 2000)]), 1800)
      expect(result.valid).toBe(true)
      expect(result.warnings[0]?.message).toMatch(/diffère de la TVA détectée par la banque/)
      expect(validate(purchase([line('606100', 10000), line('445660', 2000)]), 2000).warnings).toEqual([])
    })
  })
})
