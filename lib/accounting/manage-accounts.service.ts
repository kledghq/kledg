/**
 * Chart of accounts of a company (accounts are per fiscal year): list, look
 * up, edit, and the ledger of one account. Creation is
 * create-account.service.ts (shared with the MCP tools), deletion
 * delete-accounts.service.ts, the PCG completion pcg-chart.service.ts.
 *
 * Every lookup is scoped by company: an id of another company is a 404.
 * A PCG account keeps its number (the number identifies it in the PCG
 * nomenclature); its label and parent can change.
 *
 * Entry lines point to their account, so its number and label are part of
 * every line (FEC CompteNum and CompteLib, LPF art. A47 A-1): an account
 * carrying a line of a validated entry keeps its number (PCG art. 1031-3),
 * and an account of a closed fiscal year never changes (art. 1031-4). The
 * database refuses it too (migration 20261107090000_ledger_references_lock).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { validateAccountCode } from '@/lib/accounting/validator'
import { getOrCreateActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { fromCents, parseCents, sumCents } from '@/lib/utils/money'

export const ACCOUNT_NOT_FOUND = 'Compte introuvable'

/** An account of the company with the given columns, or a 404. */
export async function ownedAccount<S extends Prisma.AccountSelect>(companyId: string, id: string, select: S) {
  const account = await prisma.account.findFirst({ where: { id, companyId }, select })
  if (!account) throw new NotFoundError(ACCOUNT_NOT_FOUND)
  return account
}

/** The fiscal year whose chart is read: the one given (scoped by the company in the queries), else the active one. */
async function chartFiscalYearId(companyId: string, fiscalYearId?: string | null): Promise<string> {
  return fiscalYearId || (await getOrCreateActiveFiscalYear(companyId)).id
}

/**
 * The fiscal year a chart operation acts on: the one given, which must
 * belong to the company (400 otherwise), else the active fiscal year
 * (created when there is none).
 */
export async function targetChartFiscalYearId(companyId: string, fiscalYearId?: string | null): Promise<string> {
  if (!fiscalYearId) return (await getOrCreateActiveFiscalYear(companyId)).id
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId }, select: { id: true } })
  if (!fiscalYear) throw new ValidationError("Exercice invalide : il n'appartient pas à cette société.")
  return fiscalYear.id
}

/** Accounts of the chart of a fiscal year (the active one by default), by number. */
export async function listAccounts(companyId: string, fiscalYearId?: string | null) {
  return prisma.account.findMany({
    where: { companyId, fiscalYearId: await chartFiscalYearId(companyId, fiscalYearId) },
    orderBy: { code: 'asc' },
  })
}

/** The account with this number in the chart of a fiscal year (the active one by default), or null. */
export async function findAccountByCode(companyId: string, code: string, fiscalYearId?: string | null) {
  // The unique key includes companyId: a fiscal year of another company matches nothing
  return prisma.account.findUnique({
    where: { companyId_code_fiscalYearId: { companyId, code, fiscalYearId: await chartFiscalYearId(companyId, fiscalYearId) } },
    select: { id: true, code: true, label: true },
  })
}

export function getAccount(companyId: string, id: string) {
  return ownedAccount(companyId, id, {
    id: true,
    code: true,
    label: true,
    companyId: true,
    isPCG: true,
    parentId: true,
    fiscalYearId: true,
  })
}

export interface UpdateAccountInput {
  code?: string
  label?: string
  /** Parent account id; null, '' or 'none' detaches the account. */
  parentId?: string | null
}

/**
 * Changes the number, label or parent of an account. A sub-account keeps
 * the parent's number as prefix, its fiscal year and its nomenclature
 * (PCG or not).
 */
