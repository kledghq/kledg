/**
 * Life cycle of an accounting entry: draft, validated, reversed.
 *
 * - A draft can be edited and deleted. It has a provisional number.
 * - Validation is the "procédure de validation, qui interdit toute
 *   modification ou suppression de l'enregistrement" (PCG art. 1031-3): the
 *   entry gets its definitive number in the fiscal year sequence (see
 *   generate-next-entry-number.service.ts) and its validation date (FEC
 *   ValidDate, LPF art. A47 A-1). It can never be edited, deleted or reopened.
 * - A validated entry is corrected by a reversing entry (contre-passation):
 *   a new validated entry with debits and credits swapped, linked to it.
 *
 * Database triggers (migration 20261003180000) enforce the same rules for any
 * code path; these services check first to answer with precise messages.
 * Every write goes through assertEntryWritableInFiscalYear (closed years).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { deleteFixedAssetsAcquiredByEntryInTx } from '@/lib/fixed-assets/delete-fixed-asset.service'
import { syncFixedAssetsAcquiredByEntryInTx } from '@/lib/fixed-assets/acquisition-entry'
import { ConflictError, NotFoundError, ValidationError, handleError } from '../errors'
import { validateAccountingEntry, validateEntryBalance } from '../validator'
import { amountTooLargeMessage, centsToDecimal, exceedsAmountColumn, parseCents, type AmountInput } from '@/lib/utils/money'
import { dayToDate, toEntryDate } from '../entry-date'
import { calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'
import {
  assertEntryWritableInFiscalYear,
  fiscalYearContaining,
  GUARDED_FISCAL_YEAR_SELECT,
  type EntryWriteAction,
} from '../entry-guards'
import type { EntryStatus } from '../types'
import type { PCGWarning } from './types'
import {
  lockEntryNumbering,
  nextDefinitiveEntryNumber,
  provisionalEntryNumber,
} from './generate-next-entry-number.service'

type Db = Prisma.TransactionClient

/** Message for any attempt to change a validated entry. */
export function immutableEntryMessage(entryNumber: string): string {
  return `L'écriture n° ${entryNumber} est validée\u00a0: elle ne peut plus être modifiée ni supprimée (PCG art. 1031-3). Passez une écriture de contre-passation.`
}

export interface EntryLineInput {
  accountId: string
  debit?: AmountInput
  credit?: AmountInput
  description?: string | null
  auxiliaryAccountNumber?: string | null
  auxiliaryAccountLabel?: string | null
  letteringCode?: string | null
  letteringDate?: Date | string | null
  currencyAmount?: AmountInput
  currencyCode?: string | null
}

