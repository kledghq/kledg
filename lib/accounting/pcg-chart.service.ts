/**
 * PCG accounts of a fiscal year chart: seeding the nomenclature and
 * completing a chart against it (missing accounts added, parent links of
 * PCG accounts put back as in the nomenclature). Optional accounts (class 8
 * and numbers of more than 4 digits) are only added on request.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { PCG_ACCOUNTS, isOptionalPcgAccount } from '@/lib/accounting/pcg-data'
import { logger } from '@/lib/logger'
import { targetChartFiscalYearId } from '@/lib/accounting/manage-accounts.service'
import { seedPCG } from '@/prisma/seeds/pcg'
import { plural, pluralWord } from '@/lib/utils/plural'

export { isOptionalPcgAccount } from '@/lib/accounting/pcg-data'

/** Seeds the PCG accounts in the chart of a fiscal year of the company (404 for another company's year). */
export async function seedPcgChart(companyId: string, fiscalYearId: string, includeOptionalAccounts: boolean): Promise<void> {
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId }, select: { id: true } })
  if (!fiscalYear) throw new NotFoundError('Exercice introuvable')
  await seedPCG(companyId, fiscalYear.id, includeOptionalAccounts)
}

export interface PcgChartCompletion {
  success: true
  missingCount: number
  addedCount: number
  fixedRelationsCount: number
  message: string
}

/**
 * Completes the chart of a fiscal year (the active one by default; a year
 * of another company is a 400) with the PCG accounts it misses, and
 * re-attaches its PCG accounts to the parent the nomenclature gives them.
 */
export async function completePcgChart(
  companyId: string,
  options: { fiscalYearId?: string | null; includeOptionalAccounts?: boolean } = {},
): Promise<PcgChartCompletion> {
  const fiscalYearId = await targetChartFiscalYearId(companyId, options.fiscalYearId)

  const existingAccounts = await prisma.account.findMany({
    where: { companyId, fiscalYearId, isPCG: true },
    select: { id: true, code: true, parentId: true },
  })
  const existingCodes = new Set(existingAccounts.map((a) => a.code))

  const requiredAccounts = options.includeOptionalAccounts
    ? PCG_ACCOUNTS
    : PCG_ACCOUNTS.filter((account) => !isOptionalPcgAccount(account.code))
  const parentCodeOf = new Map(requiredAccounts.map((a) => [a.code, a.parentCode ?? null]))
  const idByCode = new Map(existingAccounts.map((a) => [a.code, a.id]))
  const codeById = new Map(existingAccounts.map((a) => [a.id, a.code]))

  const missingAccounts = requiredAccounts.filter((account) => !existingCodes.has(account.code))

  // Parent links that differ from the nomenclature
  const relinks: Array<{ id: string; parentId: string | null }> = []
  for (const account of existingAccounts) {
    if (!parentCodeOf.has(account.code)) continue // not in the required nomenclature
    const expectedParentCode = parentCodeOf.get(account.code) ?? null
    const currentParentCode = account.parentId ? (codeById.get(account.parentId) ?? null) : null
    if (expectedParentCode !== currentParentCode) {
      relinks.push({ id: account.id, parentId: expectedParentCode ? (idByCode.get(expectedParentCode) ?? null) : null })
    }
  }
  // Ids come from the company-scoped query above. An expected parent that is
  // missing leaves the link unchanged (undefined), as the nomenclature is completed below.
  for (const relink of relinks) {
    await prisma.account.updateMany({ where: { id: relink.id, companyId }, data: { parentId: relink.parentId || undefined } })
  }

  // Missing accounts, parents first: each pass adds the accounts whose parent exists.
  let addedCount = 0
  const remaining = new Map(missingAccounts.map((account) => [account.code, account]))
  for (let pass = 0; remaining.size > 0 && pass < 100; pass++) {
    const ready = [...remaining.values()].filter((account) => !account.parentCode || idByCode.has(account.parentCode))
    if (ready.length === 0) break
    for (const pcgAccount of ready) {
      const parentId = pcgAccount.parentCode ? idByCode.get(pcgAccount.parentCode) : undefined
      // Upsert: a non PCG account with this number becomes the PCG account
      const account = await prisma.account.upsert({
        where: { companyId_code_fiscalYearId: { companyId, code: pcgAccount.code, fiscalYearId } },
        update: { label: pcgAccount.label, parentId: parentId || undefined, isPCG: true },
        create: { code: pcgAccount.code, label: pcgAccount.label, companyId, fiscalYearId, parentId: parentId || undefined, isPCG: true },
        select: { id: true },
      })
      idByCode.set(pcgAccount.code, account.id)
      remaining.delete(pcgAccount.code)
      addedCount++
    }
  }
  if (remaining.size > 0) {
    logger.warn('PCG accounts not added: their parent is missing from the nomenclature', { companyId, fiscalYearId, count: remaining.size })
  }

  const messages: string[] = []
  if (addedCount > 0) messages.push(`${plural(addedCount, 'compte manquant ajouté', 'comptes manquants ajoutés')}`)
  if (relinks.length > 0) messages.push(`${plural(relinks.length, 'rattachement')} au compte parent ${pluralWord(relinks.length, 'corrigé', 'corrigés')}`)
  if (messages.length === 0) messages.push('Tous les comptes du PCG requis sont présents et correctement rattachés')

  return {
    success: true,
    missingCount: missingAccounts.length,
    addedCount,
    fixedRelationsCount: relinks.length,
    message: messages.join(', '),
  }
}
