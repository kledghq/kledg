/**
 * Prepares the settlement entry of a VAT return as a DRAFT (settlement.ts
 * plans its lines): journal OD, dated on the last day of the period (on the
 * first open day when that period is closed, its real date as the date of
 * the document: lib/accounting/period-lock/booking-day.ts),
 * reference "TVA-CA3-2026-09". Nothing is validated: the user checks the
 * draft and validates it like any entry (PCG art. 1031-3), once the return
 * is filed.
 *
 * Idempotent, under an advisory lock per company and period and the lock
 * of the fiscal year row:
 * - a draft with the same lines is kept (unchanged);
 * - a draft that no longer matches the return (an entry added since) is
 *   deleted and prepared again (replaced);
 * - a validated settlement is never touched: it is reported, a correction
 *   goes through a contre-passation.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ClosedFiscalYearError, ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { createEntryInTx, deleteDraftEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { ensureAccounts, ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { bookingDayInTx, movedDraftNote } from '@/lib/accounting/period-lock/booking-day'
import { writeAuditLog } from '@/lib/audit'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { buildVatReturn } from './load-vat-return.service'
import { PERIOD_KEY_PATTERN } from './periods'
import { netByAccount, planSettlement, resolveRootCode, sameLines, SETTLEMENT_ROOTS, settlementDescription, settlementReference, type SettlementLine } from './settlement'

export const VatSettlementBodySchema = z.object({
  period: z.string({ error: 'La période est requise' }).regex(PERIOD_KEY_PATTERN, 'Période invalide : aaaa-mm, aaaa-Tn ou aaaa.'),
})
export type VatSettlementBody = z.infer<typeof VatSettlementBodySchema>

const OD_JOURNAL = { code: 'OD', label: 'Opérations diverses' }
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const

export interface VatSettlementResult {
  status: 'created' | 'replaced' | 'unchanged' | 'validated' | 'nothing'
  reference: string
  entryId: string | null
  entryNumber: string | null
  lines: SettlementLine[]
  /** French message for the user. */
  message: string
}

export async function prepareVatSettlement(companyId: string, periodKey: string, options: { now?: Date; source?: 'web' | 'mcp' } = {}): Promise<VatSettlementResult> {
  const { view, basis } = await buildVatReturn(companyId, periodKey, options.now)
  if (view.status !== 'ready' || !basis || !view.computation) {
    throw new ConflictError('Aucune déclaration de TVA sur cette période : il n’y a rien à liquider.')
  }
  const { period } = basis
  if (!basis.fiscalYear) {
    throw new NotFoundError(`Aucun exercice ne couvre le ${period.end.slice(8, 10)}/${period.end.slice(5, 7)}/${period.end.slice(0, 4)} : créez l’exercice pour préparer l’écriture de liquidation.`)
  }
  const fiscalYear = basis.fiscalYear
  const reference = settlementReference(period)
  const planned = planSettlement({
    period,
    periodNetByCode: basis.periodNetByCode,
    creditCarried: basis.creditCarried,
    acomptes: basis.acomptes,
    dueEuros: view.computation.result.dueEuros,
    creditEuros: view.computation.result.creditEuros,
  })
  if (planned.length === 0) {
    return { status: 'nothing', reference, entryId: null, entryNumber: null, lines: planned, message: 'Aucun montant de TVA sur la période : il n’y a rien à liquider.' }
  }
  const description = settlementDescription(period)
  // Accounts named by their root (44551, 44567...) take the chart's own code (445510, 445670...).
  const chart = (
    await prisma.account.findMany({
      where: { companyId, fiscalYearId: fiscalYear.id, OR: SETTLEMENT_ROOTS.map((root) => ({ code: { startsWith: root } })) },
      select: { code: true },
      take: 500,
    })
  ).map((a) => a.code)
  for (const line of planned) {
    if (SETTLEMENT_ROOTS.includes(line.code)) line.code = resolveRootCode(line.code, chart)
  }
  const lines = netByAccount(planned)

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:vat-settlement:${companyId}:${reference}`}))`
    const locked = await lockFiscalYearRow(tx, fiscalYear.id, companyId)
    if (!locked) throw new NotFoundError('Exercice introuvable')
    if (locked.closed) throw new ClosedFiscalYearError(locked.year)

    const existing = await tx.accountingEntry.findMany({
      where: { companyId, reference },
      select: { id: true, status: true, entryNumber: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
      take: 20,
    })
    const validated = existing.find((e) => e.status === 'validated')
    if (validated) {
      return { status: 'validated' as const, entryId: validated.id, entryNumber: validated.entryNumber }
    }
    const asLines = (e: (typeof existing)[number]) =>
      e.lines.map((l) => ({ code: l.account.code, debitCents: parseCents(l.debit) ?? 0, creditCents: parseCents(l.credit) ?? 0 }))
    if (existing.length === 1 && sameLines(lines, asLines(existing[0]))) {
      return { status: 'unchanged' as const, entryId: existing[0].id, entryNumber: existing[0].entryNumber }
    }
    for (const draft of existing) await deleteDraftEntryInTx(tx, companyId, draft.id)

    const journal = await ensureJournal(tx, companyId, OD_JOURNAL)
    const accountIds = await ensureAccounts(tx, companyId, fiscalYear.id, lines.map(({ code, label }) => ({ code, label })))
    // The period may be closed already (automatic closing after the filing): first open day, real date as the document's
    const booking = await bookingDayInTx(tx, fiscalYear.id, period.end)
    const entry = await createEntryInTx(tx, {
      companyId,
      fiscalYearId: fiscalYear.id,
      journalId: journal.id,
      date: new Date(`${booking.date}T00:00:00.000Z`),
      ...(booking.pieceDate ? { pieceDate: booking.pieceDate } : {}),
      description,
      reference,
      status: 'draft',
      lines: lines.map((line) => ({
        accountId: accountIds.get(line.code) as string,
        debit: centsToDecimal(line.debitCents),
        credit: centsToDecimal(line.creditCents),
        description,
      })),
    })
    const created = await tx.accountingEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { entryNumber: true } })
    return { status: existing.length > 0 ? ('replaced' as const) : ('created' as const), entryId: entry.id, entryNumber: created.entryNumber, booking }
  }, TX_OPTIONS)

  if (result.status === 'created' || result.status === 'replaced') {
    await writeAuditLog('info', `VAT settlement prepared for ${period.form} ${period.id}`, {
      action: 'PREPARE_VAT_SETTLEMENT',
      companyId,
      metadata: { period: period.id, form: period.form, entryId: result.entryId, status: result.status, source: options.source ?? 'web' },
    })
  }
  const messages: Record<typeof result.status, string> = {
    created: `Écriture de liquidation préparée en brouillon (${result.entryNumber}) : vérifiez-la, puis validez-la une fois la déclaration déposée.`,
    replaced: `Le brouillon de liquidation ne correspondait plus à la déclaration : il est remplacé (${result.entryNumber}).`,
    unchanged: `Le brouillon de liquidation ${result.entryNumber} correspond déjà à la déclaration.`,
    validated: `L’écriture de liquidation ${result.entryNumber} est déjà validée : pour la corriger, contre-passez-la puis préparez-la à nouveau.`,
  }
  const moved = 'booking' in result && result.booking ? movedDraftNote(result.booking) : null
  const { entryId, entryNumber, status } = result
  return { status, entryId, entryNumber, reference, lines, message: moved ? `${messages[status]} ${moved}` : messages[status] }
}
