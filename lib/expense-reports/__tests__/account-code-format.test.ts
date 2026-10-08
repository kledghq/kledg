/**
 * KLEDG-R3-QUAL-27: the expense line and VAT deduction forms accept the one
 * account number format of lib/accounting/account-code.ts, restricted to
 * their class.
 */

import { describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  // The VAT deduction service imports the Prisma client and Better Auth; no query runs here.
  process.env.DATABASE_URL ??= process.env.KLEDG_TEST_DATABASE_URL ?? 'postgresql://kledg:kledg@localhost:55432/postgres'
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
})
import { isExpenseAccountCode } from '@/lib/expense-reports/categories'
import { revenueAccountCode } from '@/lib/vat-deduction/save-vat-deduction.service'
import { isAccountCode } from '@/lib/accounting/account-code'

describe('one account number format', () => {
  it('an expense line takes a class 6 account of three characters or more', () => {
    for (const code of ['625', '6251', '62510000', '6251A', '625100000001']) {
      expect(isExpenseAccountCode(code), code).toBe(true)
      expect(isAccountCode(code), code).toBe(true)
    }
    for (const code of ['6', '62', '706', '6251a', ' 6251', '625-1', '6'.padEnd(21, '1')]) expect(isExpenseAccountCode(code), code).toBe(false)
  })

  it('the VAT deduction settings take a class 7 account in the same format', () => {
    for (const code of ['70', '706', '7061', '706100000001', '7061A']) expect(revenueAccountCode.safeParse(code).success, code).toBe(true)
    for (const code of ['7', '606', '7061a', '7'.padEnd(21, '0'), '']) expect(revenueAccountCode.safeParse(code).success, code).toBe(false)
    expect(revenueAccountCode.parse(' 706 ')).toBe('706')
  })
})