export interface NormalizedLine {
  accountId: string
  debitCents: number
  creditCents: number
  description: string | null
  auxiliaryAccountNumber: string | null
  auxiliaryAccountLabel: string | null
  letteringCode: string | null
  letteringDate: Date | null
  currencyAmountCents: number | null
  currencyCode: string | null
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Cents of an amount, throwing a French ValidationError naming the field. */
export function requireCents(value: AmountInput, field: string): number {
  const cents = parseCents(value)
  if (cents === null) {
    if (exceedsAmountColumn(value)) throw new ValidationError(`${field}\u00a0: ${amountTooLargeMessage()}`)
    throw new ValidationError(`${field}\u00a0: montant invalide (nombre décimal avec deux décimales au maximum)`)
  }
  return cents
}

/** Exact cents per line; amounts with more than two decimals are refused. */
export function normalizeLines(lines: EntryLineInput[]): NormalizedLine[] {
  if (!Array.isArray(lines)) throw new ValidationError("Les lignes de l'écriture sont obligatoires")
  return lines.map((line, index) => {
    const n = index + 1
    const currency = line.currencyAmount === undefined || line.currencyAmount === null || line.currencyAmount === ''
      ? null
      : requireCents(line.currencyAmount, `Ligne ${n}, montant en devise`)
    return {
      accountId: typeof line.accountId === 'string' ? line.accountId : '',
      debitCents: requireCents(line.debit, `Ligne ${n}, débit`),
      creditCents: requireCents(line.credit, `Ligne ${n}, crédit`),
      description: text(line.description),
      auxiliaryAccountNumber: text(line.auxiliaryAccountNumber),
      auxiliaryAccountLabel: text(line.auxiliaryAccountLabel),
      letteringCode: text(line.letteringCode),
      letteringDate: line.letteringDate ? toEntryDate(line.letteringDate, `Ligne ${n}, date de lettrage`) : null,
      currencyAmountCents: currency,
      currencyCode: text(line.currencyCode),
    }
  })
}

/** Lines as numbers for the PCG checks of validateAccountingEntry (exact: at most two decimals). */
function asCheckedLines(lines: NormalizedLine[]) {
  return lines.map((l) => ({ accountId: l.accountId, debit: l.debitCents / 100, credit: l.creditCents / 100 }))
}

/** Throws a French ValidationError unless the lines form a valid, balanced entry. */
export function assertValidEntry(date: Date, description: string | null | undefined, lines: NormalizedLine[]): void {
  const validation = validateAccountingEntry({
    date,
    description: description ?? undefined,
    lines: asCheckedLines(lines),
  })
  if (!validation.valid) throw new ValidationError(validation.errors.join(', '))
}

async function assertJournal(db: Db, journalId: string | undefined, companyId: string): Promise<void> {
  const journal = journalId
    ? await db.journal.findFirst({ where: { id: journalId, companyId }, select: { id: true } })
    : null
  if (!journal) throw new ValidationError('Journal introuvable pour cette société')
}

/**
 * Fiscal year of the lines: all accounts must belong to the company and to
 * one fiscal year (accounts are per fiscal year), the given one if any.
 */
async function fiscalYearOfAccounts(
  db: Db,
  companyId: string,
  lines: NormalizedLine[],
  expectedFiscalYearId?: string,
): Promise<string> {
  const ids = [...new Set(lines.map((l) => l.accountId).filter(Boolean))]
  const accounts = ids.length
    ? await db.account.findMany({ where: { id: { in: ids }, companyId }, select: { id: true, code: true, fiscalYearId: true } })
    : []
  const byId = new Map(accounts.map((a) => [a.id, a]))
  for (const id of ids) {
    const account = byId.get(id)
    if (!account) throw new ValidationError(`Compte ${id} non trouvé`)
    if (!account.fiscalYearId) throw new ValidationError(`Le compte ${account.code} n'a pas d'exercice fiscal associé`)
  }
  const fiscalYearIds = [...new Set(accounts.map((a) => a.fiscalYearId as string))]
  if (expectedFiscalYearId && fiscalYearIds.some((id) => id !== expectedFiscalYearId)) {
    const wrong = accounts.filter((a) => a.fiscalYearId !== expectedFiscalYearId).map((a) => a.code)
    throw new ValidationError(`Les comptes ${wrong.join(', ')} n'appartiennent pas à l'exercice fiscal sélectionné`)
  }
  if (fiscalYearIds.length > 1) {
    throw new ValidationError(
      `Tous les comptes d'une écriture doivent appartenir au même exercice fiscal. Comptes trouvés\u00a0: ${accounts.map((a) => a.code).join(', ')}`,
    )
  }
  const fiscalYearId = expectedFiscalYearId ?? fiscalYearIds[0]
  if (!fiscalYearId) throw new ValidationError('Exercice introuvable pour cette écriture')
  return fiscalYearId
}

async function guardFiscalYear(
  db: Db,
  companyId: string,
  fiscalYearId: string,
  date: Date | string,
  action: EntryWriteAction,
): Promise<void> {
  const fiscalYear = await db.fiscalYear.findFirst({
    where: { id: fiscalYearId, companyId },
    select: GUARDED_FISCAL_YEAR_SELECT,
  })
  if (!fiscalYear) throw new ValidationError('Exercice introuvable pour cette société')
  assertEntryWritableInFiscalYear(fiscalYear, date, action)
}

function lineRows(entryId: string, entryNumber: string, fiscalYearId: string, lines: NormalizedLine[]) {
  return lines.map((line) => ({
    accountingEntryId: entryId,
    accountingEntryNumber: entryNumber,
    accountId: line.accountId,
    accountFiscalYearId: fiscalYearId,
    debit: new Prisma.Decimal(centsToDecimal(line.debitCents)),
    credit: new Prisma.Decimal(centsToDecimal(line.creditCents)),
    description: line.description,
    auxiliaryAccountNumber: line.auxiliaryAccountNumber,
    auxiliaryAccountLabel: line.auxiliaryAccountLabel,
    letteringCode: line.letteringCode,
    letteringDate: line.letteringDate,
    currencyAmount: line.currencyAmountCents === null ? null : new Prisma.Decimal(centsToDecimal(line.currencyAmountCents)),
    currencyCode: line.currencyCode,
  }))
}

export const ENTRY_INCLUDE = {
  journal: true,
  lines: { include: { account: true }, orderBy: { createdAt: 'asc' } },
  reversalOf: { select: { id: true, entryNumber: true, date: true } },
  reversedBy: { select: { id: true, entryNumber: true, date: true, status: true } },
} satisfies Prisma.AccountingEntryInclude

export type EntryWithRelations = Prisma.AccountingEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>

export interface CreateEntryInput {
  companyId: string
  journalId: string
  date: Date | string
  description?: string | null
  reference?: string | null
  pieceDate?: Date | string | null
  status?: EntryStatus
  lines: EntryLineInput[]
  /** Checked against the accounts of the lines when given. */
  fiscalYearId?: string
  /** For a reversing entry: the validated entry it cancels. */
  reversalOfId?: string
}

/** PCG warnings that do not block the entry. */
export function entryWarnings(description: string | null | undefined): PCGWarning[] {
  if (description && description.trim().length > 0) return []
  return [
    {
      code: 'PCG-511-1',
      message: 'Description vide, considérer ajouter une description significative pour la clarté (PCG Art. 511-1)',
      severity: 'info',
      article: '511-1',
    },
  ]
}

/**
 * Creates an entry inside a transaction. Drafts get a provisional number;
 * with status "validated" the entry is validated in the same transaction.
 */
export async function createEntryInTx(db: Db, input: CreateEntryInput): Promise<{ id: string }> {
  const date = toEntryDate(input.date)
  const lines = normalizeLines(input.lines ?? [])
  assertValidEntry(date, input.description, lines)
  await assertJournal(db, input.journalId, input.companyId)
  if (input.fiscalYearId) {
    const own = await db.fiscalYear.findFirst({ where: { id: input.fiscalYearId, companyId: input.companyId }, select: { id: true } })
    if (!own) throw new ValidationError('Exercice introuvable pour cette société')
  }
  const fiscalYearId = await fiscalYearOfAccounts(db, input.companyId, lines, input.fiscalYearId)
  await guardFiscalYear(db, input.companyId, fiscalYearId, date, input.reversalOfId ? 'reverse' : 'create')

  const status = input.status ?? 'draft'
  if (status !== 'draft' && status !== 'validated') {
    throw new ValidationError('Le statut doit être "draft" ou "validated"')
  }

  const entryNumber = provisionalEntryNumber()
  const entry = await db.accountingEntry.create({
    data: {
      companyId: input.companyId,
      journalId: input.journalId,
      fiscalYearId,
      entryNumber,
      date,
      description: input.description ?? null,
      reference: text(input.reference),
      pieceDate: input.pieceDate ? toEntryDate(input.pieceDate, 'Date de la pièce') : null,
      status: 'draft',
      reversalOfId: input.reversalOfId ?? null,
    },
    select: { id: true },
  })
  await db.entryLine.createMany({ data: lineRows(entry.id, entryNumber, fiscalYearId, lines) })

  if (status === 'validated') await validateEntryInTx(db, entry.id)
  return entry
}

/**
 * Validates a draft inside a transaction: definitive number (under the
 * fiscal year lock), validation date, balance checked again on the stored
 * lines. Returns the definitive number.
 */
export async function validateEntryInTx(db: Db, entryId: string, companyId?: string): Promise<string> {
  const head = await db.accountingEntry.findFirst({
    where: { id: entryId, ...(companyId ? { companyId } : {}) },
    select: { fiscalYearId: true },
  })
  if (!head) throw new NotFoundError('Écriture introuvable')
  await lockEntryNumbering(db, head.fiscalYearId)

  const entry = await db.accountingEntry.findUniqueOrThrow({
    where: { id: entryId },
    select: {
      id: true,
      companyId: true,
      fiscalYearId: true,
      entryNumber: true,
      date: true,
      status: true,
      lines: { select: { accountId: true, debit: true, credit: true } },
    },
  })
  if (entry.status === 'validated') {
    throw new ConflictError(`L'écriture n° ${entry.entryNumber} est déjà validée.`)
  }
  await guardFiscalYear(db, entry.companyId, entry.fiscalYearId, entry.date, 'validate')
  const balance = validateEntryBalance(
    entry.lines.map((l) => ({ accountId: l.accountId, debit: l.debit.toString(), credit: l.credit.toString() })),
  )
  if (!balance.valid) throw new ValidationError(balance.errors.join(', '))

  const entryNumber = await nextDefinitiveEntryNumber(entry.fiscalYearId, db)
  if (entry.entryNumber !== entryNumber) {
    // A draft numbered by bank reconciliation (or before numbering moved to
    // validation) may hold this number: give it a provisional one.
    await db.accountingEntry.updateMany({
      where: { fiscalYearId: entry.fiscalYearId, entryNumber, status: 'draft', id: { not: entry.id } },
      data: { entryNumber: provisionalEntryNumber() },
    })
  }
  await db.accountingEntry.update({
    where: { id: entry.id },
    data: { status: 'validated', entryNumber, validatedAt: new Date() },
  })
  return entryNumber
}

export async function getEntry(id: string, db: Db | typeof prisma = prisma): Promise<EntryWithRelations> {
  return db.accountingEntry.findUniqueOrThrow({ where: { id }, include: ENTRY_INCLUDE })
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 }

/**
 * After validation: a customer payment confirmed in simple mode while the
 * accountant had to validate it is recorded on its sales invoice now that
 * its entry is validated (lib/simple/invoice-receipts.service.ts; the
 * invoices module records payments from validated entries only). Loaded
 * lazily: the invoices module builds on this one. Never undoes the
 * validation: a refusal is logged and the payment can be recorded from the
 * invoice page.
 */
async function afterValidation(companyId: string, entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return
  try {
    const { recordValidatedInvoicePayments } = await import('@/lib/simple/invoice-receipts.service')
    await recordValidatedInvoicePayments(companyId, entryIds)
  } catch (error) {
    logger.error('Recording simple mode invoice payments after validation failed', { companyId, entryIds, error })
  }
}

/** Creates an entry (draft by default) and returns it with its relations. */
export async function createEntry(input: CreateEntryInput): Promise<EntryWithRelations> {
  const entry = await prisma.$transaction(async (db) => getEntry((await createEntryInTx(db, input)).id, db), TX_OPTIONS)
  return entry
}

/** Validates drafts of a company, in date order, each in its own transaction. */
export async function validateEntries(
  companyId: string,
  entryIds: string[],
): Promise<{ validated: EntryWithRelations[]; errors: Array<{ entryId: string; error: string }> }> {
  const entries = await prisma.accountingEntry.findMany({
    where: { id: { in: entryIds }, companyId },
    select: { id: true, date: true, createdAt: true },
  })
  const found = new Set(entries.map((e) => e.id))
  const errors: Array<{ entryId: string; error: string }> = entryIds
    .filter((id) => !found.has(id))
    .map((entryId) => ({ entryId, error: 'Écriture introuvable' }))
  // Chronological order: numbers follow the entry dates within one request.
  entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime())

