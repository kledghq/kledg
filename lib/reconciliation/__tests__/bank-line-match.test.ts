/**
 * Automatic matching of a bank line with a bank transaction (FEC import and
 * auto-reconcile, one matcher since KLEDG-R3-QUAL-04/18): exact cents,
 * opposite sides, one calendar day on each side that does not move with the
 * server timezone, one transaction per entry.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bankLineCents, matchBankEntries, transactionMatchesBankLine, type CandidateTransaction } from '../bank-line-match'

const ORIGINAL_TZ = process.env.TZ
const ZONES = ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('bankLineCents and transactionMatchesBankLine', () => {
  it('reads the line as debit minus credit in cents, exactly', () => {
    expect(bankLineCents({ debit: 0.1 + 0.2, credit: 0 })).toBe(30)
    expect(bankLineCents({ debit: '0', credit: '1234.56' })).toBe(-123456)
    expect(bankLineCents({ debit: null, credit: undefined })).toBe(0)
  })

  it('matches money in (bank debit) with a credit transaction of the same amount', () => {
    expect(transactionMatchesBankLine(12050, { amount: '120.50', side: 'credit' })).toBe(true)
    expect(transactionMatchesBankLine(12050, { amount: '120.50', side: 'debit' })).toBe(false)
    expect(transactionMatchesBankLine(12050, { amount: '120.51', side: 'credit' })).toBe(false)
    expect(transactionMatchesBankLine(12050, { amount: '120.49', side: 'credit' })).toBe(false)
  })

  it('matches money out (bank credit) with a debit transaction, French side labels included', () => {
    expect(transactionMatchesBankLine(-9999, { amount: '99.99', side: 'debit' })).toBe(true)
    expect(transactionMatchesBankLine(-9999, { amount: '99.99', side: 'Débit' })).toBe(true)
    expect(transactionMatchesBankLine(-9999, { amount: '99.99', side: 'credit' })).toBe(false)
  })

  it('never matches an unreadable amount', () => {
    expect(transactionMatchesBankLine(100, { amount: 'n/a', side: 'credit' })).toBe(false)
  })
})

const tx = (id: string, amount: string, side: 'debit' | 'credit', date: string, ledgerAccountCode: string | null = null): CandidateTransaction => ({
  id,
  amount,
  side,
  date: new Date(date),
  ledgerAccountCode,
})
/** A payment of `amount` on 512000 (money out): 606 debit, 512 credit. */
const payment = (id: string, amount: string, day: string, bank = '512000') => ({
  id,
  date: new Date(`${day}T00:00:00.000Z`),
  lines: [
    { accountCode: '606000', debit: amount, credit: '0' },
    { accountCode: bank, debit: '0', credit: amount },
  ],
})

describe.each(ZONES)('matchBankEntries with TZ=%s', (zone) => {
  beforeEach(() => {
    process.env.TZ = zone
  })

  it('links one transaction per entry when two identical transactions match (KLEDG-R3-QUAL-04)', () => {
    // Two 50 EUR card payments on 1 and 2 March, one 50 EUR bank line on 1 March
    const pairs = matchBankEntries([payment('entry-1', '50.00', '2026-03-01')], [tx('tx-2', '50.00', 'debit', '2026-03-02'), tx('tx-1', '50.00', 'debit', '2026-03-01')])
    expect(pairs).toEqual([{ entryId: 'entry-1', transactionId: 'tx-1' }])
  })

  it('pairs identical entries and transactions one to one', () => {
    const pairs = matchBankEntries(
      [payment('e-a', '50.00', '2026-03-01'), payment('e-b', '50.00', '2026-03-02')],
      [tx('t-1', '50.00', 'debit', '2026-03-01'), tx('t-2', '50.00', 'debit', '2026-03-02'), tx('t-3', '50.00', 'debit', '2026-03-02')],
    )
    expect(pairs).toEqual([
      { entryId: 'e-a', transactionId: 't-1' },
      { entryId: 'e-b', transactionId: 't-2' },
    ])
  })

  it('stays within one calendar day (calendarDayOf of each date)', () => {
    const entry = payment('e', '80.00', '2026-01-01')
    expect(matchBankEntries([entry], [tx('late', '80.00', 'debit', '2026-01-02T10:30:00.000Z')])).toHaveLength(1)
    expect(matchBankEntries([entry], [tx('before', '80.00', 'debit', '2025-12-31T00:00:00.000Z')])).toHaveLength(1)
    expect(matchBankEntries([entry], [tx('far', '80.00', 'debit', '2026-01-03T00:00:00.000Z')])).toEqual([])
    expect(matchBankEntries([entry], [tx('wrong-amount', '80.01', 'debit', '2026-01-01'), tx('wrong-side', '80.00', 'credit', '2026-01-01')])).toEqual([])
  })

  it('only uses the bank account mapped to the line account, or an unmapped one', () => {
    const entry = payment('e', '10.00', '2026-02-01', '512100')
    expect(matchBankEntries([entry], [tx('other', '10.00', 'debit', '2026-02-01', '512200')])).toEqual([])
    expect(matchBankEntries([entry], [tx('mapped', '10.00', 'debit', '2026-02-01', '512100')])).toEqual([{ entryId: 'e', transactionId: 'mapped' }])
    expect(matchBankEntries([entry], [tx('unmapped', '10.00', 'debit', '2026-02-01')])).toEqual([{ entryId: 'e', transactionId: 'unmapped' }])
  })

  it('ignores lines outside class 51 and tries every bank line of the entry', () => {
    const entry = {
      id: 'e',
      date: new Date('2026-04-01T00:00:00.000Z'),
      lines: [
        { accountCode: '411000', debit: '0', credit: '30.00' },
        { accountCode: '512000', debit: '10.00', credit: '0' },
        { accountCode: '512100', debit: '20.00', credit: '0' },
      ],
    }
    expect(matchBankEntries([entry], [tx('t', '30.00', 'credit', '2026-04-01'), tx('t20', '20.00', 'credit', '2026-04-01')])).toEqual([{ entryId: 'e', transactionId: 't20' }])
  })
})
