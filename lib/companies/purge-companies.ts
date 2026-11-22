/**
 * Deletes companies with their books (#161): the one path through the
 * guards that keep a company with validated entries or a closed fiscal year
 * (migration 20261224090000_company_purge_function). For instances that
 * provision throwaway companies (the demo's sandboxes) or delete an account
 * on request (the hosted offer); Kledg itself archives a company instead
 * (lib/companies/archive-company.service.ts).
 *
 * The database deletes only the companies the transaction's context may
 * delete (the delete policy of companies under KLEDG_RLS=enforce): run it
 * in a system context limited to these companies, or as a user who reaches
 * them. A company out of reach raises and nothing is deleted. Foreign keys
 * are checked at commit. The transaction settings kledg.company_purge and
 * kledg.closed_year_bypass no longer let the application role through.
 */

import type { Prisma } from '@prisma/client'

/** Deletes `companyIds` with their books in `tx`; returns how many were deleted. */
export async function purgeCompaniesInTx(tx: Prisma.TransactionClient, companyIds: readonly string[]): Promise<number> {
  if (companyIds.length === 0) return 0
  const [row] = await tx.$queryRaw<Array<{ deleted: number }>>`SELECT kledg_purge_companies(${[...companyIds]}::text[]) AS "deleted"`
  return Number(row?.deleted ?? 0)
}
