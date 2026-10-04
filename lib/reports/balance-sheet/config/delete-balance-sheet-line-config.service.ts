/**
 * Deletes a balance sheet line configuration
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'

/**
 * Deletes a balance sheet line configuration
 * 
 * @param configId - Configuration ID
 * @param companyId - Company ID (for validation)
 */
export async function deleteBalanceSheetLineConfig(
  configId: string,
  companyId: string
): Promise<void> {
  // Get existing configuration
  const existing = await prisma.balanceSheetLineConfig.findUnique({
    where: { id: configId },
  })

  // A line of another company is not confirmed: 404 like a missing one.
  if (!existing || existing.companyId !== companyId) {
    throw new NotFoundError('Configuration introuvable')
  }

  // Delete the configuration (cascade will delete history)
  await prisma.balanceSheetLineConfig.delete({
    where: { id: configId },
  })
}