  const validated: EntryWithRelations[] = []
  for (const { id } of entries) {
    try {
      validated.push(
        await prisma.$transaction(async (db) => {
          await validateEntryInTx(db, id, companyId)
          return getEntry(id, db)
        }, TX_OPTIONS),
      )
    } catch (error) {
      errors.push({ entryId: id, error: describeEntryError(error) })
    }
  }
  await afterValidation(companyId, validated.map((e) => e.id))
  return { validated, errors }
}

export interface UpdateDraftInput {
  journalId?: string
  date?: Date | string
  description?: string | null
  reference?: string | null
  pieceDate?: Date | string | null
  status?: EntryStatus
  lines?: EntryLineInput[]
}

/**
 * Edits a draft (and validates it when status is "validated"). A validated
 * entry is refused: it can only be reversed.
 */
export async function updateDraftEntry(
  entryId: string,
  data: UpdateDraftInput,
  companyId?: string,
): Promise<EntryWithRelations> {
  if (data.status !== undefined && data.status !== 'draft' && data.status !== 'validated') {
    throw new ValidationError('Le statut doit être "draft" ou "validated"')
  }
  const entry = await prisma.$transaction(async (db) => {
    const existing = await db.accountingEntry.findFirst({
      where: { id: entryId, ...(companyId ? { companyId } : {}) },
      select: {
        id: true,
        companyId: true,
        entryNumber: true,
        fiscalYearId: true,
        journalId: true,
        date: true,
        description: true,
        status: true,
        lines: { select: { accountId: true, debit: true, credit: true, description: true } },
      },
    })
    if (!existing) throw new NotFoundError('Écriture introuvable')
    if (existing.status === 'validated') throw new ConflictError(immutableEntryMessage(existing.entryNumber))

    const changesContent =
      data.journalId !== undefined ||
      data.date !== undefined ||
      data.description !== undefined ||
      data.reference !== undefined ||
      data.pieceDate !== undefined ||
      data.lines !== undefined

    // The draft's current year must be open to change it at all.
    await guardFiscalYear(db, existing.companyId, existing.fiscalYearId, existing.date, 'update')

    if (changesContent) {
      const date = data.date !== undefined ? toEntryDate(data.date) : existing.date
      const description = data.description !== undefined ? data.description : existing.description
      let fiscalYearId = existing.fiscalYearId
      let lines: NormalizedLine[] | undefined
      if (data.lines !== undefined) {
        lines = normalizeLines(data.lines)
        assertValidEntry(date, description, lines)
        fiscalYearId = await fiscalYearOfAccounts(db, existing.companyId, lines)
      } else if (data.date !== undefined) {
        const current = normalizeLines(existing.lines.map((l) => ({ ...l, debit: l.debit.toString(), credit: l.credit.toString() })))
        assertValidEntry(date, description, current)
      }
      if (data.journalId !== undefined) await assertJournal(db, data.journalId, existing.companyId)
      await guardFiscalYear(db, existing.companyId, fiscalYearId, date, 'update')

      // A fixed asset created with the draft (simple mode) follows its asset line, or the edit is refused
      if (lines) await syncFixedAssetsAcquiredByEntryInTx(db, existing.companyId, existing, lines)
      if (lines) await db.entryLine.deleteMany({ where: { accountingEntryId: existing.id } })
      await db.accountingEntry.update({
        where: { id: existing.id },
        data: {
          ...(data.journalId !== undefined && { journalId: data.journalId }),
          ...(data.date !== undefined && { date }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.reference !== undefined && { reference: text(data.reference) }),
          ...(data.pieceDate !== undefined && { pieceDate: data.pieceDate ? toEntryDate(data.pieceDate, 'Date de la pièce') : null }),
          ...(fiscalYearId !== existing.fiscalYearId && { fiscalYearId }),
        },
      })
      if (lines) {
        await db.entryLine.createMany({ data: lineRows(existing.id, existing.entryNumber, fiscalYearId, lines) })
      }
    }

    if (data.status === 'validated') await validateEntryInTx(db, existing.id)
    return getEntry(existing.id, db)
  }, TX_OPTIONS)
  if (data.status === 'validated') await afterValidation(entry.companyId, [entry.id])
  return entry
}

