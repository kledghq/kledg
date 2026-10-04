/**
 * Pending tasks of a company shown by the tasks indicator of the header
 * (GET /api/tasks/count): bank transactions still to reconcile.
 */

import { prisma } from '@/lib/prisma'
import { transactionOfCompany } from '@/lib/api/resources'

export interface TasksCount {
  unreconciledTransactions: number
  totalTasks: number
}

export async function countCompanyTasks(companyId: string): Promise<TasksCount> {
  const unreconciledTransactions = await prisma.bankTransaction.count({
    where: { ...transactionOfCompany(companyId), reconciled: false },
  })
  return { unreconciledTransactions, totalTasks: unreconciledTransactions }
}
