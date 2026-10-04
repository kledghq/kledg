/**
 * Doubtful receivables at a closing, from the aged balance
 * (lib/reports/third-parties): customers whose open invoices are overdue
 * beyond a threshold, as candidates for an impairment (491) and for a
 * transfer to 416 "Clients douteux ou litigieux". Only suggestions: the
 * user judges the risk of each customer, creates the impairment with the
 * probable loss, and the transfer to 416 is a draft entry they validate.
 *
 * Sources: Code de commerce art. L123-20 and PCG art. 214-15 et seq. (an
 * asset whose value falls is written down at the closing); chart of
 * accounts 416 and 491; CGI art. 272, 1 (the VAT of a lost receivable is
 * recovered, so the impairment is computed on the amount excluding tax,
 * lib/provisions/rules.ts receivableBaseExclTaxCents); CGI art. 39, 1-5°
 * (deductible when the loss is probable and individually assessed, not a
 * flat rate on all receivables).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ClosedFiscalYearError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { createEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { ensureAccounts, ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { writeAuditLog } from '@/lib/audit'
import { getAgedBalance } from '@/lib/reports/third-parties/get-third-party-reports.service'
import type { AgedTiers } from '@/lib/reports/third-parties/third-party-balances'
import { calendarDayOf } from '@/lib/utils/date'
import { centsToDecimal } from '@/lib/utils/money'

export const OVERDUE_THRESHOLDS = [30, 60, 90] as const

/** ?fiscalYearId=&minDaysOverdue= */
export const DoubtfulReceivablesQuerySchema = z.object({
  fiscalYearId: z.string({ error: "L'exercice est requis" }).max(64),
  minDaysOverdue: z.enum(['30', '60', '90'], { error: 'Seuil de retard invalide (30, 60 ou 90 jours)' }).optional(),
})
export type DoubtfulReceivablesQuery = z.infer<typeof DoubtfulReceivablesQuerySchema>

/** Body of POST /api/provisions/doubtful-receivables/reclassify. */
export const ReclassifyBodySchema = z.object({
  companyId: z.string(),
  fiscalYearId: z.string({ error: "L'exercice est requis" }).max(64),
  tiersCode: z.string({ error: 'Le client est requis' }).trim().min(1, 'Le client est requis').max(40),
})
export type ReclassifyBody = z.infer<typeof ReclassifyBodySchema>

export interface DoubtfulReceivable {
  tiersCode: string
  label: string
  accountCodes: string[]
  /** Everything the customer still owes at the closing, including tax (cents). */
  openInclTaxCents: number
  /** Part overdue by more than the threshold, including tax (cents). */
  overdueInclTaxCents: number
  oldestDueDate: string | null
  /** Impairment of this customer already followed in Kledg. */
  provision: { id: string; label: string } | null
}

/** Overdue amount beyond `minDays` from the age buckets (30, 60 or 90 days). */
export function overdueBeyond(tiers: Pick<AgedTiers, 'buckets'>, minDays: 30 | 60 | 90): number {
  const b = tiers.buckets
  if (minDays === 90) return b.over90
  if (minDays === 60) return b.days61to90 + b.over90
  return b.days31to60 + b.days61to90 + b.over90
}

async function closingYear(companyId: string, fiscalYearId: string) {
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId }, select: { id: true, year: true, endDate: true } })
  if (!fiscalYear) throw new NotFoundError('Exercice introuvable pour cette société.')
  return fiscalYear
}

