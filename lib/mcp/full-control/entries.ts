/**
 * Full control tools on accounting entries: validate drafts (definitive
 * numbers), reverse a validated entry (contre-passation), edit or delete a
 * draft. Thin wrappers over lib/accounting/services/entry-lifecycle.service.ts,
 * which enforces PCG art. 1031-3 (validated entries are definitive) and the
 * closed year locks; the database triggers back them.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { deleteDraftEntry, reverseEntry, updateAccountingEntry, validateEntries } from '@/lib/accounting/services'
import { nextDefinitiveEntryNumber } from '@/lib/accounting/services/generate-next-entry-number.service'
import { fiscalYearContaining, GUARDED_FISCAL_YEAR_SELECT, isFiscalYearClosed } from '@/lib/accounting/entry-guards'
import { calendarDayOf } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { NotFoundError } from '@/lib/accounting/errors'
import { day } from '@/lib/mcp/tool-result'
import { fullControlTool, type RegisterTool } from './define'
import { entriesState } from './fingerprint'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'
import { accountIdsByCode, euros, fiscalYearOfDay, isoDate, journalIdByCode } from './resolve'

const ENTRY_NOT_FOUND = 'Écriture introuvable'
const MAX_ENTRIES = 200

const ENTRY_SUMMARY_SELECT = {
  id: true,
  entryNumber: true,
  status: true,
  date: true,
  description: true,
  reference: true,
  createdAt: true,
  fiscalYearId: true,
  journal: { select: { code: true } },
  lines: {
    select: { debit: true, credit: true, description: true, account: { select: { code: true, label: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
}

type EntrySummaryRow = {
  id: string
  entryNumber: string
  status: string
  date: Date
  description: string | null
  reference: string | null
  journal: { code: string }
  lines: Array<{ debit: { toString(): string }; credit: { toString(): string }; description: string | null; account: { code: string; label: string } }>
}

function cents(value: { toString(): string }): number {
  return parseCents(value.toString()) ?? 0
}

function summarize(entry: EntrySummaryRow) {
  const debitCents = entry.lines.reduce((s, l) => s + cents(l.debit), 0)
  const creditCents = entry.lines.reduce((s, l) => s + cents(l.credit), 0)
  return {
    id: entry.id,
    number: entry.entryNumber,
    status: entry.status,
    date: day(entry.date),
    journal: entry.journal.code,
    description: entry.description,
    reference: entry.reference,
    totalDebit: debitCents / 100,
    totalCredit: creditCents / 100,
    balanced: debitCents === creditCents,
    lines: entry.lines.map((l) => ({
      account: l.account.code,
      accountLabel: l.account.label,
      debit: cents(l.debit) / 100,
      credit: cents(l.credit) / 100,
      label: l.description,
    })),
  }
}

const entryIdsInput = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_ENTRIES)
  .describe('Ids of draft entries (from list_entries with status "draft", or create_draft_entry).')

const validateEntriesTool = fullControlTool({
  name: 'validate_entries',
  title: 'Valider des écritures',
  description: `Validates draft entries (validation des écritures): each one gets its definitive number in the fiscal year sequence, in date order, and can never be edited or deleted afterwards (PCG art. 1031-3), only reversed. ${ACTS_AS_USER} ${TWO_STEP} The dry run lists the entries, their totals, the numbers they would receive and the problems that would make some fail (unbalanced, closed fiscal year, already validated).`,
  input: { entryIds: entryIdsInput },
  permission: { entries: ['validate'] },
  amounts: 'euros',
  never: 'validates an unbalanced entry, an entry of a closed fiscal year or of another company; a validated entry can then only be reversed.',
  confirmation: true,
  destructive: true,
  // The approval covers the drafts as the user saw them: an edit before the execution refuses it.
  targetState: ({ companyId, entryIds }) => entriesState(companyId, entryIds),
  async preview({ companyId, entryIds }) {
    const ids = [...new Set(entryIds)]
    const rows = await prisma.accountingEntry.findMany({
      where: { id: { in: ids }, companyId },
      select: { ...ENTRY_SUMMARY_SELECT, fiscalYear: { select: GUARDED_FISCAL_YEAR_SELECT } },
    })
    const found = new Set(rows.map((r) => r.id))
    const warnings: string[] = ids.filter((id) => !found.has(id)).map((id) => `${id} : ${ENTRY_NOT_FOUND}.`)
    // Same order as validateEntries: date, then creation.
    rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
    const next = new Map<string, number>()
    const entries = []
    for (const row of rows) {
      const summary = summarize(row)
      let problem: string | null = null
      if (row.status === 'validated') problem = `Déjà validée (n° ${row.entryNumber}).`
      else if (isFiscalYearClosed(row.fiscalYear)) problem = `Exercice ${row.fiscalYear.year} clôturé.`
      else if (!summary.balanced) problem = 'Écriture déséquilibrée : débits et crédits diffèrent.'
      let numberToAssign: string | null = null
      if (!problem) {
        if (!next.has(row.fiscalYearId)) next.set(row.fiscalYearId, Number(await nextDefinitiveEntryNumber(row.fiscalYearId)))
        const n = next.get(row.fiscalYearId)!
        numberToAssign = String(n)
        next.set(row.fiscalYearId, n + 1)
      } else {
        warnings.push(`Écriture ${row.entryNumber} : ${problem}`)
      }
      entries.push({ ...summary, fiscalYear: row.fiscalYear.year, numberToAssign, problem })
    }
    const ok = entries.filter((e) => e.numberToAssign)
    const okIds = new Set(ok.map((e) => e.id))
    const totalDebitCents = rows
      .filter((r) => okIds.has(r.id))
      .reduce((s, r) => s + r.lines.reduce((t, l) => t + cents(l.debit), 0), 0)
    return {
      toValidate: ok.length,
      refused: entries.length - ok.length + (ids.length - rows.length),
      totalDebit: totalDebitCents / 100,
      entries,
      warnings,
      note: "Numéros indicatifs : ils sont attribués à la validation, dans la suite de l'exercice, et peuvent avancer si une autre écriture est validée entre-temps.",
    }
  },
  async execute({ companyId, entryIds }) {
    const { validated, errors } = await validateEntries(companyId, [...new Set(entryIds)])
    return {
      validated: validated.map((e) => ({ id: e.id, number: e.entryNumber, date: day(e.date) })),
      failed: errors,
    }
  },
  audit: (_args, result) => ({
    entryIds: result.validated.map((e) => e.id),
    entryNumbers: result.validated.map((e) => e.number),
    failedEntryIds: result.failed.map((f) => f.entryId),
  }),
})

const reverseInput = {
  entryId: z.string().min(1).describe('Id of the validated entry to reverse (from list_entries).'),
  date: isoDate.optional().describe('Date of the reversing entry (yyyy-mm-dd), in an open fiscal year. Defaults to the original date.'),
}

const reverseEntryTool = fullControlTool({
  name: 'reverse_entry',
  title: 'Contre-passer une écriture',
  description: `Reverses a validated entry (contre-passation): creates and validates a new entry with debits and credits swapped, linked to the original, dated like it or on the given day of an open fiscal year. This is the only way to correct a validated entry. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: reverseInput,
  permission: { entries: ['create', 'validate'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  never: 'deletes or edits the validated entry: it adds the reversing entry.',
  confirmation: true,
  destructive: true,
  async preview({ companyId, entryId, date }) {
    const entry = await prisma.accountingEntry.findFirst({
      where: { id: entryId, companyId },
      select: { ...ENTRY_SUMMARY_SELECT, reversedBy: { select: { entryNumber: true } } },
    })
    if (!entry) throw new NotFoundError(ENTRY_NOT_FOUND)
    const summary = summarize(entry)
    const reversalDay = date ?? calendarDayOf(entry.date)!
    const fiscalYears = await prisma.fiscalYear.findMany({ where: { companyId }, select: GUARDED_FISCAL_YEAR_SELECT })
    const target = fiscalYearContaining(fiscalYears, reversalDay)
    const warnings: string[] = []
    if (entry.status !== 'validated') warnings.push('Seule une écriture validée peut être contre-passée : un brouillon se modifie ou se supprime.')
    if (entry.reversedBy) warnings.push(`Déjà contre-passée par l'écriture n° ${entry.reversedBy.entryNumber}.`)
    if (!target) warnings.push(`Aucun exercice ne couvre le ${reversalDay}.`)
    else if (isFiscalYearClosed(target)) warnings.push(`L'exercice ${target.year} est clôturé : choisissez une date de l'exercice ouvert.`)
    return {
      original: summary,
      reversal: {
        date: reversalDay,
        fiscalYear: target?.year ?? null,
        journal: summary.journal,
        description: `Contre-passation de l'écriture n° ${entry.entryNumber}${entry.description ? ` : ${entry.description}` : ''}`,
        status: 'validated',
        lines: summary.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
      },
      warnings,
    }
  },
  async execute({ companyId, entryId, date }) {
    const reversal = await reverseEntry(companyId, entryId, { date })
    return { reversalEntryId: reversal.id, number: reversal.entryNumber, date: day(reversal.date), reversedEntryId: entryId }
  },
  audit: ({ entryId }, result) => ({ entryId, reversalEntryId: result.reversalEntryId, reversalNumber: result.number }),
})

const lineInput = z.object({
  accountCode: z.string().min(1).describe('Existing account number from search_accounts.'),
  debit: euros.default(0),
  credit: euros.default(0),
  label: z.string().max(500).optional(),
})

const updateInput = {
  entryId: z.string().min(1).describe('Id of the draft entry (from list_entries with status "draft").'),
  journalCode: z.string().optional().describe('New journal code, e.g. "AC", "VE", "BQ", "OD".'),
  date: isoDate.optional(),
  description: z.string().min(1).max(500).optional(),
  reference: z.string().max(200).optional(),
  lines: z
    .array(lineInput)
    .min(2)
    .max(200)
    .optional()
    .describe('Replaces every line. Debits must equal credits. Amounts in euros.'),
}

const updateDraftEntryTool = fullControlTool({
  name: 'update_draft_entry',
  title: 'Modifier un brouillon',
  description: `Edits a DRAFT entry: journal, date, description, reference or all its lines (amounts in euros, balanced). A validated entry is refused: reverse it with reverse_entry instead. The entry stays a draft; use validate_entries to validate it. ${ACTS_AS_USER}`,
  input: updateInput,
  permission: { entries: ['update'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  never: 'changes a validated entry (refused).',
  confirmation: false,
  idempotent: true,
  async execute({ companyId, entryId, journalCode, date, description, reference, lines }) {
    const existing = await prisma.accountingEntry.findFirst({ where: { id: entryId, companyId }, select: { date: true } })
    if (!existing) throw new NotFoundError(ENTRY_NOT_FOUND)
    let accountLines
    if (lines) {
      const fiscalYear = await fiscalYearOfDay(companyId, date ?? calendarDayOf(existing.date)!)
      const byCode = await accountIdsByCode(companyId, fiscalYear.id, lines.map((l) => l.accountCode))
      accountLines = lines.map((l) => ({
        accountId: byCode.get(l.accountCode)!,
        debit: l.debit,
        credit: l.credit,
        description: l.label ?? null,
      }))
    }
    const entry = await updateAccountingEntry(
      entryId,
      {
        ...(journalCode && { journalId: await journalIdByCode(companyId, journalCode) }),
        ...(date && { date }),
        ...(description !== undefined && { description }),
        ...(reference !== undefined && { reference }),
        ...(accountLines && { lines: accountLines }),
      },
      companyId,
    )
    return summarize(entry)
  },
  audit: ({ entryId }) => ({ entryId }),
})

const deleteInput = { entryId: z.string().min(1).describe('Id of the draft entry to delete.') }

const deleteDraftEntryTool = fullControlTool({
  name: 'delete_draft_entry',
  title: 'Supprimer un brouillon',
  description: `Deletes a DRAFT entry and its lines. A validated entry is refused: reverse it with reverse_entry instead. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: deleteInput,
  permission: { entries: ['delete'] },
  amounts: 'none',
  never: 'deletes a validated entry (refused).',
  confirmation: true,
  destructive: true,
  targetState: ({ companyId, entryId }) => entriesState(companyId, [entryId]),
  async preview({ companyId, entryId }) {
    const entry = await prisma.accountingEntry.findFirst({ where: { id: entryId, companyId }, select: ENTRY_SUMMARY_SELECT })
    if (!entry) throw new NotFoundError(ENTRY_NOT_FOUND)
    const warnings =
      entry.status === 'validated'
        ? [`L'écriture n° ${entry.entryNumber} est validée : la suppression sera refusée (PCG art. 1031-3). Utilisez reverse_entry.`]
        : []
    return { entryToDelete: summarize(entry), warnings }
  },
  async execute({ companyId, entryId }) {
    const deleted = await deleteDraftEntry(companyId, entryId)
    return { deleted: true, entryId: deleted.id }
  },
  audit: ({ entryId }) => ({ entryId }),
})

export function registerEntryTools(register: RegisterTool) {
  register(validateEntriesTool)
  register(reverseEntryTool)
  register(updateDraftEntryTool)
  register(deleteDraftEntryTool)
}
