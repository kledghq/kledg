/**
 * Company lookups for by-id routes (used with fromResource) and helpers to
 * load a row only if it belongs to a given company.
 *
 *   export const PATCH = companyRoute(
 *     { company: fromResource(companyOfAccount), permission: { ledger: ['manage'] } },
 *     async ({ params, companyId }) => {
 *       const account = await findOwned(
 *         prisma.account.findFirst({ where: { id: params.id as string, companyId } }),
 *         'Compte introuvable',
 *       )
 *       ...
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'

type CompanyRow = { companyId: string | null } | null
const select = { companyId: true } as const

export const companyOfAccount = (id: string): Promise<CompanyRow> =>
  prisma.account.findUnique({ where: { id }, select })

export const companyOfJournal = (id: string): Promise<CompanyRow> =>
  prisma.journal.findUnique({ where: { id }, select })

export const companyOfEntry = (id: string): Promise<CompanyRow> =>
  prisma.accountingEntry.findUnique({ where: { id }, select })

export const companyOfRule = (id: string): Promise<CompanyRow> =>
  prisma.transactionRule.findUnique({ where: { id }, select })

export const companyOfFixedAsset = (id: string): Promise<CompanyRow> =>
  prisma.fixedAsset.findUnique({ where: { id }, select })

export const companyOfIntegration = (id: string): Promise<CompanyRow> =>
  prisma.integration.findUnique({ where: { id }, select })

export const companyOfAttachment = (id: string): Promise<CompanyRow> =>
  prisma.attachment.findUnique({ where: { id }, select })

export const companyOfFiscalYear = (id: string): Promise<CompanyRow> =>
  prisma.fiscalYear.findUnique({ where: { id }, select })

export const companyOfTiers = (id: string): Promise<CompanyRow> =>
  prisma.tiers.findUnique({ where: { id }, select })

export const companyOfInvoice = (id: string): Promise<CompanyRow> =>
  prisma.invoice.findUnique({ where: { id }, select })

export const companyOfExpenseReport = (id: string): Promise<CompanyRow> =>
  prisma.expenseReport.findUnique({ where: { id }, select })

export const companyOfExpenseClaimant = (id: string): Promise<CompanyRow> =>
  prisma.expenseClaimant.findUnique({ where: { id }, select })

export const companyOfExpenseCategoryRule = (id: string): Promise<CompanyRow> =>
  prisma.expenseCategoryRule.findUnique({ where: { id }, select })

export async function companyOfBankAccount(id: string): Promise<CompanyRow> {
  const row = await prisma.bankAccount.findUnique({
    where: { id },
    select: { bankConnection: { select: { companyId: true } } },
  })
  return row ? { companyId: row.bankConnection.companyId } : null
}

export async function companyOfTransaction(id: string): Promise<CompanyRow> {
  const row = await prisma.bankTransaction.findUnique({
    where: { id },
    select: { bankAccount: { select: { bankConnection: { select: { companyId: true } } } } },
  })
  return row ? { companyId: row.bankAccount.bankConnection.companyId } : null
}

/** Where clause matching bank transactions of a company. */
export function transactionOfCompany(companyId: string) {
  return { bankAccount: { bankConnection: { companyId } } }
}

/** Awaits a scoped lookup (`where: { id, companyId }`) and throws a 404 when it found nothing. */
export async function findOwned<T>(lookup: Promise<T | null>, notFoundMessage = 'Ressource introuvable'): Promise<T> {
  const row = await lookup
  if (!row) throw new NotFoundError(notFoundMessage)
  return row
}

/**
 * Checks that every id belongs to the company (via `count`), else 404.
 * Use for ids coming from a request body (accounts of an entry, entry to reconcile...).
 */
export async function assertAllOwned(
  ids: ReadonlyArray<string | null | undefined>,
  count: (ids: string[]) => Promise<number>,
  notFoundMessage = 'Ressource introuvable',
): Promise<void> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  if (unique.length === 0) return
  if ((await count(unique)) !== unique.length) throw new NotFoundError(notFoundMessage)
}
