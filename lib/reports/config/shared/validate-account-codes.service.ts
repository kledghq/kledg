/**
 * Validates that account codes exist and belong to a company
 */

import { prisma } from '@/lib/prisma'
import { ValidationError, NotFoundError } from '@/lib/accounting/errors'
import { logger } from '@/lib/logger'

/**
 * Validates that account codes exist and belong to a company
 * For filterType 'starts_with', validates that at least one account starts with each prefix
 * 
 * @param companyId - Company ID
 * @param accountCodes - Account codes to validate
 * @param filterType - Optional filter type ('starts_with' allows prefix matching)
 * @param strict - If false, allows prefixes even if no accounts match yet (default: false for starts_with, true otherwise)
 * @throws NotFoundError if company doesn't exist
 * @throws ValidationError if any account code doesn't exist or doesn't belong to the company (unless strict=false)
 */
export async function validateAccountCodes(
  companyId: string,
  accountCodes: string[],
  filterType?: string | null,
  strict?: boolean
): Promise<void> {
  // Check if company exists
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  })

  if (!company) {
    throw new NotFoundError('Société introuvable')
  }

  if (accountCodes.length === 0) {
    return
  }

  // Log for debugging
  logger.debug(
    `[Validate Account Codes] companyId: ${companyId}, accountCodes: ${accountCodes.join(', ')}, filterType: ${filterType}, strict: ${strict}`
  )

  // For 'starts_with' filter, we validate that at least one account starts with each prefix
  // By default, we allow prefixes even if no accounts match yet (configurations can be created before accounts)
  if (filterType === 'starts_with') {
    logger.debug(`[Validate Account Codes] Using starts_with validation (non-strict mode)`)
    // If strict validation is not required, allow prefixes even if no accounts exist yet
    // This is useful when configurations are created before accounts are set up
    const isStrict = strict === true

    if (!isStrict) {
      // Non-strict mode: just validate format, allow prefixes that don't exist yet
      // This allows configurations to be created before accounts are created
      return
    }

    // Strict mode: validate that at least one account starts with each prefix
    const allAccounts = await prisma.account.findMany({
      where: {
        companyId,
      },
      select: {
        code: true,
      },
    })

    const allAccountCodes = allAccounts.map((account) => account.code)
    const invalidPrefixes: string[] = []

    for (const prefix of accountCodes) {
      // Check if at least one account starts with this prefix
      const hasMatch = allAccountCodes.some((code) => code.startsWith(prefix))
      if (!hasMatch) {
        invalidPrefixes.push(prefix)
      }
    }

    if (invalidPrefixes.length > 0) {
      throw new ValidationError(
        `Préfixes de comptes inconnus : ${invalidPrefixes.join(', ')}. Aucun compte de la société ne commence par ces préfixes.`
      )
    }

    return
  }

  // For exact match (default behavior), validate that codes exist exactly
  const accounts = await prisma.account.findMany({
    where: {
      companyId,
      code: {
        in: accountCodes,
      },
    },
    select: {
      code: true,
    },
  })

  const validCodes = accounts.map((account) => account.code)
  const invalidCodes = accountCodes.filter((code) => !validCodes.includes(code))

  if (invalidCodes.length > 0) {
    throw new ValidationError(
      `Comptes inconnus : ${invalidCodes.join(', ')}. Créez-les dans le plan comptable de la société ou corrigez les numéros.`
    )
  }
}
