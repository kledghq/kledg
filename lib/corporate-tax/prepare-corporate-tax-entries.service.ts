/**
 * Draft entries of the impôt sur les sociétés (docs/impot-societes.md),
 * never validated: the user checks each draft and validates it like any
 * entry (PCG art. 1031-3).
 *
 * - charge: the IS of the year (and the contribution sociale), debit of
 *   695 "Impôts sur les bénéfices", credit of 444 "État, impôts sur les
 *   bénéfices", journal OD, on the last day of the fiscal year, reference
 *   "IS-2026" (PCG art. 944-44 for 444; 695 in the list of accounts).
 *   Credits d'impôt are booked by the user (their account depends on the
 *   credit);
 * - acompte n of the next fiscal year: debit of 444, credit of the bank
 *   (512), journal BQ, on its due date, reference "IS-AC-2027-1": the
 *   payment of the relevé 2571-SD, booked in the year that pays it.
 *
 * Idempotent, under an advisory lock per company and reference and the
 * lock of the fiscal year row: a draft with the same lines is kept
 * (unchanged), a stale draft is deleted and prepared again (replaced), a
 * validated entry is never touched (it is corrected by contre-passation).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ClosedFiscalYearError, ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { createEntryInTx, deleteDraftEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { ensureAccounts, ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { writeAuditLog } from '@/lib/audit'
import type { GroupAccess } from '@/lib/management-fees/access'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { resolveRootCode, sameLines, type SettlementLine } from '@/lib/vat-returns/settlement'
import { acompteReference, buildCorporateTax, chargeReference } from './load-corporate-tax.service'

export const CorporateTaxEntryBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('charge'), fiscalYearId: z.string({ error: 'L’exercice est requis' }).min(1).max(100) }),
  z.object({
    kind: z.literal('acompte'),
    fiscalYearId: z.string({ error: 'L’exercice est requis' }).min(1).max(100),
    number: z.number({ error: 'Le numéro de l’acompte est requis' }).int().min(1).max(8),
  }),
], { error: 'Indiquez l’écriture à préparer : charge ou acompte' })
export type CorporateTaxEntryBody = z.infer<typeof CorporateTaxEntryBodySchema>

export interface CorporateTaxEntryResult {
  status: 'created' | 'replaced' | 'unchanged' | 'validated' | 'nothing'
  reference: string
  entryId: string | null
  entryNumber: string | null
  lines: SettlementLine[]
  message: string
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const
const OD_JOURNAL = { code: 'OD', label: 'Opérations diverses' }
const BANK_JOURNAL = { code: 'BQ', label: 'Banque' }
export const IS_ACCOUNTS = {
  charge: { code: '695', label: 'Impôts sur les bénéfices' },
  state: { code: '444', label: 'État - Impôts sur les bénéfices' },
  bank: { code: '512', label: 'Banques' },
} as const

/** A draft entry to write (also used by the CFE drafts, lib/local-taxes). */
export interface Planned {
  fiscalYearId: string
  journal: { code: string; label: string }
  date: string
  description: string
  reference: string
  lines: SettlementLine[]
}

/** Accounts of the chart for the roots of the plan (695, 444, 512): the root, else the padded code, else the first below it. */
export async function resolveCodes(companyId: string, fiscalYearId: string, lines: SettlementLine[], preferred: string | null): Promise<SettlementLine[]> {
  const roots = lines.map((l) => l.code)
  const chart = (
    await prisma.account.findMany({ where: { companyId, fiscalYearId, OR: roots.map((root) => ({ code: { startsWith: root } })) }, select: { code: true }, take: 500 })
  ).map((a) => a.code)
  return lines.map((l) => {
    if (l.code === IS_ACCOUNTS.bank.code && preferred && chart.includes(preferred)) return { ...l, code: preferred }
    return { ...l, code: resolveRootCode(l.code, chart) }
  })
}

export type Written = { status: 'created' | 'replaced' | 'unchanged' | 'validated'; reference: string; entryId: string; entryNumber: string }

/**
 * Writes the draft of a plan, idempotent (see the module header). `scope`
 * names the advisory lock (one per company and reference): the CFE drafts
 * (lib/local-taxes) use their own.
 */
export async function writeDraft(companyId: string, plan: Planned, scope = 'corporate-tax-entry'): Promise<Written> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:${scope}:${companyId}:${plan.reference}`}))`
    const locked = await lockFiscalYearRow(tx, plan.fiscalYearId, companyId)
    if (!locked) throw new NotFoundError('Exercice introuvable')
    if (locked.closed) throw new ClosedFiscalYearError(locked.year)
    const existing = await tx.accountingEntry.findMany({
      where: { companyId, reference: plan.reference },
      select: { id: true, status: true, entryNumber: true, date: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
      take: 20,
    })
    const validated = existing.find((e) => e.status === 'validated')
    if (validated) return { status: 'validated' as const, reference: plan.reference, entryId: validated.id, entryNumber: validated.entryNumber }
    const asLines = (e: (typeof existing)[number]) => e.lines.map((l) => ({ code: l.account.code, debitCents: parseCents(l.debit) ?? 0, creditCents: parseCents(l.credit) ?? 0 }))
    // Same lines on the same day: kept; a draft dated elsewhere (a payment day recorded since) is stale.
    if (existing.length === 1 && sameLines(plan.lines, asLines(existing[0])) && existing[0].date.toISOString().slice(0, 10) === plan.date) {
      return { status: 'unchanged' as const, reference: plan.reference, entryId: existing[0].id, entryNumber: existing[0].entryNumber }
    }
    for (const draft of existing) await deleteDraftEntryInTx(tx, companyId, draft.id)
    const journal = await ensureJournal(tx, companyId, plan.journal)
    const accountIds = await ensureAccounts(tx, companyId, plan.fiscalYearId, plan.lines.map(({ code, label }) => ({ code, label })))
    const entry = await createEntryInTx(tx, {
      companyId,
      fiscalYearId: plan.fiscalYearId,
      journalId: journal.id,
      date: new Date(`${plan.date}T00:00:00.000Z`),
      description: plan.description,
      reference: plan.reference,
      status: 'draft',
      lines: plan.lines.map((line) => ({
        accountId: accountIds.get(line.code) as string,
        debit: centsToDecimal(line.debitCents),
        credit: centsToDecimal(line.creditCents),
        description: plan.description,
      })),
    })
    const created = await tx.accountingEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { entryNumber: true } })
    return { status: existing.length > 0 ? ('replaced' as const) : ('created' as const), reference: plan.reference, entryId: entry.id, entryNumber: created.entryNumber }
  }, TX_OPTIONS)
}

