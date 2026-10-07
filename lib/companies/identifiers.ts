/**
 * Uniqueness of a company's identifiers: its SIREN, the SIRETs of its
 * establishments and its slug.
 *
 * A user only sees the companies they belong to (row level security,
 * docs/rls.md), so the checks go through kledg_company_identifier_taken
 * (migration 20261123090000_company_identifier_scope), which answers whether
 * another company holds the value and nothing else.
 *
 * The SIREN and the SIRETs are unique within the scope the instance policy
 * gives (companyIdentifierScope, lib/instance/policy.ts): every company of
 * the instance in Kledg, the customer's own companies on a service whose
 * customers share one database. The slug is part of company URLs: it stays
 * unique across the instance (see slug.ts for how it avoids telling who
 * holds one).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { companyIdentifierScope, type InstanceActor } from '@/lib/instance'

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>

export type CompanyIdentifier = 'siren' | 'siret' | 'slug'

/** 409 of an establishment SIRET already used. */
export const SIRET_TAKEN_MESSAGE = 'Un établissement avec ce SIRET existe déjà.'

/**
 * Whether a company other than `exceptCompanyId` already has this SIREN or
 * slug, or an establishment this SIRET, among the companies of `scope`
 * (null: every company of the instance; the slug ignores it).
 */
export async function companyIdentifierTaken(
  field: CompanyIdentifier,
  value: string,
  exceptCompanyId?: string | null,
  db: Db = prisma,
  scope: readonly string[] | null = null,
): Promise<boolean> {
  const rows = await db.$queryRaw<{ taken: boolean }[]>`
    SELECT kledg_company_identifier_taken(${field}, ${value}, ${exceptCompanyId ?? null}::text, ${scope === null ? null : [...scope]}::text[]) AS taken`
  return Boolean(rows[0]?.taken)
}

/**
 * Whether the SIREN or the establishment SIRET `value` is already used
 * within the scope of the instance policy: for the company `companyId`
 * (a change, excluded itself for the SIREN) or for a company `actor` is
 * creating (`companyId` null).
 */
export async function legalIdentifierTaken(
  field: 'siren' | 'siret',
  value: string,
  subject: { companyId: string | null; actor?: Pick<InstanceActor, 'id' | 'role'> | null },
  db: Db = prisma,
): Promise<boolean> {
  const scope = await companyIdentifierScope(subject.companyId, subject.actor ?? null)
  return companyIdentifierTaken(field, value, field === 'siren' ? subject.companyId : null, db, scope)
}
