/**
 * Aggregation of the books of several companies (agrégation): the account
 * totals of each company added up by account number, at 100 %, whatever
 * the stake. Pure, amounts in integer cents.
 *
 * What it is for: the combined indicators of the group space (SIG, BFR,
 * ratios computed on the summed totals, lib/reports/financial-indicators)
 * and the grand livre combiné. What it is not: consolidation (règlement ANC
 * 2020-01). Flows between the companies stay in the totals, on both sides;
 * the vue combinée (combine.ts) is the only place they are eliminated.
 * A ratio of the aggregate is therefore a ratio of the sum, not the average
 * of the companies' ratios: a large company weighs more.
 */

import type { VatFlows } from '@/lib/reports/financial-indicators/indicators'
import type { AccountTotals } from '@/lib/reports/statements/allocation'

/**
 * Totals of every account number across the lists, debits with debits and
 * credits with credits (a balance is never netted across companies before
 * the statements place it: a bank in credit in one company and in debit in
 * another stays an overdraft and an asset). Label of the first company
 * that has the account. Sorted by account number.
 */
export function aggregateAccountTotals(lists: ReadonlyArray<readonly AccountTotals[]>): AccountTotals[] {
  const byCode = new Map<string, AccountTotals>()
  for (const accounts of lists) {
    for (const a of accounts) {
      const current = byCode.get(a.code)
      if (current) {
        current.debitCents += a.debitCents
        current.creditCents += a.creditCents
      } else {
        byCode.set(a.code, { code: a.code, label: a.label, debitCents: a.debitCents, creditCents: a.creditCents })
      }
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
}

/** VAT flows of the companies added up (DSO and DPO of the aggregate). */
export function sumVatFlows(list: ReadonlyArray<VatFlows>): VatFlows {
  return list.reduce((sum, v) => ({ collecteeCents: sum.collecteeCents + v.collecteeCents, deductibleCents: sum.deductibleCents + v.deductibleCents }), {
    collecteeCents: 0,
    deductibleCents: 0,
  })
}