const fr = (cents: number) => (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function prepareCorporateTaxEntry(
  companyId: string,
  body: CorporateTaxEntryBody,
  options: { now?: Date; source?: 'web' | 'mcp'; access?: GroupAccess | null } = {},
): Promise<CorporateTaxEntryResult> {
  const { view, fiscalYear, nextFiscalYear } = await buildCorporateTax(companyId, { fiscalYearId: body.fiscalYearId }, { now: options.now, access: options.access ?? null })
  if (view.status !== 'ready' || !view.computation || !fiscalYear) {
    throw new ConflictError('La société n’est pas soumise à l’impôt sur les sociétés pour cet exercice : il n’y a pas d’écriture à préparer.')
  }

  let plan: Planned
  let preferredBank: string | null = null
  if (body.kind === 'charge') {
    const amount = view.computation.corporateTaxCents + view.computation.socialContribution.cents
    const reference = chargeReference(fiscalYear.year)
    if (amount <= 0) return { status: 'nothing', reference, entryId: null, entryNumber: null, lines: [], message: 'Aucun impôt sur les sociétés pour cet exercice : il n’y a rien à comptabiliser.' }
    const description = `Impôt sur les sociétés de l’exercice ${fiscalYear.year}`
    plan = {
      fiscalYearId: fiscalYear.id,
      journal: OD_JOURNAL,
      date: fiscalYear.endDate,
      description,
      reference,
      lines: [
        { ...IS_ACCOUNTS.charge, debitCents: amount, creditCents: 0 },
        { ...IS_ACCOUNTS.state, debitCents: 0, creditCents: amount },
      ],
    }
  } else {
    const schedule = view.acomptes
    const item = schedule?.items.find((i) => i.number === body.number)
    if (!schedule || !item) throw new NotFoundError(`Aucun acompte n° ${body.number} pour l’exercice suivant.`)
    const reference = acompteReference(schedule.exercice.year, item.number)
    if (item.amountCents === null) throw new ConflictError('Le montant de cet acompte n’est pas connu : enregistrez le dépôt de l’exercice précédent.')
    if (item.amountCents <= 0) return { status: 'nothing', reference, entryId: null, entryNumber: null, lines: [], message: 'Cet acompte est nul : il n’y a rien à comptabiliser.' }
    if (!nextFiscalYear) throw new NotFoundError('L’exercice qui paie cet acompte n’existe pas encore : créez-le pour préparer l’écriture de paiement.')
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { defaultBankAccountCode: true } })
    preferredBank = company?.defaultBankAccountCode ?? null
    const description = `Acompte n° ${item.number} d’impôt sur les sociétés, exercice ${schedule.exercice.year}`
    plan = {
      fiscalYearId: nextFiscalYear.id,
      journal: BANK_JOURNAL,
      date: item.date,
      description,
      reference,
      lines: [
        { ...IS_ACCOUNTS.state, debitCents: item.amountCents, creditCents: 0 },
        { ...IS_ACCOUNTS.bank, debitCents: 0, creditCents: item.amountCents },
      ],
    }
  }
  plan.lines = await resolveCodes(companyId, plan.fiscalYearId, plan.lines, preferredBank)
  const result = await writeDraft(companyId, plan)

  if (result.status === 'created' || result.status === 'replaced') {
    await writeAuditLog('info', `Corporate tax ${body.kind} draft prepared (${plan.reference})`, {
      action: 'PREPARE_CORPORATE_TAX_ENTRY',
      companyId,
      metadata: { fiscalYearId: body.fiscalYearId, kind: body.kind, reference: plan.reference, entryId: result.entryId, status: result.status, source: options.source ?? 'web' },
    })
  }
  const amount = fr(plan.lines[0].debitCents)
  const messages: Record<typeof result.status, string> = {
    created: `Écriture préparée en brouillon (${result.entryNumber}, ${amount} €) : vérifiez-la, puis validez-la.`,
    replaced: `Le brouillon ne correspondait plus au calcul : il est remplacé (${result.entryNumber}, ${amount} €).`,
    unchanged: `Le brouillon ${result.entryNumber} correspond déjà au calcul.`,
    validated: `L’écriture ${result.entryNumber} est déjà validée : pour la corriger, contre-passez-la puis préparez-la à nouveau.`,
  }
  return { ...result, lines: plan.lines, message: messages[result.status] }
}
