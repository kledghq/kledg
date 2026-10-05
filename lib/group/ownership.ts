/**
 * Direct and indirect holdings in the companies of a group (Associés et
 * dirigeants of the group space, docs/vue-groupe.md). Pure.
 *
 * A holder's interest in a company is its share of the company's capital
 * (direct), plus what it holds through the other companies of the group:
 * through a company G it holds directly a fraction f, it holds f times G's
 * own interest in the company (intérêt, the product of the percentages
 * along each chain of holdings, summed over the chains): the "pourcentage
 * d'intérêt" of the consolidation vocabulary, computed here for information
 * only. It is never applied to any figure.
 *
 * Only the cap tables of the companies read are known: a chain through a
 * company not read is missing, which the page says. Cycles (two companies
 * holding each other) are cut: a chain never passes twice through the same
 * company, and is at most MAX_DEPTH companies long.
 *
 * Percentages travel in basis points (6000 = 60 %); chains multiply exact
 * fractions and the total is rounded to the basis point once, at the end.
 */

export interface OwnershipEdge {
  /** Who holds: a person or company key; a company of the group is `company:<id>`. */
  holderKey: string
  /** The company of the group held. */
  companyId: string
  bp: number
}

export interface Interest {
  directBp: number
  /** Total minus direct, through other companies of the group. */
  indirectBp: number
  totalBp: number
}

export const MAX_DEPTH = 6

export const companyKey = (companyId: string) => `company:${companyId}`

/**
 * Interests of every holder of `edges` in every company of the group,
 * direct and through the group's companies. Only companies with an interest
 * appear.
 */
export function computeInterests(edges: readonly OwnershipEdge[], groupCompanyIds: readonly string[]): Map<string, Map<string, Interest>> {
  const group = new Set(groupCompanyIds)
  // Direct fractions, holder -> company -> fraction (several rows of one holder add up).
  const direct = new Map<string, Map<string, number>>()
  for (const e of edges) {
    if (!group.has(e.companyId) || e.bp <= 0) continue
    const row = direct.get(e.holderKey) ?? new Map<string, number>()
    row.set(e.companyId, (row.get(e.companyId) ?? 0) + e.bp / 10_000)
    direct.set(e.holderKey, row)
  }

  // The interest of `holder` in `target`, never through a company of `visited`.
  const interest = (holder: string, target: string, visited: ReadonlySet<string>, depth: number): number => {
    const row = direct.get(holder)
    if (!row) return 0
    let total = row.get(target) ?? 0
    if (depth >= MAX_DEPTH) return total
    for (const [via, fraction] of row) {
      if (via === target || visited.has(via)) continue
      total += fraction * interest(companyKey(via), target, new Set([...visited, via]), depth + 1)
    }
    return total
  }

  const result = new Map<string, Map<string, Interest>>()
  for (const holder of direct.keys()) {
    const own = holder.startsWith('company:') ? holder.slice('company:'.length) : null
    const interests = new Map<string, Interest>()
    for (const target of group) {
      if (target === own) continue
      const visited = new Set(own ? [own] : [])
      const totalBp = Math.round(interest(holder, target, visited, 0) * 10_000)
      const directBp = Math.round((direct.get(holder)?.get(target) ?? 0) * 10_000)
      if (totalBp > 0 || directBp > 0) interests.set(target, { directBp, indirectBp: totalBp - directBp, totalBp })
    }
    if (interests.size > 0) result.set(holder, interests)
  }
  return result
}
