/**
 * The accounts of a fiscal year's chart that a simple mode category books
 * to. The catalogue names PCG accounts of four digits at most (and 44562,
 * 44566, 44571), as Kledg seeds them; a chart imported from a FEC often
 * holds detailed accounts instead (626100 rather than 626). The rule is the
 * one every module shares (lib/accounting/root-account.ts) with the parent
 * fallback: exact code, else the code padded with zeros, else the lowest
 * code below it, else the closest parent present (6511 -> 651 -> 65).
 * Null when none exists: the user is told to have the chart completed,
 * never booked to an unrelated account.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadRootAccounts, pickRootAccount } from '@/lib/accounting/root-account'

type Client = Prisma.TransactionClient | typeof prisma

export interface LedgerAccount {
  id: string
  code: string
  label: string
}

/** Pure choice among the chart's accounts (see the module header). */
export function pickLedgerAccount(code: string, chart: readonly LedgerAccount[]): LedgerAccount | null {
  return pickRootAccount(code, chart, { parentFallback: true })
}

/** The account of each code in the fiscal year's chart (one query), null when the chart has nothing close. */
export async function resolveLedgerAccounts(
  companyId: string,
  fiscalYearId: string,
  codes: readonly string[],
  client: Client = prisma,
): Promise<Map<string, LedgerAccount | null>> {
  return loadRootAccounts(client, companyId, fiscalYearId, codes, { parentFallback: true })
}
