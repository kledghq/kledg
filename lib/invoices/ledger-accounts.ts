/**
 * Accounts of the fiscal year an invoice posts to. Accounts belong to one
 * fiscal year (Account.fiscalYearId): every lookup is scoped by company AND
 * fiscal year, so an account id or code of another company, or of another
 * year of the same company, is never used.
 *
 * - by code: the exact code in that year's chart (a code typed on a line or
 *   on a tiers);
 * - by PCG root (401, 44566...): the rule every module shares
 *   (lib/accounting/root-account.ts): the root itself, else the root padded
 *   with zeros, else the lowest account below it, so charts with "401",
 *   "401000", "40100000" or "4011" all work. No parent fallback: a missing
 *   root is refused with a French message.
 */

import type { Prisma } from '@prisma/client'
import { ValidationError } from '@/lib/accounting/errors'
import { loadRootAccount } from '@/lib/accounting/root-account'

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
  /** What is being posted, for the message: "cette facture" by default. */
  purpose = 'cette facture',
): Promise<LedgerAccount> {
  const pick = await loadRootAccount(db, companyId, fiscalYear.id, root)
  if (!pick) {
    throw new ValidationError(
      `Aucun compte ${root} (${label}) dans le plan de comptes de l’exercice ${fiscalYear.year} : créez le compte ${root} pour comptabiliser ${purpose}.`,
    )
  }
  return pick
}
