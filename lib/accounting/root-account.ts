/**
 * The account of a fiscal year's chart that stands for a PCG root ("401",
 * "6226", "44566"). Invoices, expense reports, VAT settlement and corporate
 * tax drafts, simple mode and the exploitant meals split all name accounts
 * by root; a chart may hold the root itself (Kledg seeds "401"), the root
 * padded with zeros (a FEC import: "401000", "40100000") or only detailed
 * accounts ("4011", "626100"). One rule for all of them, in order:
 *
 * 1. the account of that exact code;
 * 2. else the root followed only by zeros, the shortest first ("401000"
 *    before "40100000"): the general account of the root in a padded chart;
 * 3. else the lowest code below the root ("4011" before "4017000");
 * 4. else, only when the caller allows it (`parentFallback`, simple mode,
 *    where the catalogue names codes finer than many charts), the closest
 *    parent present ("6226" -> "622" -> "62"), never above two digits.
 *
 * Null when nothing fits: the caller refuses with its own French message
 * or creates the account. Rules (lib/transactions/rule-executor.ts) do not
 * use this: a rule names an account the user picked in the chart, matched
 * by its exact code.
 *
 * Pure (no database import); `loadRootAccounts` takes the client.
 */

import type { Prisma } from '@prisma/client'

export interface RootAccountOptions {
  /** Fall back to the closest parent account (rule 4). */
  parentFallback?: boolean
}

const compareCodes = (a: { code: string }, b: { code: string }) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)

/** Choice among the chart's accounts (see the module header). */
export function pickRootAccount<T extends { code: string }>(root: string, chart: readonly T[], options: RootAccountOptions = {}): T | null {
  const exact = chart.find((a) => a.code === root)
  if (exact) return exact
  const below = chart.filter((a) => a.code.length > root.length && a.code.startsWith(root))
  const padded = below.filter((a) => /^0+$/.test(a.code.slice(root.length))).sort((a, b) => a.code.length - b.code.length)
  if (padded[0]) return padded[0]
  const lowest = [...below].sort(compareCodes)[0]
  if (lowest) return lowest
  if (options.parentFallback) {
    for (let length = root.length - 1; length >= 2; length--) {
      const parent = chart.find((a) => a.code === root.slice(0, length))
      if (parent) return parent
    }
  }
  return null
}

/** Longest account code considered for the zero padding of a root. */
const MAX_CODE_LENGTH = 20

/** Codes rules 1, 2 and 4 can pick for a root, for an `in:` filter. */
function candidateCodes(root: string, options: RootAccountOptions): string[] {
  const codes = [root]
  for (let length = root.length + 1; length <= MAX_CODE_LENGTH; length++) codes.push(root.padEnd(length, '0'))
  if (options.parentFallback) for (let length = root.length - 1; length >= 2; length--) codes.push(root.slice(0, length))
  return codes
}

type AccountReader = Pick<Prisma.TransactionClient, 'account'>

/**
 * The account of each root in a fiscal year's chart (null when none fits),
 * with two queries whatever the size of the chart: the exact, padded and
 * parent codes of every root, then the lowest account below each root left
 * without one. Scoped by company and fiscal year.
 */
export async function loadRootAccounts(
  db: AccountReader,
  companyId: string,
  fiscalYearId: string,
  roots: readonly string[],
  options: RootAccountOptions = {},
): Promise<Map<string, { id: string; code: string; label: string } | null>> {
  const unique = [...new Set(roots)]
  const select = { id: true, code: true, label: true } as const
  const known = unique.length
    ? await db.account.findMany({ where: { companyId, fiscalYearId, code: { in: [...new Set(unique.flatMap((root) => candidateCodes(root, options)))] } }, select })
    : []
  const result = new Map(unique.map((root) => [root, pickRootAccount(root, known, { parentFallback: false })]))
  // Rule 3 for the roots without an exact or padded account, before any parent
  const missing = unique.filter((root) => !result.get(root))
  const lowest = await Promise.all(
    missing.map((root) => db.account.findFirst({ where: { companyId, fiscalYearId, code: { startsWith: root, not: root } }, select, orderBy: { code: 'asc' } })),
  )
  missing.forEach((root, i) => {
    result.set(root, lowest[i] ?? (options.parentFallback ? pickRootAccount(root, known, options) : null))
  })
  return result
}

/** The account of one root (see loadRootAccounts). */
export async function loadRootAccount(
  db: AccountReader,
  companyId: string,
  fiscalYearId: string,
  root: string,
  options: RootAccountOptions = {},
): Promise<{ id: string; code: string; label: string } | null> {
  return (await loadRootAccounts(db, companyId, fiscalYearId, [root], options)).get(root) ?? null
}
