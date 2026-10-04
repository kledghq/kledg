/**
 * Counts of the simple navigation (GET /api/companies/[id]/simple/counts)
 * and of the "À faire" list of the simple home (docs/mode-simple.md).
 *
 * "Dépenses à vérifier" counts the money that left the bank and is not yet
 * classified: debits of the company's bank accounts not reconciled with an
 * entry. A first approximation from the existing reconciliation state; the
 * categorisation of the simple mode (page simple/depenses) refines it.
 */

import { prisma } from '@/lib/prisma'
import { transactionOfCompany } from '@/lib/api/resources'

export interface SimpleCounts {
  /** Bank debits not reconciled yet. */
  expensesToCheck: number
}

export async function countExpensesToCheck(companyId: string): Promise<number> {
  return prisma.bankTransaction.count({ where: { ...transactionOfCompany(companyId), side: 'debit', reconciled: false } })
}

export async function loadSimpleCounts(companyId: string): Promise<SimpleCounts> {
  return { expensesToCheck: await countExpensesToCheck(companyId) }
}
