/**
 * Bank reconciliation, server side: one database transaction per operation.
 *
 * Reconciling creates the entry and its lines, links it to the bank
 * transaction and marks the transaction reconciled, all or nothing. The
 * transaction row is claimed first with a conditional update
 * (`reconciled = false` -> `true`): a concurrent request waits on the row lock,
 * then finds it reconciled and gets a 409, so a double submit produces exactly
 * one entry. Undoing a reconciliation locks the row too and deletes the entry
 * only when reconciliation created it and it is still a draft.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { assertAllOwned, findOwned, transactionOfCompany } from '@/lib/api/resources'
import { createEntryInTx, validateEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { deleteFixedAssetsAcquiredByEntryInTx } from '@/lib/fixed-assets/delete-fixed-asset.service'
import { writeAuditLog } from '@/lib/audit'
import { centsToDecimal, toCents } from '@/lib/utils/money'
import { isoDateToUtc, toIsoDateUtc } from '@/lib/utils/date'
import { bankLineOf, validateReconciliation, type BankSide, type FiscalYearPeriod } from './validation'

export const MESSAGES = {
  alreadyReconciled: 'Cette transaction est déjà rapprochée : rechargez la liste pour voir son écriture.',
  notReconciled: "Cette transaction n'est pas rapprochée.",
  transactionNotFound: 'Transaction introuvable',
  accountNotFound: 'Compte introuvable',
  journalNotFound: 'Journal introuvable',
  entryNotFound: 'Écriture introuvable',
} as const

type Client = Prisma.TransactionClient | typeof prisma

/** Bank providers store the direction as "debit"/"credit" (some older imports as "Débit"/"Crédit"). */
export function normalizeSide(side: string): BankSide {
  return /^d/i.test(side) ? 'debit' : 'credit'
}

export async function loadTransaction(companyId: string, transactionId: string) {
  return findOwned(
    prisma.bankTransaction.findFirst({ where: { id: transactionId, ...transactionOfCompany(companyId) } }),
    MESSAGES.transactionNotFound,
  )
}

export async function fiscalYearPeriods(companyId: string, client: Client = prisma): Promise<FiscalYearPeriod[]> {
  const rows = await client.fiscalYear.findMany({
    where: { companyId },
    orderBy: { startDate: 'asc' },
    select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
  })
  return rows.map((fy) => ({
    id: fy.id,
    year: fy.year,
    startDate: toIsoDateUtc(fy.startDate),
    endDate: toIsoDateUtc(fy.endDate),
    isClosed: fy.isClosed,
  }))
}

/**
 * The bank account (classe 5) of the locked line in a fiscal year: the
 * company's default bank account code when set, else the first detailed 512
 * account (512000 rather than the bare class 512).
 */
export async function resolveBankLedgerAccount(companyId: string, fiscalYearId: string, client: Client = prisma) {
  const company = await client.company.findUnique({ where: { id: companyId }, select: { defaultBankAccountCode: true } })
  const select = { id: true, code: true, label: true } as const
  if (company?.defaultBankAccountCode) {
    const account = await client.account.findFirst({
      where: { companyId, fiscalYearId, code: company.defaultBankAccountCode },
      select,
    })
    if (account) return account
  }
  const candidates = await client.account.findMany({
    where: { companyId, fiscalYearId, code: { startsWith: '512' } },
    select,
    orderBy: { code: 'asc' },
  })
  return candidates.find((a) => a.code.length > 3) ?? candidates[0] ?? null
}

export const bankAccountMissingMessage = (year: number) =>
  `Aucun compte bancaire 512 dans l'exercice ${year} : créez-le ou choisissez le compte bancaire par défaut dans les informations de la société.`

export interface GeneratedLine {
  accountId: string
  debitCents: number
  creditCents: number
  description?: string | null
}

