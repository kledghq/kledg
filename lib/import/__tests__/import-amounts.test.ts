/**
 * Debit and credit cells of an imported CSV or Excel journal are read in
 * cents, French notation included: parseFloat("1234,56") gave 1234 and the
 * entry was imported with the wrong amount (or refused as unbalanced).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createEntry: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    journal: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { code: string } }) => ({ id: `j-${data.code}` })),
    },
    account: {
      findFirst: vi.fn(async ({ where }: { where: { code: string } }) => ({ id: `a-${where.code}` })),
      create: vi.fn(),
    },
    // No entry imported yet (lib/import/duplicate-entries.ts)
    accountingEntry: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/accounting/fiscal-year-utils', () => ({
  getFiscalYearForDate: vi.fn(async () => ({ id: 'fy', year: 2025 })),
}))
vi.mock('@/lib/accounting/active-fiscal-year.service', () => ({ ensureActiveFiscalYear: vi.fn(async () => ({ id: 'fy' })) }))
vi.mock('@/lib/accounting/services', () => ({
  createAccountingEntry: vi.fn(),
  createAccountingEntryWithWarnings: mocks.createEntry,
}))

import { importAmountCents } from '../amount'
import { importCSV } from '../csv'

describe('importAmountCents', () => {
  it('reads French and international notations', () => {
    expect(importAmountCents('1 234,56')).toBe(123456)
    expect(importAmountCents('1234,56')).toBe(123456)
    expect(importAmountCents('1234.56')).toBe(123456)
    expect(importAmountCents('-12,5')).toBe(-1250)
  })

  it('reads numeric cells, floating point noise of a formula included', () => {
    expect(importAmountCents(0.1 + 0.2)).toBe(30)
    expect(importAmountCents(1500)).toBe(150000)
  })

  it('takes an empty cell as 0', () => {
    expect(importAmountCents('')).toBe(0)
    expect(importAmountCents(undefined)).toBe(0)
    expect(importAmountCents(null)).toBe(0)
  })

  it('refuses what is not an amount with two decimals at most', () => {
    expect(importAmountCents('abc')).toBeNull()
    expect(importAmountCents('10,005')).toBeNull()
    expect(importAmountCents(10.005)).toBeNull()
  })
})

describe('importCSV amounts', () => {
  beforeEach(() => {
    mocks.createEntry.mockReset().mockResolvedValue({ warnings: [] })
  })

  it('imports amounts written with a decimal comma exactly', async () => {
    const csv = [
      'date;journal;entryNumber;account;debit;credit;description',
      '2025-03-01;AC;AC1;606;1234,56;;Achat',
      '2025-03-01;AC;AC1;401;;1234,56;Achat',
    ].join('\n')

    const result = await importCSV({ companyId: 'c', content: csv })

    expect(result.errors).toEqual([])
    expect(result.entriesCreated).toBe(1)
    const lines = mocks.createEntry.mock.calls[0][0].lines
    expect(lines.map((l: { debit: number; credit: number }) => [l.debit, l.credit])).toEqual([
      [1234.56, 0],
      [0, 1234.56],
    ])
  })

  it('refuses an entry with an unreadable amount instead of truncating it', async () => {
    const csv = [
      'date;journal;entryNumber;account;debit;credit;description',
      '2025-03-01;AC;AC2;606;12 euros;;Achat',
      '2025-03-01;AC;AC2;401;;12;Achat',
    ].join('\n')

    const result = await importCSV({ companyId: 'c', content: csv })

    expect(result.entriesCreated).toBe(0)
    expect(result.errors).toEqual(['Écriture AC2: montant invalide (exemple : 1 234,56)'])
    expect(mocks.createEntry).not.toHaveBeenCalled()
  })
})