/** Deletes a draft. A validated entry is refused (409): it can only be reversed. */
export async function deleteDraftEntry(companyId: string, entryId: string): Promise<{ id: string; description: string | null; reference: string | null }> {
  return prisma.$transaction(async (db) => deleteDraftEntryInTx(db, companyId, entryId), TX_OPTIONS)
}

/** deleteDraftEntry inside the caller's transaction (an invoice unposted with its draft entry). */
export async function deleteDraftEntryInTx(
  db: Db,
  companyId: string,
  entryId: string,
): Promise<{ id: string; description: string | null; reference: string | null }> {
  const entry = await db.accountingEntry.findFirst({
    where: { id: entryId, companyId },
    select: { id: true, entryNumber: true, status: true, fiscalYearId: true, date: true, description: true, reference: true },
  })
  if (!entry) throw new NotFoundError('Écriture introuvable')
  if (entry.status === 'validated') throw new ConflictError(immutableEntryMessage(entry.entryNumber))
  await guardFiscalYear(db, companyId, entry.fiscalYearId, entry.date, 'delete')
  // A fixed asset created with the entry (simple mode) goes with it, or the deletion is refused
  await deleteFixedAssetsAcquiredByEntryInTx(db, companyId, entry.id)
  // Lines are deleted by the cascade
  await db.accountingEntry.delete({ where: { id: entry.id } })
  return { id: entry.id, description: entry.description, reference: entry.reference }
}

