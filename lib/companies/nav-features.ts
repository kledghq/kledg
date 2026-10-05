/**
 * Pages of the company navigation that only some companies need
 * (components/layout/nav-config.ts, NavItem.feature):
 * - training: an establishment of the company is an organisme de formation
 *   (Establishment.isTrainingOrganization): Bilan pédagogique et financier;
 * - vatCoefficient: the company deducts its VAT by a coefficient (exempt,
 *   partly exempt) or is a training organisation, whose training is exempt
 *   (CGI art. 261, 4, 4° a): Coefficient de déduction de TVA.
 * The pages stay reachable by URL; the navigation only lists them where
 * they apply. Reads run in the user's own row level security context,
 * narrowed to the companies the caller listed.
 */

import { prisma } from '@/lib/prisma'
import { withUserContext } from '@/lib/rls/context'
import type { CurrentUser } from '@/lib/session'

export type NavFeature = 'training' | 'vatCoefficient'
export type NavFeatureRefs = Record<NavFeature, string[]>

/** Companies listed at most (the company switcher lists the user's companies). */
const MAX_COMPANIES = 500

export async function listNavFeatureRefs(user: Pick<CurrentUser, 'id' | 'role'>, companyIds: readonly string[]): Promise<NavFeatureRefs> {
  if (companyIds.length === 0) return { training: [], vatCoefficient: [] }
  const rows = await withUserContext(
    user.id,
    () =>
      prisma.company.findMany({
        where: { id: { in: [...companyIds] } },
        select: { id: true, slug: true, isVatExempt: true, partialVatDeduction: true, establishments: { where: { isTrainingOrganization: true }, select: { id: true }, take: 1 } },
        take: MAX_COMPANIES,
      }),
    { companyIds },
  )
  const refs = (keep: (row: (typeof rows)[number]) => boolean) => rows.filter(keep).flatMap((c) => [c.id, c.slug])
  const training = (row: (typeof rows)[number]) => row.establishments.length > 0
  return {
    training: refs(training),
    vatCoefficient: refs((row) => training(row) || row.isVatExempt || row.partialVatDeduction),
  }
}

/** Whether an establishment of the company is a training organisation. */
export async function isTrainingOrganisation(companyId: string): Promise<boolean> {
  return (await prisma.establishment.count({ where: { companyId, isTrainingOrganization: true } })) > 0
}
