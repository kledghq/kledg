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
 * context, narrowed explicitly to the companies involved: a subsidiary the
 * user cannot reach is not listed.
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
 * `companyIds` are the user's companies the caller already listed (the
 * company switcher): the lookup runs narrowed to them, holding and
 * subsidiaries alike, never to every company of the user.
 */
export async function listHoldingRefs(user: Pick<CurrentUser, 'id' | 'role'>, companyIds: readonly string[]): Promise<string[]> {
  if (companyIds.length === 0) return []
  const among = (where: Prisma.CompanyWhereInput): Prisma.CompanyWhereInput => ({ AND: [reachable(user), { id: { in: [...companyIds] } }, where] })
  const holdings = await withUserContext(
    user.id,
    () =>
      prisma.company.findMany({
        where: among({ shareholdings: { some: { company: among({}) } } }),
        select: { id: true, slug: true },
        take: 500,
      }),
    { companyIds },
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
  // The subsidiaries are not known before this lookup: it reads only their
  // ids, within the access's own bound (an assistant's grant), never wider.
  const bound = (await access.companyIds?.()) ?? null
  const found = await withUserContext(
    user.id,
    () =>
      prisma.shareholder.findMany({
        where: {
          companyShareholderId: holdingId,
          companyId: bound ? { not: holdingId, in: [...bound] } : { not: holdingId },
          company: reachable(user),
        },
        select: { companyId: true },
        take: 200,
      }),
    bound ? { companyIds: bound } : {},
  )
  const subsidiaryIds = [...new Set(found.map((row) => row.companyId))]
  if (subsidiaryIds.length === 0) return []
  // The rows themselves, narrowed to the holding and those subsidiaries.
  const rows = await withUserContext(
    user.id,
    () =>
      prisma.shareholder.findMany({
        where: { companyShareholderId: holdingId, companyId: { in: subsidiaryIds } },
        select: { sharePercentage: true, company: { select: { id: true, name: true, siren: true } } },
        orderBy: { company: { name: 'asc' } },
      }),
    { companyIds: [holdingId, ...subsidiaryIds] },
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