export interface GeneratedEntry {
  companyId: string
  transactionId: string
  journalId: string
  /** Every account of the lines must belong to this fiscal year. */
  fiscalYearId: string
  date: Date
  description: string
  reference?: string | null
  lines: GeneratedLine[]
  /**
   * 'validated': the entry is validated in the same transaction
   * (validateEntryInTx: definitive number, PCG art. 1031-3). Draft by default.
   */
  status?: 'draft' | 'validated'
  /** Runs inside the transaction once the entry exists and is linked (records that belong with it). */
  afterCreate?: (db: Prisma.TransactionClient, entryId: string) => Promise<void>
}

/** Last line of defense before writing: whole cents, one side per line, balanced. */
export function assertWritableLines(lines: GeneratedLine[]): void {
  if (lines.length < 2) throw new ValidationError('Une écriture doit compter au moins deux lignes.')
  let balance = 0
  for (const line of lines) {
    const { debitCents: d, creditCents: c } = line
    if (!line.accountId) throw new ValidationError('Chaque ligne doit avoir un compte.')
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0 || (d > 0) === (c > 0)) {
      throw new ValidationError('Chaque ligne doit avoir un montant positif, au débit ou au crédit.')
    }
    balance += d - c
  }
  if (balance !== 0) throw new ValidationError("L'écriture n'est pas équilibrée.")
}

/**
 * Atomically claims the bank transaction, creates the draft entry and its
 * lines, and links them. Throws ConflictError (409) when the transaction is
 * already reconciled, including when another request reconciled it first.
 *
 * The entry goes through createEntryInTx, the one creation path: a draft
 * gets a provisional number and its definitive number at validation (PCG
 * art. 1031-3), like every other draft of the entries list. With status
 * 'validated' (simple mode without accountant review) it is validated by
 * validateEntryInTx in the same transaction.
 */
export async function createEntryAndReconcile(input: GeneratedEntry): Promise<{ id: string; entryNumber: string; status: 'draft' | 'validated' }> {
  assertWritableLines(input.lines)

  return prisma.$transaction(
    async (db) => {
      const claimed = await db.$executeRaw`
        UPDATE "bank_transactions"
        SET "reconciled" = true, "reconciledAt" = NOW(), "reconciledWith" = NULL, "updatedAt" = NOW()
        WHERE "id" = ${input.transactionId} AND "reconciled" = false`
      if (claimed === 0) throw new ConflictError(MESSAGES.alreadyReconciled)

      // An entry left behind by an older unreconcile (unlinked, not deleted) releases the link.
      await db.accountingEntry.updateMany({
        where: { sourceBankTransactionId: input.transactionId },
        data: { sourceBankTransactionId: null },
      })

      const { id } = await createEntryInTx(db, {
        companyId: input.companyId,
        journalId: input.journalId,
        fiscalYearId: input.fiscalYearId,
        date: input.date,
        description: input.description,
        reference: input.reference || null,
        status: 'draft',
        lines: input.lines.map((line) => ({
          accountId: line.accountId,
          debit: centsToDecimal(line.debitCents),
          credit: centsToDecimal(line.creditCents),
          description: line.description || input.description,
        })),
      })
      const entry = await db.accountingEntry.update({
        where: { id },
        data: { sourceBankTransactionId: input.transactionId },
        select: { id: true, entryNumber: true },
      })
      await db.bankTransaction.update({
        where: { id: input.transactionId },
        data: { reconciledWith: entry.id },
      })
      await input.afterCreate?.(db, entry.id)
      if (input.status === 'validated') {
        const entryNumber = await validateEntryInTx(db, entry.id, input.companyId)
        return { id: entry.id, entryNumber, status: 'validated' as const }
      }
      return { ...entry, status: 'draft' as const }
    },
    { maxWait: 10_000, timeout: 30_000 },
  )
}

/** An amount in an API body: a decimal string ("1234.56") or a number, at most two decimals. */
const apiAmount = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === '') return null
    const text = typeof value === 'number' ? String(value) : value.trim()
    if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({ code: 'custom', message: 'montant invalide (nombre décimal, deux décimales au plus)' })
      return z.NEVER
    }
    return toCents(text)
  })

