/**
 * À-nouveaux already validated in the next fiscal year before the closing:
 * a FEC of that year imported on migration (its opening entries come first,
 * LPF art. A47 A-1, VII 3°), or opening balances entered by hand. They are
 * definitive (PCG art. 1031-3) and cannot be deleted, so the closing does
 * not book a second opening entry: it checks that they bring forward the
 * closing balances of the year (Code de commerce art. L123-19, the opening
 * balance sheet is the closing balance sheet of the previous year) and
 * refuses with the differing accounts otherwise.
 *
 * The result of the year is compared on accounts 11 and 12 together: some
 * software brings it forward to report à nouveau (110 / 119) rather than to
 * 120 / 129.
 */

import type { Prisma } from '@prisma/client'
import { parseCents } from '@/lib/utils/money'
import { OPENING_JOURNAL } from './constants'
import type { ClosingLine } from './closing-entries'

type Client = Pick<Prisma.TransactionClient, '$queryRaw'>

/** Balances (cents, debit positive) of the validated AN entries of a fiscal year by account code; null without any. */
export async function loadRecordedOpening(client: Client, companyId: string, fiscalYearId: string): Promise<Map<string, number> | null> {
  const rows = await client.$queryRaw<Array<{ code: string; balance: Prisma.Decimal }>>`
    SELECT a."code", SUM(l."debit") - SUM(l."credit") AS balance
    FROM "accounting_entries" e
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "entry_lines" l ON l."accountingEntryId" = e."id"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId} AND e."fiscalYearId" = ${fiscalYearId}
      AND e."status" = 'validated' AND j."code" = ${OPENING_JOURNAL.code}
    GROUP BY a."code"
  `
  if (rows.length === 0) return null
  return new Map(rows.map((r) => [r.code, parseCents(r.balance) ?? 0]))
}

export interface OpeningDifference {
  /** Account code, or "11/12" for the result and report à nouveau together. */
  code: string
  expectedCents: number
  recordedCents: number
}

const RESULT_BUCKET = '11/12'
const bucketOf = (code: string) => (code.startsWith('11') || code.startsWith('12') ? RESULT_BUCKET : code)

/** Accounts whose recorded opening balance differs from the closing balance (expected lines of computeOpeningEntry). */
export function openingDifferences(expected: ClosingLine[], recorded: Map<string, number>): OpeningDifference[] {
  const sums = new Map<string, { expectedCents: number; recordedCents: number }>()
  const at = (code: string) => {
    const key = bucketOf(code)
    let sum = sums.get(key)
    if (!sum) sums.set(key, (sum = { expectedCents: 0, recordedCents: 0 }))
    return sum
  }
  for (const line of expected) at(line.code).expectedCents += line.debitCents - line.creditCents
  for (const [code, cents] of recorded) at(code).recordedCents += cents
  return [...sums.entries()]
    .filter(([, s]) => s.expectedCents !== s.recordedCents)
    .map(([code, s]) => ({ code, ...s }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

const euros = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (cents: number) => (cents === 0 ? '0,00 €' : `${euros(Math.abs(cents))} € ${cents > 0 ? 'débiteur' : 'créditeur'}`)

/** The French refusal listing the differing accounts. */
export function openingDifferencesMessage(year: number, nextYear: number, differences: OpeningDifference[]): string {
  const shown = differences.slice(0, 10).map((d) => `${d.code === RESULT_BUCKET ? 'comptes 11 et 12' : `compte ${d.code}`}\u00a0: ${signed(d.expectedCents)} attendu, ${signed(d.recordedCents)} enregistré`)
  const more = differences.length > shown.length ? ` et ${differences.length - shown.length} autre(s)` : ''
  return `L'exercice ${nextYear} a déjà des à-nouveaux validés (journal ${OPENING_JOURNAL.code}) qui ne reprennent pas les soldes de clôture de ${year} (Code de commerce art. L123-19)\u00a0: ${shown.join('\u00a0; ')}${more}. Corrigez les écritures de ${year}, ou passez une écriture complémentaire au journal ${OPENING_JOURNAL.code} de ${nextYear}.`
}
