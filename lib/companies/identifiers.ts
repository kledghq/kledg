/**
 * Instance-wide uniqueness of a company's SIREN and slug.
 *
 * Both are unique across the instance, while a user only sees the companies
 * they belong to (row level security, docs/rls.md). The check goes through
 * kledg_company_identifier_taken (migration 20261020090000_row_level_security),
 * which answers whether another company holds the value and nothing else.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>

/** Whether a company other than `exceptCompanyId` already has this SIREN or slug. */
export async function companyIdentifierTaken(
  field: 'siren' | 'slug',
  value: string,
  exceptCompanyId?: string | null,
  db: Db = prisma,
): Promise<boolean> {
  const rows = await db.$queryRaw<{ taken: boolean }[]>`
    SELECT kledg_company_identifier_taken(${field}, ${value}, ${exceptCompanyId ?? null}::text) AS taken`
  return Boolean(rows[0]?.taken)
}
