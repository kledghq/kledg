/**
 * Creates an account in the chart of a fiscal year (accounts are per fiscal
 * year). A new account is a subdivision of an existing one (PCG art. 932-1:
 * the chart can be subdivided as needed): its code starts with the parent's
 * code, it belongs to the same fiscal year and keeps the parent's nomenclature
 * (PCG or not).
 */

import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { validateAccountCode } from '@/lib/accounting/validator'
import { ensureActiveFiscalYear } from '@/lib/accounting/active-fiscal-year.service'

export interface CreateAccountInput {
  code: string
  label: string
  parentId: string
  /** The active fiscal year by default. */
  fiscalYearId?: string | null
}

export async function createAccount(companyId: string, input: CreateAccountInput) {
  const { code, parentId } = input
  const label = input.label?.trim()
  if (!code || !label || !parentId) throw new ValidationError('Le code, le libellé et le compte parent sont obligatoires')
  if (!validateAccountCode(code)) throw new ValidationError('Le code doit contenir entre 2 et 8 chiffres')

  let fiscalYearId: string
  if (input.fiscalYearId) {
    const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: input.fiscalYearId, companyId }, select: { id: true } })
    if (!fiscalYear) throw new NotFoundError('Exercice introuvable')
    fiscalYearId = fiscalYear.id
  } else {
    fiscalYearId = (await ensureActiveFiscalYear(companyId)).id
  }

  const existing = await prisma.account.findUnique({
    where: { companyId_code_fiscalYearId: { companyId, code, fiscalYearId } },
    select: { id: true },
  })
  if (existing) throw new ConflictError('Un compte avec ce code existe déjà pour cette société et cet exercice')

  const parent = await prisma.account.findFirst({ where: { id: parentId, companyId } })
  if (!parent) throw new ValidationError('Compte parent invalide')
  if (parent.fiscalYearId !== fiscalYearId) {
    throw new ValidationError('Le compte parent doit appartenir au même exercice fiscal')
  }
  if (!code.startsWith(parent.code)) {
    throw new ValidationError(`Le code du compte enfant doit commencer par le code du parent (${parent.code})`)
  }

  return prisma.account.create({
    data: { code, label, companyId, fiscalYearId, parentId, isPCG: parent.isPCG },
  })
}