/** Customers with invoices overdue by more than the threshold at the end of the fiscal year (90 days by default). */
export async function listDoubtfulReceivables(companyId: string, query: DoubtfulReceivablesQuery): Promise<{ asOf: string; minDaysOverdue: number; items: DoubtfulReceivable[] }> {
  const fiscalYear = await closingYear(companyId, query.fiscalYearId)
  const minDays = Number(query.minDaysOverdue ?? 90) as 30 | 60 | 90
  const asOf = calendarDayOf(fiscalYear.endDate) as string
  const [aged, provisions] = await Promise.all([
    getAgedBalance(companyId, { fiscalYearId: fiscalYear.id, asOf }),
    prisma.provision.findMany({ where: { companyId, category: 'RECEIVABLE', tiersCode: { not: null } }, select: { id: true, label: true, tiersCode: true } }),
  ])
  const byTiers = new Map(provisions.map((p) => [p.tiersCode as string, { id: p.id, label: p.label }]))
  const items = aged.customers.tiers
    .map((t) => ({
      tiersCode: t.code,
      label: t.label,
      accountCodes: t.accountCodes,
      openInclTaxCents: t.buckets.totalCents,
      overdueInclTaxCents: overdueBeyond(t, minDays),
      oldestDueDate: t.oldestDueDate,
      provision: byTiers.get(t.code) ?? null,
    }))
    .filter((t) => t.overdueInclTaxCents > 0)
  return { asOf, minDaysOverdue: minDays, items }
}

/** 416 account matching the customer account's format: 411000 gives 416000, 411 or 4111 give 416. */
export function doubtfulAccountFor(customerAccountCode: string): string {
  const rest = customerAccountCode.slice(3)
  return /^0+$/.test(rest) ? `416${rest}` : '416'
}

/**
 * Draft entry moving what a customer owes from 411 to 416 at the end of
 * the fiscal year (debit 416, credit 411, the customer's auxiliary account
 * on both lines), so the doubtful receivable shows apart in the books. The
 * user validates it like any entry.
 */
export async function reclassifyDoubtfulReceivable(companyId: string, body: ReclassifyBody): Promise<{ entryId: string; amountCents: number }> {
  const fiscalYear = await closingYear(companyId, body.fiscalYearId)
  const asOf = calendarDayOf(fiscalYear.endDate) as string
  const aged = await getAgedBalance(companyId, { fiscalYearId: fiscalYear.id, asOf })
  const tiers = aged.customers.tiers.find((t) => t.code === body.tiersCode)
  if (!tiers || tiers.buckets.totalCents <= 0) throw new ValidationError("Ce client ne doit rien à la clôture de l'exercice.")
  if (tiers.accountCodes.length !== 1) {
    throw new ValidationError(`Les créances de ce client sont sur plusieurs comptes (${tiers.accountCodes.join(', ')})\u00a0: passez le reclassement en 416 par une écriture manuelle.`)
  }
  const customerAccount = tiers.accountCodes[0]
  const aux = tiers.code === customerAccount ? null : tiers.code
  const doubtful = doubtfulAccountFor(customerAccount)
  const amountCents = tiers.buckets.totalCents
  const description = `Reclassement en clients douteux - ${tiers.label}`

  const entry = await prisma.$transaction(async (tx) => {
    const locked = await lockFiscalYearRow(tx, fiscalYear.id, companyId)
    if (!locked) throw new NotFoundError('Exercice introuvable pour cette société.')
    if (locked.closed) throw new ClosedFiscalYearError(locked.year)
    const journal = await ensureJournal(tx, companyId, { code: 'OD', label: 'Opérations diverses' })
    const ids = await ensureAccounts(tx, companyId, fiscalYear.id, [
      { code: customerAccount, label: 'Clients' },
      { code: doubtful, label: 'Clients douteux ou litigieux' },
    ])
    return createEntryInTx(tx, {
      companyId,
      fiscalYearId: fiscalYear.id,
      journalId: journal.id,
      date: fiscalYear.endDate,
      description,
      reference: `DOUT-${fiscalYear.year}-${tiers.code}`.slice(0, 60),
      status: 'draft',
      lines: [
        { accountId: ids.get(doubtful) as string, debit: centsToDecimal(amountCents), credit: '0', description, auxiliaryAccountNumber: aux, auxiliaryAccountLabel: aux ? tiers.label : null },
        { accountId: ids.get(customerAccount) as string, debit: '0', credit: centsToDecimal(amountCents), description, auxiliaryAccountNumber: aux, auxiliaryAccountLabel: aux ? tiers.label : null },
      ],
    })
  })
  await writeAuditLog('info', 'Doubtful receivable reclassified', { action: 'RECLASSIFY_DOUBTFUL_RECEIVABLE', companyId, metadata: { entryId: entry.id, fiscalYearId: fiscalYear.id } })
  return { entryId: entry.id, amountCents }
}
