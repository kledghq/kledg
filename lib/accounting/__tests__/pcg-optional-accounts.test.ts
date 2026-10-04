/**
 * Which PCG accounts a new chart gets without the optional accounts: class 8
 * and detailed accounts (more than 4 digits) are optional, except the VAT
 * accounts Kledg posts to itself (invoices, expense reports). Without them, a
 * company created through the wizard could not post an invoice or an expense
 * report with recoverable VAT.
 */

import { describe, expect, it } from 'vitest'
import { KLEDG_POSTING_ACCOUNTS, PCG_ACCOUNTS, isOptionalPcgAccount } from '@/lib/accounting/pcg-data'

describe('optional PCG accounts', () => {
  it('keeps the VAT accounts Kledg posts to in every chart', () => {
    for (const code of ['44562', '44566', '44571']) expect(isOptionalPcgAccount(code), code).toBe(false)
  })

  it('keeps the other detailed accounts and class 8 optional', () => {
    expect(isOptionalPcgAccount('44567')).toBe(true)
    expect(isOptionalPcgAccount('5121')).toBe(false)
    expect(isOptionalPcgAccount('80')).toBe(true)
    expect(isOptionalPcgAccount('401')).toBe(false)
  })

  it('only lists accounts of the nomenclature, whose parents are seeded too', () => {
    const byCode = new Map(PCG_ACCOUNTS.map((a) => [a.code, a]))
    for (const code of KLEDG_POSTING_ACCOUNTS) {
      const account = byCode.get(code)
      expect(account, code).toBeDefined()
      expect(isOptionalPcgAccount(account?.parentCode ?? ''), `parent of ${code}`).toBe(false)
    }
  })
})
