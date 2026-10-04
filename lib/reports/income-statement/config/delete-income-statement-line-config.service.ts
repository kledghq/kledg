/**
 * Deletes an income statement line configuration
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'

export async function deleteIncomeStatementLineConfig(
  configId: string
): Promise<void> {
  const existing = await prisma.incomeStatementLineConfig.findUnique({
    where: { id: configId },
  })

  if (!existing) {
    throw new NotFoundError('Configuration introuvable')
  }

  // Soft delete by setting isActive to false
  await prisma.incomeStatementLineConfig.update({
    where: { id: configId },
    data: { isActive: false },
  })
}
