/**
 * What a holding and its subsidiaries are, for Kledg. One definition, used
 * by the navigation, the conventions and the computations:
 *
 *   a company is a holding of another when it is recorded among that
 *   company's shareholders (Shareholder.companyShareholderId, entered on the
 *   subsidiary's Informations page); the subsidiaries of a holding are those
 *   companies, whatever the percentage held.
 *
 * Why not the other candidates:
 * - `Company.isHolding` says the company is a pure holding (holding pure,
 *   no operating activity). A holding that invoices services to its
 *   subsidiaries is by definition a holding animatrice: the flag would hide
 *   the feature from the very companies that need it;
 * - a minimum percentage (Ledgerly counted any company held above 1 %, in
 *   one place, and used two other definitions elsewhere) is a legal question
 *   of each convention, not of the software: the shareholding is shown, the
 *   user decides.
 *
 * Reads of the subsidiaries' rows run in the user's own row level security
 * context: a subsidiary the user cannot reach is not listed.
 */

import type { Prisma } from '@prisma/client'
import { ValidationError } from '@/lib/accounting/errors'
import { prisma } from '@/lib/prisma'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { withUserContext } from '@/lib/rls/context'
import type { CurrentUser } from '@/lib/session'
import { inCompany, type GroupAccess } from './access'

/** Companies the user reaches (members, or every company for an instance administrator), archived ones aside. */
function reachable(user: Pick<CurrentUser, 'id' | 'role'>): Prisma.CompanyWhereInput {
  return isGlobalAdmin(user) ? { archivedAt: null } : { archivedAt: null, organization: { members: { some: { userId: user.id } } } }
}

/**
 * Ids and slugs of the user's companies that hold shares in another company
 * the user reaches: the companies whose navigation shows Frais de gestion.
 */
export async function listHoldingRefs(user: Pick<CurrentUser, 'id' | 'role'>): Promise<string[]> {
  const holdings = await withUserContext(user.id, () =>
    prisma.company.findMany({
      where: { AND: [reachable(user), { shareholdings: { some: { company: reachable(user) } } }] },
      select: { id: true, slug: true },
      take: 500,
    }),
  )
  return holdings.flatMap((c) => [c.id, c.slug])
}

export interface SubsidiaryCandidate {
  id: string
  name: string
  siren: string
  /** Percentage of the subsidiary's capital the holding holds, as recorded ("60.00"). */
  sharePercentage: string
}

/**
 * Subsidiaries of the holding the user may read (reports:read in each): the
 * companies that record the holding as a shareholder.
 */
export async function listSubsidiaryCandidates(holdingId: string, user: Pick<CurrentUser, 'id' | 'role'>, access: GroupAccess): Promise<SubsidiaryCandidate[]> {
  const rows = await withUserContext(user.id, () =>
    prisma.shareholder.findMany({
      where: { companyShareholderId: holdingId, companyId: { not: holdingId }, company: reachable(user) },
      select: { sharePercentage: true, company: { select: { id: true, name: true, siren: true } } },
      orderBy: { company: { name: 'asc' } },
      take: 200,
    }),
  )
  const candidates: SubsidiaryCandidate[] = []
  for (const row of rows) {
    // One check per subsidiary, each in its own scope (a handful of companies, not a list of rows).
    const readable = await inCompany(access, row.company.id, { reports: ['read'] }, async () => true).catch(() => false)
    if (readable) candidates.push({ ...row.company, sharePercentage: row.sharePercentage.toString() })
  }
  return candidates
}

/**
 * Inside the subsidiary's scope: the subsidiary still records the holding
 * among its shareholders. Returns its name and identifiers.
 */
export async function assertSubsidiaryOf(holdingId: string, subsidiaryId: string) {
  if (subsidiaryId === holdingId) throw new ValidationError('Une société ne peut pas être sa propre filiale.')
  const company = await prisma.company.findUnique({
    where: { id: subsidiaryId },
    select: { id: true, name: true, siren: true, vatNumber: true, shareholders: { where: { companyShareholderId: holdingId }, select: { id: true }, take: 1 } },
  })
  if (!company || company.shareholders.length === 0) {
    throw new ValidationError(
      `${company?.name ?? 'Cette société'} n’est pas une filiale de la holding : enregistrez la holding parmi ses actionnaires (page Informations de la filiale) avant de l’ajouter à une convention.`,
    )
  }
  return { id: company.id, name: company.name, siren: company.siren, vatNumber: company.vatNumber }
}

/** Upper bound of the subsidiaries a group view reads (a group with more is reported, not silently cut). */
export const MAX_GROUP_SUBSIDIARIES = 50

/**
 * Ids of every active subsidiary of the holding, by the definition above,
 * including those the user cannot reach: the shareholder rows live in the
 * subsidiaries, so they are read through kledg_group_subsidiary_ids
 * (migration 20261027090000_group_subsidiaries), which answers only for a
 * holding the current context reaches and returns ids only. Callers check
 * the user's access to each id (inCompany) before reading anything of it,
 * and never return an id they cannot reach.
 *
 * The call reads FROM unnest(...) on purpose: a statement naming no table
 * would run without the row level security context (lib/rls/tables.ts,
 * touchesOnlyExemptTables), and the function would then reach no holding.
 */
export async function listSubsidiaryIds(holdingId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM unnest(kledg_group_subsidiary_ids(${holdingId})) AS id ORDER BY id`
  return rows.map((r) => r.id)
}
