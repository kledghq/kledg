/**
 * Accounts of an imported CSV or Excel journal, in the fiscal year of each
 * entry. Accounts belong to a fiscal year and an entry takes all its
 * accounts in the fiscal year holding its date (lib/accounting/entry-guards.ts),
 * so a journal of an earlier open year, or one spanning two years, gets the
 * accounts of each entry's own year. A code the year lacks is created with
 * the code as label.
 */

import { prisma } from '@/lib/prisma'
import { getFiscalYearForDate, getOrCreateActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'

export interface JournalAccounts {
  /** The fiscal year holding the date, else the open one (the entry is then refused with the date's reason). */
  fiscalYearId(date: Date): Promise<string>
  /** Id of the account `code` of the fiscal year, created when missing; '' for an empty code. */
  accountId(fiscalYearId: string, code: string): Promise<string>
}

export function journalAccounts(companyId: string, counters: { accountsCreated: number }): JournalAccounts {
  const ids = new Map<string, string>()
  return {
    async fiscalYearId(date) {
      const fiscalYear = await getFiscalYearForDate(companyId, date)
      return fiscalYear?.id ?? (await getOrCreateActiveFiscalYear(companyId)).id
    },
    async accountId(fiscalYearId, code) {
      if (!code) return ''
      const key = `${fiscalYearId}:${code}`
      const known = ids.get(key)
      if (known) return known
      let account = await prisma.account.findFirst({ where: { companyId, code, fiscalYearId }, select: { id: true } })
      if (!account) {
        account = await prisma.account.create({ data: { companyId, code, label: code, fiscalYearId }, select: { id: true } })
        counters.accountsCreated++
      }
      ids.set(key, account.id)
      return account.id
    },
  }
}
