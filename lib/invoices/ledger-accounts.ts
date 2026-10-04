/**
 * Accounts of the fiscal year an invoice posts to. Accounts belong to one
 * fiscal year (Account.fiscalYearId): every lookup is scoped by company AND
 * fiscal year, so an account id or code of another company, or of another
 * year of the same company, is never used.
 *
 * - by code: the exact code in that year's chart (a code typed on a line or
 *   on a tiers);
 * - by PCG root (401, 44566...): the account of the root itself, else the
 *   root padded with zeros to six digits (445660), else the first account
 *   below the root (shortest code first), so charts with "401", "401000" or
 *   "4011" all work.
 */

import type { Prisma } from '@prisma/client'
import { ValidationError } from '@/lib/accounting/errors'

export interface LedgerAccount {
  id: string
  code: string
  label: string
}

export async function accountsByCode(
  db: Prisma.TransactionClient,
  companyId: string,
  fiscalYear: { id: string; year: number },
  codes: string[],
): Promise<Map<string, LedgerAccount>> {
  const unique = [...new Set(codes)]
  const rows = unique.length
    ? await db.account.findMany({ where: { companyId, fiscalYearId: fiscalYear.id, code: { in: unique } }, select: { id: true, code: true, label: true } })
    : []
  const found = new Map(rows.map((a) => [a.code, a]))
  const missing = unique.filter((code) => !found.has(code))
  if (missing.length > 0) {
    throw new ValidationError(
      `${missing.length > 1 ? 'Les comptes' : 'Le compte'} ${missing.join(', ')} ${missing.length > 1 ? 'n’existent' : 'n’existe'} pas dans le plan de comptes de l’exercice ${fiscalYear.year} : créez-${missing.length > 1 ? 'les' : 'le'} ou choisissez un autre compte.`,
    )
  }
  return found
}

export async function accountByRoot(
  db: Prisma.TransactionClient,
  companyId: string,
  fiscalYear: { id: string; year: number },
  root: string,
  label: string,
): Promise<LedgerAccount> {
  const rows = await db.account.findMany({
    where: { companyId, fiscalYearId: fiscalYear.id, code: { startsWith: root } },
    select: { id: true, code: true, label: true },
    orderBy: { code: 'asc' },
    take: 200,
  })
  const padded = root.padEnd(6, '0')
  const pick =
    rows.find((a) => a.code === root) ??
    rows.find((a) => a.code === padded) ??
    [...rows].sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code))[0]
  if (!pick) {
    throw new ValidationError(
      `Aucun compte ${root} (${label}) dans le plan de comptes de l’exercice ${fiscalYear.year} : créez le compte ${root} pour comptabiliser cette facture.`,
    )
  }
  return pick
}
