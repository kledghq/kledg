/**
 * The accounts of a fiscal year's chart that a simple mode category books
 * to. The catalogue names PCG accounts of four digits at most (and 44562,
 * 44566, 44571), as Kledg seeds them; a chart imported from a FEC often
 * holds detailed accounts instead (626100 rather than 626). For each code,
 * in order:
 * 1. the account of that exact code;
 * 2. else a detailed account under it: the one padded with zeros (626000)
 *    when there is one, else the lowest code (626100);
 * 3. else the closest parent present (6511 -> 651 -> 65).
 * Null when none exists: the user is told to have the chart completed,
 * never booked to an unrelated account.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Client = Prisma.TransactionClient | typeof prisma

export interface LedgerAccount {
  id: string
  code: string
  label: string
}

/** Pure choice among the chart's accounts (see the module header). */
export function pickLedgerAccount(code: string, chart: readonly LedgerAccount[]): LedgerAccount | null {
  const exact = chart.find((a) => a.code === code)
  if (exact) return exact
  const detailed = chart.filter((a) => a.code.startsWith(code)).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const padded = detailed.find((a) => /^0+$/.test(a.code.slice(code.length)))
  if (padded ?? detailed[0]) return padded ?? detailed[0]
  for (let length = code.length - 1; length >= 2; length--) {
    const parent = chart.find((a) => a.code === code.slice(0, length))
    if (parent) return parent
  }
  return null
}

/** The account of each code in the fiscal year's chart (one query), null when the chart has nothing close. */
export async function resolveLedgerAccounts(
  companyId: string,
  fiscalYearId: string,
  codes: readonly string[],
  client: Client = prisma,
): Promise<Map<string, LedgerAccount | null>> {
  const unique = [...new Set(codes)]
  const prefixes = [...new Set(unique.flatMap((code) => Array.from({ length: code.length - 1 }, (_, i) => code.slice(0, i + 2))))]
  const chart = await client.account.findMany({
    where: { companyId, fiscalYearId, OR: [{ code: { in: prefixes } }, ...unique.map((code) => ({ code: { startsWith: code } }))] },
    select: { id: true, code: true, label: true },
  })
  return new Map(unique.map((code) => [code, pickLedgerAccount(code, chart)]))
}
