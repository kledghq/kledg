/**
 * Accountant validation of the entries confirmed in simple mode
 * (docs/categories-simples.md).
 *
 * - simpleValidationSummary: what the simple home shows ("12 dépenses
 *   classées ce mois-ci : 9 validées, 3 en attente de sa validation"),
 *   counted on the entry dates of a period.
 * - listSimpleModeEntries: the expert view "Saisies du mode simple à
 *   valider": each entry with its category, the answers, the note, its
 *   lines, its transaction and the fixed asset created with it ("Immobilisation
 *   créée : <label>, amortie sur N ans", durable equipment), or the sales
 *   invoice a customer payment settles (recorded on the invoice once the
 *   entry is validated, invoice-receipts.service.ts). Validation itself goes through the usual
 *   service (POST /api/entries/bulk-validate, validateEntries: definitive
 *   number in date order, PCG art. 1031-3); a correction through the entry
 *   form, as for any draft.
 *
 * "To validate" is a draft entry of simple mode; "validated" one that a
 * person validated, or that was validated at once without accountant review.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { calendarDay } from '@/lib/api/zod-fields'
import { toCents } from '@/lib/utils/money'
import { isoDateToUtc, toIsoDateUtc } from '@/lib/utils/date'
import { findCategory } from './categories'
import { displayNameOf } from './payees'
import { fixedAssetMention } from './asset-lifetimes'
import { getSimpleModeSettings, type Accountant } from './simple-mode-settings.service'

export interface ValidationPeriod {
  /** yyyy-mm-dd, both included. */
  from: string
  to: string
}

export interface SimpleValidationSummary {
  period: ValidationPeriod
  /** Entries confirmed in simple mode whose date is in the period. */
  classifiedCount: number
  validatedCount: number
  toValidateCount: number
  /** Whether simple mode entries wait for the accountant, and who they are. */
  accountantReview: boolean
  accountants: Accountant[]
}

function assertPeriod(period: ValidationPeriod): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.from) || !/^\d{4}-\d{2}-\d{2}$/.test(period.to) || period.from > period.to) {
    throw new ValidationError('Période invalide : deux dates AAAA-MM-JJ, la première avant la seconde.')
  }
}

/** Progress of the accountant's validation over a period (entry dates). */
export async function simpleValidationSummary(companyId: string, period: ValidationPeriod): Promise<SimpleValidationSummary> {
  assertPeriod(period)
  const date = { gte: isoDateToUtc(period.from), lte: isoDateToUtc(period.to) }
  const [groups, settings] = await Promise.all([
    prisma.accountingEntry.groupBy({ by: ['status'], where: { companyId, date, simpleModeEntry: { isNot: null } }, _count: { _all: true } }),
    getSimpleModeSettings(companyId),
  ])
  const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0
  const validatedCount = count('validated')
  const toValidateCount = count('draft')
  return {
    period,
    classifiedCount: validatedCount + toValidateCount,
    validatedCount,
    toValidateCount,
    accountantReview: settings.accountantReview,
    accountants: settings.accountants,
  }
}

