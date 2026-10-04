/**
 * Automatic matching of a bank line with a bank transaction (FEC import and
 * auto-reconcile): exact cents, opposite sides, a window of one calendar day
 * on each side that does not move with the server timezone.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  accountFindFirst: vi.fn(),
  accountFindUnique: vi.fn(),
  bankAccountFindMany: vi.fn(),
  transactionFindMany: vi.fn(),
  transactionUpdate: vi.fn(),
  transactionUpdateMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    account: { findFirst: mocks.accountFindFirst, findUnique: mocks.accountFindUnique },
    bankAccount: { findMany: mocks.bankAccountFindMany },
    bankTransaction: {
      findMany: mocks.transactionFindMany,
      update: mocks.transactionUpdate,
      updateMany: mocks.transactionUpdateMany,
    },
  },
}))

import { bankLineCents, reconciliationWindow, transactionMatchesBankLine } from '../bank-line-match'
import { attemptBankReconciliation as reconcileFromImport } from '@/lib/import/fec/reconciliation'
import { attemptBankReconciliation as reconcileFromService } from '@/lib/services/banking/reconciliation-service'

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

describe.each(ZONES)('reconciliation window with TZ=%s', (zone) => {
  beforeEach(() => {
    process.env.TZ = zone
    for (const mock of Object.values(mocks)) mock.mockReset()
  })

  it('spans the day before and the day after, at midnight UTC', () => {
    const { gte, lte } = reconciliationWindow(new Date('2026-03-01T00:00:00.000Z'))
    expect(gte.toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(lte.toISOString()).toBe('2026-03-02T00:00:00.000Z')
    const leap = reconciliationWindow(new Date('2028-03-01T00:00:00.000Z'))
    expect(leap.gte.toISOString()).toBe('2028-02-29T00:00:00.000Z')
  })

  it.each([
    ['FEC import', reconcileFromImport],
    ['auto-reconcile', reconcileFromService],
  ])('%s searches the window and links the matching transaction', async (_name, reconcile) => {
    const account = { id: 'acc-512', code: '512000' }
    mocks.accountFindFirst.mockResolvedValue(account)
    mocks.accountFindUnique.mockResolvedValue(account)
    mocks.bankAccountFindMany.mockResolvedValue([{ id: 'bank-1' }])
    mocks.transactionFindMany.mockResolvedValue([
      { id: 'tx-wrong-amount', amount: '80.01', side: 'debit' },
      { id: 'tx-ok', amount: '80.00', side: 'debit' },
    ])
    mocks.transactionUpdate.mockResolvedValue({})
    mocks.transactionUpdateMany.mockResolvedValue({ count: 1 })

    await reconcile(
      'company-1',
      'entry-1',
      [
        { accountId: 'acc-512', debit: 0, credit: 80 },
        { accountId: 'acc-606', debit: 80, credit: 0 },
      ],
      new Date('2026-01-01T00:00:00.000Z'),
    )

    const where = mocks.transactionFindMany.mock.calls[0][0].where
    expect(where.date.gte.toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(where.date.lte.toISOString()).toBe('2026-01-02T00:00:00.000Z')
    const linked = [...mocks.transactionUpdate.mock.calls, ...mocks.transactionUpdateMany.mock.calls].map(
      ([args]) => args.where.id,
    )
    expect(linked).toEqual(['tx-ok'])
  })
})