export const reconcileWithEntrySchema = z.object({
  journalId: z.string(),
  date: z.string(),
  description: z.string().max(500).nullish(),
  reference: z.string().max(200).nullish(),
  lines: z
    .array(
      z.object({
        accountId: z.string(),
        debit: apiAmount,
        credit: apiAmount,
        description: z.string().max(500).nullish(),
      }),
    )
    .max(100),
})
export type ReconcileWithEntryInput = z.infer<typeof reconcileWithEntrySchema>

/**
 * Reconciles a transaction with a new entry: the locked bank line (built here,
 * never taken from the client) plus the counterpart lines of the request,
 * validated with the dialog's rules against database data.
 */
export async function reconcileWithNewEntry(companyId: string, transactionId: string, input: ReconcileWithEntryInput) {
  const transaction = await loadTransaction(companyId, transactionId)
  if (transaction.reconciled) throw new ConflictError(MESSAGES.alreadyReconciled)

  // Ids of other companies are 404, like everywhere else
  const accountIds = input.lines.map((l) => l.accountId)
  await assertAllOwned(
    accountIds,
    (ids) => prisma.account.count({ where: { id: { in: ids }, companyId } }),
    MESSAGES.accountNotFound,
  )
  if (input.journalId) {
    await findOwned(
      prisma.journal.findFirst({ where: { id: input.journalId, companyId }, select: { id: true } }),
      MESSAGES.journalNotFound,
    )
  }

  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds.filter(Boolean) }, companyId },
    select: { id: true, code: true, fiscalYearId: true },
  })
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const amountCents = toCents(transaction.amount) ?? 0

  const validation = validateReconciliation(
    {
      journalId: input.journalId,
      date: input.date,
      transaction: { amountCents, side: normalizeSide(transaction.side) },
      lines: input.lines.map((line) => ({
        accountId: line.accountId,
        accountCode: accountById.get(line.accountId)?.code ?? null,
        debitCents: line.debit,
        creditCents: line.credit,
      })),
    },
    { fiscalYears: await fiscalYearPeriods(companyId) },
  )
  if (!validation.valid) {
    throw new ValidationError([...new Set(validation.errors.map((e) => e.message))].join(' '))
  }
  const fiscalYear = validation.fiscalYear!

  const outsideYear = accounts.filter((a) => a.fiscalYearId !== fiscalYear.id).map((a) => a.code)
  if (outsideYear.length > 0) {
    throw new ValidationError(
      `Compte${outsideYear.length > 1 ? 's' : ''} ${outsideYear.join(', ')} hors de l'exercice ${fiscalYear.year} : choisissez les comptes de l'exercice de la date.`,
    )
  }

  const bank = await resolveBankLedgerAccount(companyId, fiscalYear.id)
  if (!bank) throw new ValidationError(bankAccountMissingMessage(fiscalYear.year))

  const description = input.description?.trim() || transaction.label || 'Transaction bancaire'
  const entry = await createEntryAndReconcile({
    companyId,
    transactionId,
    journalId: input.journalId,
    fiscalYearId: fiscalYear.id,
    date: isoDateToUtc(input.date),
    description,
    reference: input.reference?.trim() || transaction.reference,
    lines: [
      { accountId: bank.id, ...bankLineOf({ amountCents, side: normalizeSide(transaction.side) }), description },
      ...input.lines.map((line) => ({
        accountId: line.accountId,
        debitCents: line.debit ?? 0,
        creditCents: line.credit ?? 0,
        description: line.description?.trim() || description,
      })),
    ],
  })

  await writeAuditLog('info', `Bank transaction reconciled with a new entry: ${description}`, {
    action: 'RECONCILE_BANK_TRANSACTION',
    companyId,
    metadata: { transactionId, entryId: entry.id, entryNumber: entry.entryNumber, linesCount: input.lines.length + 1 },
  })
  return entry
}

/** Body of POST /api/banking/reconciliation: the transaction and the existing entry to link (none: pointage). */
export const reconcileWithExistingEntrySchema = z.object({
  transactionId: z.string().min(1).max(200),
  /** Existing entry to link; null or absent: none. */
  entryId: z.string().min(1, 'Écriture invalide.').max(200).nullish(),
})

/**
 * Marks a transaction reconciled with an existing entry of the company, or
 * with no entry at all (pointage). 409 when it is already reconciled.
 */