/** ?companyId=&status=&from=&to=&limit= */
export const SimpleModeEntriesQuerySchema = z.object({
  status: z.enum(['to-validate', 'validated', 'all'], { error: 'Statut inconnu : to-validate, validated ou all' }).default('to-validate'),
  from: calendarDay('Date de début invalide').optional(),
  to: calendarDay('Date de fin invalide').optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export interface SimpleModeEntryView {
  entryId: string
  entryNumber: string
  status: 'draft' | 'validated'
  /** yyyy-mm-dd */
  date: string
  description: string | null
  name: string
  categoryId: string | null
  categoryLabel: string | null
  ruleId: string | null
  answers: Record<string, string> | null
  /** Answers in plain words: "Avec qui était ce repas ? Avec des clients ou partenaires". */
  answerLabels: string[]
  note: string | null
  needsReview: boolean
  source: string
  amountCents: number
  lines: Array<{ accountCode: string; accountLabel: string; debitCents: number; creditCents: number; description: string | null }>
  transactionId: string | null
  hasReceipt: boolean
  /** Fixed asset created with the entry (durable equipment), and the mention shown to the accountant. */
  fixedAsset: { id: string; label: string; years: number | null; mention: string } | null
  /** Sales invoice a customer payment settles, and whether the payment is recorded on it yet. */
  invoice: { id: string; number: string; customerName: string; recorded: boolean } | null
  createdAt: string
}

export interface SimpleModeEntryList {
  items: SimpleModeEntryView[]
  summary: SimpleValidationSummary
}

function answerLabels(categoryId: string | null, answers: Record<string, string> | null): string[] {
  const question = findCategory(categoryId)?.question
  if (!question || !answers?.[question.id]) return []
  const answer = question.answers.find((a) => a.id === answers[question.id])
  return answer ? [`${question.text} ${answer.label}`] : []
}

/** Entries confirmed in simple mode, the drafts to validate first by default. */
export async function listSimpleModeEntries(companyId: string, query: z.output<typeof SimpleModeEntriesQuerySchema>): Promise<SimpleModeEntryList> {
  const status = query.status === 'to-validate' ? 'draft' : query.status === 'validated' ? 'validated' : undefined
  const rows = await prisma.simpleModeEntry.findMany({
    where: {
      companyId,
      entry: {
        ...(status ? { status } : {}),
        ...(query.from || query.to ? { date: { ...(query.from ? { gte: isoDateToUtc(query.from) } : {}), ...(query.to ? { lte: isoDateToUtc(query.to) } : {}) } } : {}),
      },
    },
    select: {
      categoryId: true,
      ruleId: true,
      answers: true,
      note: true,
      needsReview: true,
      source: true,
      createdAt: true,
      bankTransactionId: true,
      fixedAsset: { select: { id: true, label: true, depreciationDuration: true } },
      invoice: { select: { id: true, number: true, tiers: { select: { name: true } } } },
      bankTransaction: { select: { label: true, counterpartyName: true, providerData: true, _count: { select: { attachments: true } } } },
      entry: {
        select: {
          id: true,
          entryNumber: true,
          status: true,
          date: true,
          description: true,
          lines: {
            select: { debit: true, credit: true, description: true, account: { select: { code: true, label: true } }, _count: { select: { invoicePayments: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
    orderBy: [{ entry: { date: 'asc' } }, { createdAt: 'asc' }],
    take: query.limit,
  })
  const today = toIsoDateUtc(new Date())
  const firstOfMonth = `${today.slice(0, 7)}-01`
  const summary = await simpleValidationSummary(companyId, { from: query.from ?? firstOfMonth, to: query.to ?? today })
  return {
    summary,
    items: rows.map((row) => {
      const lines = row.entry.lines.map((l) => ({
        accountCode: l.account.code,
        accountLabel: l.account.label,
        debitCents: toCents(l.debit) ?? 0,
        creditCents: toCents(l.credit) ?? 0,
        description: l.description,
      }))
      const answers = (row.answers as Record<string, string> | null) ?? null
      const transaction = row.bankTransaction
      return {
        entryId: row.entry.id,
        entryNumber: row.entry.entryNumber,
        status: row.entry.status === 'validated' ? 'validated' : 'draft',
        date: toIsoDateUtc(row.entry.date),
        description: row.entry.description,
        name: transaction ? displayNameOf(transaction.counterpartyName, transaction.label) : (row.entry.description ?? ''),
        categoryId: row.categoryId,
        categoryLabel: findCategory(row.categoryId)?.label ?? (row.invoice ? `Paiement de la facture n° ${row.invoice.number}` : null),
        ruleId: row.ruleId,
        answers,
        answerLabels: answerLabels(row.categoryId, answers),
        note: row.note,
        needsReview: row.needsReview,
        source: row.source,
        amountCents: lines.reduce((sum, l) => sum + l.debitCents, 0),
        lines,
        transactionId: row.bankTransactionId,
        hasReceipt: (transaction?._count.attachments ?? 0) > 0,
        fixedAsset: row.fixedAsset
          ? { id: row.fixedAsset.id, label: row.fixedAsset.label, years: row.fixedAsset.depreciationDuration, mention: fixedAssetMention(row.fixedAsset.label, row.fixedAsset.depreciationDuration) }
          : null,
        invoice: row.invoice
          ? { id: row.invoice.id, number: row.invoice.number, customerName: row.invoice.tiers.name, recorded: row.entry.lines.some((l) => l._count.invoicePayments > 0) }
          : null,
        createdAt: row.createdAt.toISOString(),
      }
    }),
  }
}
