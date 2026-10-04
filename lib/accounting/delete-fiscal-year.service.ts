import { prisma } from '@/lib/prisma'
import { NotFoundError, ConflictError } from '@/lib/accounting/errors'

/**
 * Deletes an open fiscal year if it has no accounting entries. A closed
 * fiscal year is locked and cannot be deleted (see
 * lib/accounting/fiscal-year-closure/lock.ts).
 *
 * @param companyId - Company id
 * @param fiscalYearId - Fiscal year id to delete
 * @throws NotFoundError if fiscal year not found or not belonging to company
 * @throws ConflictError if fiscal year has accounting entries
 */
export async function deleteFiscalYear(
  companyId: string,
  fiscalYearId: string
): Promise<void> {
  const fiscalYear = await prisma.fiscalYear.findFirst({
    where: {
      id: fiscalYearId,
      companyId,
    },
    include: {
      _count: {
        select: { accountingEntries: true },
      },
    },
  })

  if (!fiscalYear) {
    throw new NotFoundError('Exercice introuvable pour cette société.')
  }

  if (fiscalYear.isClosed) {
    throw new ConflictError('Un exercice clôturé ne peut pas être supprimé.')
  }

  if (fiscalYear._count.accountingEntries > 0) {
    throw new ConflictError(
      'Impossible de supprimer un exercice contenant des écritures comptables. ' +
        'Supprimez d\'abord ses écritures.'
    )
  }

  await prisma.fiscalYear.delete({
    where: { id: fiscalYearId },
  })
}