export async function updateAccount(companyId: string, id: string, input: UpdateAccountInput) {
  const { code, label, parentId } = input
  const account = await ownedAccount(companyId, id, {
    id: true,
    code: true,
    label: true,
    isPCG: true,
    parentId: true,
    fiscalYearId: true,
  })

  if (account.isPCG && code !== undefined && code !== account.code) {
    throw new ValidationError('Pour un compte du PCG, le code ne peut pas être modifié.')
  }

  if (code !== undefined) {
    if (!validateAccountCode(code)) throw new ValidationError('Le code doit contenir entre 2 et 8 chiffres')
    if (code !== account.code) {
      const existing = await prisma.account.findFirst({
        where: { companyId, code, fiscalYearId: account.fiscalYearId },
        select: { id: true },
      })
      if (existing && existing.id !== id) throw new ConflictError('Un compte avec ce code existe déjà pour cette société')
    }
  }

  if (label !== undefined && !label.trim()) throw new ValidationError('Le libellé est requis')

  const codeChanges = code !== undefined && code !== account.code
  if ((codeChanges || (label !== undefined && label !== account.label)) && account.fiscalYearId) {
    const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: account.fiscalYearId, companyId }, select: { isClosed: true, year: true } })
    if (fiscalYear?.isClosed) {
      throw new ConflictError(`Le compte ${account.code} appartient à l'exercice ${fiscalYear.year}, clôturé : il ne peut plus changer (PCG art. 1031-4).`)
    }
  }
  if (codeChanges) {
    const validated = await prisma.entryLine.count({ where: { accountId: account.id, accountingEntry: { companyId, status: 'validated' } } })
    if (validated > 0) {
      throw new ConflictError(
        `Le compte ${account.code} porte des écritures validées : son numéro ne peut plus changer (PCG art. 1031-3). Créez un nouveau compte pour les écritures à venir.`,
      )
    }
  }

  let finalParentId = account.parentId
  let isPCG = account.isPCG
  if (parentId !== undefined) {
    if (parentId && parentId !== 'none') {
      const parent = await prisma.account.findFirst({
        where: { id: parentId, companyId },
        select: { id: true, code: true, isPCG: true, fiscalYearId: true },
      })
      if (!parent) throw new ValidationError('Compte parent invalide')
      if (parent.fiscalYearId !== account.fiscalYearId) {
        throw new ValidationError('Le compte parent doit appartenir au même exercice fiscal')
      }
      if (parentId === id) throw new ValidationError('Un compte ne peut pas être son propre parent')
      const childCode = code !== undefined ? code : account.code
      if (!childCode.startsWith(parent.code)) {
        throw new ValidationError(`Le code du compte enfant doit commencer par le code du parent (${parent.code})`)
      }
      // A sub-account takes the nomenclature of its parent
      isPCG = parent.isPCG
      finalParentId = parentId
    } else {
      finalParentId = null
    }
  }

  // Ownership checked above. The number of a PCG account never changes.
  const updated = await prisma.account.update({
    where: { id: account.id },
    data: {
      ...(!account.isPCG && code !== undefined && { code }),
      ...(label !== undefined && { label }),
      ...(parentId !== undefined && { parentId: finalParentId, isPCG }),
    },
  })
  return { before: account, account: updated }
}

/**
 * Ledger of one account: its entry lines (in a fiscal year of the company
 * when given, else all of them), oldest first, with the totals and the
 * balance (debit minus credit) summed in cents.
 */
export async function getAccountLedger(companyId: string, id: string, fiscalYearId?: string | null) {
  const account = await ownedAccount(companyId, id, { id: true, code: true, label: true, isPCG: true })

  const where: Prisma.EntryLineWhereInput = { accountId: account.id, accountingEntry: { companyId } }
  if (fiscalYearId) {
    // A fiscal year of another company is ignored (no date filter), as before
    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId },
      select: { startDate: true, endDate: true },
    })
    if (fiscalYear) {
      where.accountingEntry = { companyId, date: { gte: fiscalYear.startDate, lte: fiscalYear.endDate } }
    }
  }

  const lines = await prisma.entryLine.findMany({
    where,
    include: {
      accountingEntry: { include: { journal: { select: { code: true, label: true } } } },
      account: { select: { id: true, code: true, label: true } },
    },
    orderBy: { accountingEntry: { date: 'asc' } },
  })

  const cents = (value: Prisma.Decimal) => parseCents(value) ?? 0
  const debitCents = Number(sumCents(lines.map((line) => cents(line.debit))))
  const creditCents = Number(sumCents(lines.map((line) => cents(line.credit))))

  return {
    account: { id: account.id, code: account.code, label: account.label, isPCG: account.isPCG },
    entryLines: lines.map((line) => ({
      id: line.id,
      accountingEntryId: line.accountingEntryId,
      accountId: line.accountId,
      debit: fromCents(cents(line.debit)),
      credit: fromCents(cents(line.credit)),
      description: line.description,
      createdAt: line.createdAt.toISOString(),
      updatedAt: line.updatedAt.toISOString(),
      accountingEntry: {
        id: line.accountingEntry.id,
        entryNumber: line.accountingEntry.entryNumber,
        date: line.accountingEntry.date.toISOString(),
        description: line.accountingEntry.description,
        reference: line.accountingEntry.reference,
        status: line.accountingEntry.status,
        journal: { code: line.accountingEntry.journal.code, label: line.accountingEntry.journal.label },
      },
      account: { id: line.account.id, code: line.account.code, label: line.account.label },
    })),
    totals: {
      debit: fromCents(debitCents),
      credit: fromCents(creditCents),
      balance: fromCents(debitCents - creditCents),
    },
  }
}