export interface ReverseEntryOptions {
  /** Date of the reversing entry (yyyy-mm-dd); the original date by default. Must be in an open fiscal year. */
  date?: Date | string | null
}

/**
 * Contre-passation: creates and validates the entry that cancels a validated
 * entry (same accounts, debits and credits swapped), linked to it. Dated like
 * the original by default, or on a chosen day of an open fiscal year (the
 * original's year may be closed: accounts are then taken by number from the
 * chosen year's chart).
 */
export async function reverseEntry(
  companyId: string,
  entryId: string,
  options: ReverseEntryOptions = {},
): Promise<EntryWithRelations> {
  const entry = await prisma.$transaction(async (db) => {
    const original = await db.accountingEntry.findFirst({
      where: { id: entryId, companyId },
      include: {
        lines: { include: { account: { select: { code: true } } }, orderBy: { createdAt: 'asc' } },
        reversedBy: { select: { entryNumber: true, status: true } },
      },
    })
    if (!original) throw new NotFoundError('Écriture introuvable')
    if (original.status !== 'validated') {
      throw new ConflictError("Seule une écriture validée peut être contre-passée\u00a0: un brouillon se modifie ou se supprime.")
    }
    if (original.reversedBy) {
      throw new ConflictError(
        `L'écriture n° ${original.entryNumber} est déjà contre-passée par l'écriture n° ${original.reversedBy.entryNumber}.`,
      )
    }

    const day = options.date ? calendarDayOf(options.date) : calendarDayOf(original.date)
    if (!day) throw new ValidationError('Date de contre-passation invalide\u00a0: utilisez le format AAAA-MM-JJ')
    const fiscalYears = await db.fiscalYear.findMany({ where: { companyId }, select: GUARDED_FISCAL_YEAR_SELECT })
    const target = fiscalYearContaining(fiscalYears, day)
    if (!target) throw new ValidationError(`Aucun exercice ne couvre le ${formatIsoDateFr(day)}.`)
    assertEntryWritableInFiscalYear(target, day, 'reverse')

    let accountIds = original.lines.map((l) => l.accountId)
    if (target.id !== original.fiscalYearId) {
      const codes = [...new Set(original.lines.map((l) => l.account.code))]
      const accounts = await db.account.findMany({
        where: { companyId, fiscalYearId: target.id, code: { in: codes } },
        select: { id: true, code: true },
      })
      const byCode = new Map(accounts.map((a) => [a.code, a.id]))
      const missing = codes.filter((c) => !byCode.has(c))
      if (missing.length) {
        throw new ValidationError(`Comptes absents de l'exercice ${target.year}\u00a0: ${missing.join(', ')}. Créez-les avant de contre-passer.`)
      }
      accountIds = original.lines.map((l) => byCode.get(l.account.code)!)
    }

    const created = await createEntryInTx(db, {
      companyId,
      journalId: original.journalId,
      date: dayToDate(day),
      description: `Contre-passation de l'écriture n° ${original.entryNumber}${original.description ? `\u00a0: ${original.description}` : ''}`,
      reference: original.reference ?? `Écriture n° ${original.entryNumber}`,
      status: 'validated',
      fiscalYearId: target.id,
      reversalOfId: original.id,
      lines: original.lines.map((line, i) => ({
        accountId: accountIds[i],
        debit: line.credit.toString(),
        credit: line.debit.toString(),
        description: line.description,
        auxiliaryAccountNumber: line.auxiliaryAccountNumber,
        auxiliaryAccountLabel: line.auxiliaryAccountLabel,
        currencyAmount: line.currencyAmount === null ? null : line.currencyAmount.negated().toString(),
        currencyCode: line.currencyCode,
      })),
    })
    return getEntry(created.id, db)
  }, TX_OPTIONS).catch((error: unknown) => {
    // Two concurrent reversals of the same entry: the unique link refuses the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError("Cette écriture vient déjà d'être contre-passée.")
    }
    throw error
  })
  logger.debug('[reverseEntry] Reversed', { companyId, entryId, reversalId: entry.id })
  return entry
}

/** French message of an error raised while writing an entry (also maps the database guards). */
export function describeEntryError(error: unknown): string {
  return handleError(error).message
}
