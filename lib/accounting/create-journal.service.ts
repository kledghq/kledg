/**
 * Creates a journal of a company. Codes are 2 or 3 letters or digits,
 * upper case (BQ, AC, BQ2), unique per company.
 */

import { prisma } from '@/lib/prisma'
import { ConflictError, ValidationError } from '@/lib/accounting/errors'
import { isValidJournalCode, normalizeJournalCode } from '@/lib/shared/helpers'

export const JOURNAL_CODE_MESSAGE = 'Le code doit contenir 2 à 3 caractères (ex: BQ, AC, BQ2)'

export async function createJournal(companyId: string, input: { code: string; label: string }) {
  const code = normalizeJournalCode(input.code ?? '')
  if (!code) throw new ValidationError('Le code est requis')
  if (!isValidJournalCode(code)) throw new ValidationError(JOURNAL_CODE_MESSAGE)
  const label = input.label?.trim()
  if (!label) throw new ValidationError('Le libellé est requis')
  if (label.length > 255) throw new ValidationError('Le libellé ne doit pas dépasser 255 caractères')

  const existing = await prisma.journal.findUnique({ where: { companyId_code: { companyId, code } }, select: { id: true } })
  if (existing) throw new ConflictError(`Un journal avec le code ${code} existe déjà pour cette société`)

  return prisma.journal.create({ data: { companyId, code, label } })
}