export async function reconcileWithExistingEntry(companyId: string, transactionId: string, entryId: string | null) {
  await loadTransaction(companyId, transactionId)
  if (entryId) {
    await findOwned(
      prisma.accountingEntry.findFirst({ where: { id: entryId, companyId }, select: { id: true } }),
      MESSAGES.entryNotFound,
    )
  }
  const claimed = await prisma.$executeRaw`
    UPDATE "bank_transactions"
    SET "reconciled" = true, "reconciledAt" = NOW(), "reconciledWith" = ${entryId}, "updatedAt" = NOW()
    WHERE "id" = ${transactionId} AND "reconciled" = false`
  if (claimed === 0) throw new ConflictError(MESSAGES.alreadyReconciled)
  return prisma.bankTransaction.findUniqueOrThrow({
    where: { id: transactionId },
    select: { id: true, reconciled: true, reconciledAt: true, reconciledWith: true },
  })
}

export interface UnreconcileResult {
  transactionId: string
  /** The draft entry created by the reconciliation, now deleted. */
  deletedEntryId: string | null
  /** An entry that was only linked (not created by the reconciliation): kept. */
  unlinkedEntryId: string | null
}

/**
 * Undoes a reconciliation atomically. The entry the reconciliation created is
 * deleted with its lines, provided it is still a draft in an open fiscal
 * year; a validated entry cannot be removed (409: it needs a reversing entry).
 * An entry that was only linked to the transaction is kept.
 */
export async function unreconcileTransaction(companyId: string, transactionId: string): Promise<UnreconcileResult> {
  await loadTransaction(companyId, transactionId)

  const result = await prisma.$transaction(
    async (db) => {
      const [row] = await db.$queryRaw<Array<{ reconciled: boolean; reconciledWith: string | null }>>`
        SELECT "reconciled", "reconciledWith" FROM "bank_transactions" WHERE "id" = ${transactionId} FOR UPDATE`
      if (!row) throw new NotFoundError(MESSAGES.transactionNotFound)
      if (!row.reconciled) throw new ConflictError(MESSAGES.notReconciled)

      let deletedEntryId: string | null = null
      let unlinkedEntryId: string | null = null
      if (row.reconciledWith) {
        const entry = await db.accountingEntry.findFirst({
          where: { id: row.reconciledWith, companyId },
          select: { id: true, entryNumber: true, status: true, sourceBankTransactionId: true, fiscalYear: { select: { year: true, isClosed: true } } },
        })
        if (entry && entry.sourceBankTransactionId === transactionId) {
          if (entry.status !== 'draft') {
            throw new ConflictError(
              `L'écriture n° ${entry.entryNumber} est validée : le rapprochement ne peut pas être annulé. Passez une écriture de contrepassation.`,
            )
          }
          if (entry.fiscalYear.isClosed) {
            throw new ConflictError(
              `L'écriture n° ${entry.entryNumber} appartient à l'exercice ${entry.fiscalYear.year}, clôturé : le rapprochement ne peut pas être annulé.`,
            )
          }
          // A fixed asset created with the entry (simple mode) goes with it, or the undo is refused
          await deleteFixedAssetsAcquiredByEntryInTx(
            db,
            companyId,
            entry.id,
            (label) => `Le rapprochement ne peut pas être annulé\u00a0: l'écriture n° ${entry.entryNumber} a créé l'immobilisation « ${label} », qui ne peut pas être supprimée.`,
          )
          await db.accountingEntry.delete({ where: { id: entry.id } })
          deletedEntryId = entry.id
        } else if (entry) {
          unlinkedEntryId = entry.id
        }
      }

      await db.bankTransaction.update({
        where: { id: transactionId },
        data: { reconciled: false, reconciledAt: null, reconciledWith: null },
      })
      return { transactionId, deletedEntryId, unlinkedEntryId }
    },
    { maxWait: 10_000, timeout: 30_000 },
  )

  await writeAuditLog('info', 'Bank reconciliation undone', {
    action: 'UNRECONCILE_BANK_TRANSACTION',
    companyId,
    metadata: { ...result },
  })
  return result
}
