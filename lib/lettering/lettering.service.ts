/**
 * Lettering (lettrage) of third-party accounts: list the lines of an
 * account, letter a balanced selection, unletter a code, propose and apply
 * automatic lettering.
 *
 * Invariants owned here:
 * - only lines of validated entries are lettered: a draft can still change
 *   or be deleted, which would leave a group unbalanced;
 * - a group balances to the cent and spans one auxiliary account at most
 *   (rules.ts checkSelection); there is no partial lettering;
 * - codes follow one sequence per account (rules.ts nextLetteringCode), FEC
 *   EcritureLet, with the lettering day in France as FEC DateLet
 *   (LPF art. A47 A-1);
 * - lettering only writes letteringCode and letteringDate, which the
 *   database triggers leave free on validated entries (PCG art. 1031-3 does
 *   not cover them: they are not part of the entry, migration
 *   20261003180000). The triggers also let them change in a closed fiscal
 *   year; Kledg refuses it here (409) so that the FEC of a closed year stays
 *   the one produced at closing (PCG art. 1031-4, LPF art. L47 A);
 * - every write runs under an advisory lock per account, then re-reads the
 *   lines it changes (FOR UPDATE): two people lettering the same lines at
 *   the same time get one lettering and one 409, never two codes, and two
 *   letterings of one account never take the same code.
 *
 * Accounts belong to one fiscal year (Account.fiscalYearId), so a group
 * never spans two years: the opening entry (AN) carries the balance of a
 * third-party account into the next year.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { GUARDED_FISCAL_YEAR_SELECT, isFiscalYearClosed } from '@/lib/accounting/entry-guards'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { dayToDate, parisDayOf } from '@/lib/accounting/entry-date'
import { idList } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { calendarDayOf } from '@/lib/utils/date'
import { plural } from '@/lib/utils/plural'
import { parseCents } from '@/lib/utils/money'
import { checkSelection, isLetterableAccount, LETTERABLE_PREFIXES, nextLetteringCode } from './rules'
import { suggestLettering, type LetteringSuggestion } from './match'

type Db = Prisma.TransactionClient | typeof prisma

export const LETTERING_MESSAGES = {
  accountNotFound: 'Compte introuvable',
  fiscalYearNotFound: 'Exercice introuvable pour cette société.',
  linesNotFound: "Certaines lignes sont introuvables sur ce compte\u00a0: rechargez la page pour voir l'état actuel.",
  notLetterable: (code: string) =>
    `Le compte ${code} n'est pas un compte de tiers lettrable\u00a0: le lettrage concerne les comptes clients, fournisseurs, personnel, associés, 467 et d'attente.`,
  closedYear: (year: number) =>
    `L'exercice ${year} est clôturé\u00a0: son lettrage ne peut plus changer, pour que son FEC reste celui de la clôture. Lettrez les à-nouveaux dans l'exercice suivant.`,
  draft: (entryNumber: string) =>
    `La ligne de l'écriture ${entryNumber} est en brouillon\u00a0: validez l'écriture avant de la lettrer.`,
  alreadyLettered: (codes: string) =>
    `Ces lignes viennent d'être lettrées (${codes})\u00a0: rechargez la page, ou délettrez-les d'abord.`,
  codeNotFound: (code: string) => `Le lettrage ${code} est introuvable sur ce compte\u00a0: rechargez la page.`,
} as const

/** Lines returned by one request at most (an account with more shows the oldest first, then filters). */
export const MAX_LINES = 2000

// ------------------------------------------------------------------ inputs

/** ?companyId=&fiscalYearId= */
export const LetterableAccountsQuerySchema = z.object({ fiscalYearId: z.string().max(64).optional() })

/** ?companyId=&accountId=&status= */
export const LetteringLinesQuerySchema = z.object({
  accountId: z.string({ error: 'Choisissez le compte à lettrer' }).min(1).max(64),
  status: z.enum(['open', 'lettered', 'all'], { error: 'Filtre inconnu\u00a0: open, lettered ou all' }).default('open'),
})

/** Body of POST /api/lettering. */
export const LetterLinesBodySchema = z.object({
  accountId: z.string({ error: 'Choisissez le compte à lettrer' }).min(1).max(64),
  lineIds: idList(500, 'Sélectionnez les lignes à lettrer.'),
})

/** Body of POST /api/lettering/unletter. */
export const UnletterBodySchema = z.object({
  accountId: z.string({ error: 'Choisissez le compte' }).min(1).max(64),
  code: z.string({ error: 'Indiquez le code de lettrage' }).trim().min(1, 'Indiquez le code de lettrage').max(20),
})

/** ?companyId=&accountId= (suggestions) and the body of POST /api/lettering/auto. */
export const AccountQuerySchema = z.object({ accountId: z.string({ error: 'Choisissez le compte' }).min(1).max(64) })

// ------------------------------------------------------------------ reads

export interface LetterableAccount {
  id: string
  code: string
  label: string
  openCount: number
  /** Debit minus credit of the unlettered lines. */
  openBalanceCents: number
  letteredCount: number
}

export interface LetterableAccounts {
  fiscalYear: { id: string; year: number; isClosed: boolean } | null
  accounts: LetterableAccount[]
}

async function resolveFiscalYear(companyId: string, fiscalYearId?: string) {
  if (fiscalYearId) {
    const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId }, select: GUARDED_FISCAL_YEAR_SELECT })
    if (!fiscalYear) throw new NotFoundError(LETTERING_MESSAGES.fiscalYearNotFound)
    return fiscalYear
  }
  const active = await getActiveFiscalYear(companyId)
  return active
    ? { id: active.id, year: active.year, startDate: active.startDate, endDate: active.endDate, isClosed: active.isClosed, closedAt: active.closedAt }
    : prisma.fiscalYear.findFirst({ where: { companyId }, orderBy: { year: 'desc' }, select: GUARDED_FISCAL_YEAR_SELECT })
}

const toNumber = (value: bigint | number | null) => (value === null ? 0 : Number(value))

/**
 * Third-party accounts of a fiscal year that hold validated lines, with
 * their unlettered lines (count and balance) and lettered lines.
 */
export async function listLetterableAccounts(companyId: string, fiscalYearId?: string): Promise<LetterableAccounts> {
  const fiscalYear = await resolveFiscalYear(companyId, fiscalYearId)
  if (!fiscalYear) return { fiscalYear: null, accounts: [] }
  const accounts = (
    await prisma.account.findMany({
      where: { companyId, fiscalYearId: fiscalYear.id, OR: LETTERABLE_PREFIXES.map((prefix) => ({ code: { startsWith: prefix } })) },
      select: { id: true, code: true, label: true },
      orderBy: { code: 'asc' },
    })
  ).filter((account) => isLetterableAccount(account.code))
  const ref = { id: fiscalYear.id, year: fiscalYear.year, isClosed: isFiscalYearClosed(fiscalYear) }
  if (accounts.length === 0) return { fiscalYear: ref, accounts: [] }

  const rows = await prisma.$queryRaw<Array<{ accountId: string; openCount: bigint; openBalance: bigint | null; letteredCount: bigint }>>`
    SELECT l."accountId" AS "accountId",
           COUNT(*) FILTER (WHERE l."letteringCode" IS NULL) AS "openCount",
           SUM(CASE WHEN l."letteringCode" IS NULL THEN (l."debit" - l."credit") * 100 END)::bigint AS "openBalance",
           COUNT(*) FILTER (WHERE l."letteringCode" IS NOT NULL) AS "letteredCount"
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    WHERE l."accountFiscalYearId" = ${fiscalYear.id}
      AND e."companyId" = ${companyId}
      AND e."status" = 'validated'
      AND l."accountId" IN (${Prisma.join(accounts.map((a) => a.id))})
    GROUP BY l."accountId"`
  const byAccount = new Map(rows.map((row) => [row.accountId, row]))
  return {
    fiscalYear: ref,
    accounts: accounts
      .filter((account) => byAccount.has(account.id))
      .map((account) => {
        const row = byAccount.get(account.id)!
        return {
          ...account,
          openCount: toNumber(row.openCount),
          openBalanceCents: toNumber(row.openBalance),
          letteredCount: toNumber(row.letteredCount),
        }
      }),
  }
}

export interface LetteringLine {
  id: string
  entryId: string
  entryNumber: string
  /** yyyy-mm-dd */
  date: string
  journalCode: string
  reference: string | null
  description: string
  debitCents: number
  creditCents: number
  auxiliaryAccountNumber: string | null
  auxiliaryAccountLabel: string | null
  /** Name of the tiers whose auxiliary account number the line carries (lib/tiers), null without one. */
  tiersName: string | null
  letteringCode: string | null
  letteringDate: string | null
  /** The entry is reconciled with a bank transaction. */
  reconciled: boolean
  /** Balance of the lines listed so far (debit - credit), this one included. */
  runningBalanceCents: number
}

export interface LetteringLines {
  account: { id: string; code: string; label: string }
  fiscalYear: { id: string; year: number; isClosed: boolean }
  lines: LetteringLine[]
  totals: { debitCents: number; creditCents: number; balanceCents: number }
  /** More lines match than MAX_LINES: the oldest are shown. */
  truncated: boolean
  /** Lines of draft entries on the account, not offered for lettering. */
  draftCount: number
  /** Next code of the account, as the next lettering will use it. */
  nextCode: string
}

async function loadAccount(db: Db, companyId: string, accountId: string) {
  const account = await db.account.findFirst({
    where: { id: accountId, companyId },
    select: { id: true, code: true, label: true, fiscalYear: { select: GUARDED_FISCAL_YEAR_SELECT } },
  })
  if (!account?.fiscalYear) throw new NotFoundError(LETTERING_MESSAGES.accountNotFound)
  if (!isLetterableAccount(account.code)) throw new ConflictError(LETTERING_MESSAGES.notLetterable(account.code))
  return { ...account, fiscalYear: account.fiscalYear }
}

/** Entries of the company reconciled with a bank transaction, among `entryIds`. */
async function reconciledEntryIds(db: Db, companyId: string, entryIds: string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set()
  const [linked, created] = await Promise.all([
    db.bankTransaction.findMany({
      where: { reconciledWith: { in: entryIds }, bankAccount: { bankConnection: { companyId } } },
      select: { reconciledWith: true },
    }),
    db.accountingEntry.findMany({
      where: { id: { in: entryIds }, companyId, sourceBankTransactionId: { not: null } },
      select: { id: true },
    }),
  ])
  return new Set([...linked.map((t) => t.reconciledWith as string), ...created.map((e) => e.id)])
}

async function usedCodes(db: Db, accountId: string): Promise<string[]> {
  const rows = await db.entryLine.findMany({
    where: { accountId, letteringCode: { not: null } },
    distinct: ['letteringCode'],
    select: { letteringCode: true },
  })
  return rows.map((row) => row.letteringCode as string)
}

const lineSelect = {
  id: true,
  debit: true,
  credit: true,
  description: true,
  auxiliaryAccountNumber: true,
  auxiliaryAccountLabel: true,
  letteringCode: true,
  letteringDate: true,
  accountingEntry: {
    select: { id: true, entryNumber: true, date: true, reference: true, description: true, status: true, journal: { select: { code: true } } },
  },
} satisfies Prisma.EntryLineSelect

type LineRow = Prisma.EntryLineGetPayload<{ select: typeof lineSelect }>

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

/** Validated lines of an account, oldest first, with a running balance. */
export async function listLetteringLines(
  companyId: string,
  query: { accountId: string; status: 'open' | 'lettered' | 'all' },
): Promise<LetteringLines> {
  const account = await loadAccount(prisma, companyId, query.accountId)
  const where: Prisma.EntryLineWhereInput = {
    accountId: account.id,
    accountingEntry: { companyId, status: 'validated' },
    ...(query.status === 'open' ? { letteringCode: null } : query.status === 'lettered' ? { letteringCode: { not: null } } : {}),
  }
  const [rows, draftCount, codes] = await Promise.all([
    prisma.entryLine.findMany({
      where,
      select: lineSelect,
      orderBy: [{ accountingEntry: { date: 'asc' } }, { accountingEntry: { entryNumber: 'asc' } }, { id: 'asc' }],
      take: MAX_LINES + 1,
    }),
    prisma.entryLine.count({ where: { accountId: account.id, accountingEntry: { companyId, status: 'draft' } } }),
    usedCodes(prisma, account.id),
  ])
  const truncated = rows.length > MAX_LINES
  const shown = rows.slice(0, MAX_LINES)
  const auxiliaries = [...new Set(shown.map((row) => row.auxiliaryAccountNumber?.trim()).filter((aux): aux is string => Boolean(aux)))]
  const [reconciled, tiers] = await Promise.all([
    reconciledEntryIds(prisma, companyId, [...new Set(shown.map((row) => row.accountingEntry.id))]),
    auxiliaries.length
      ? prisma.tiers.findMany({ where: { companyId, auxiliaryAccountNumber: { in: auxiliaries } }, select: { auxiliaryAccountNumber: true, name: true } })
      : Promise.resolve([]),
  ])
  const tiersNames = new Map(tiers.map((t) => [t.auxiliaryAccountNumber, t.name]))

  let running = 0
  let debitCents = 0
  let creditCents = 0
  const lines = shown.map((row: LineRow): LetteringLine => {
    const debit = cents(row.debit)
    const credit = cents(row.credit)
    running += debit - credit
    debitCents += debit
    creditCents += credit
    return {
      id: row.id,
      entryId: row.accountingEntry.id,
      entryNumber: row.accountingEntry.entryNumber,
      date: calendarDayOf(row.accountingEntry.date) as string,
      journalCode: row.accountingEntry.journal.code,
      reference: row.accountingEntry.reference,
      description: row.description || row.accountingEntry.description || '',
      debitCents: debit,
      creditCents: credit,
      auxiliaryAccountNumber: row.auxiliaryAccountNumber,
      auxiliaryAccountLabel: row.auxiliaryAccountLabel,
      tiersName: tiersNames.get(row.auxiliaryAccountNumber?.trim() ?? '') ?? null,
      letteringCode: row.letteringCode,
      letteringDate: calendarDayOf(row.letteringDate),
      reconciled: reconciled.has(row.accountingEntry.id),
      runningBalanceCents: running,
    }
  })
  return {
    account: { id: account.id, code: account.code, label: account.label },
    fiscalYear: { id: account.fiscalYear.id, year: account.fiscalYear.year, isClosed: isFiscalYearClosed(account.fiscalYear) },
    lines,
    totals: { debitCents, creditCents, balanceCents: debitCents - creditCents },
    truncated,
    draftCount,
    nextCode: nextLetteringCode(codes),
  }
}

// ------------------------------------------------------------------ writes

export interface LetteredGroup {
  code: string
  /** yyyy-mm-dd */
  letteringDate: string
  lineIds: string[]
  amountCents: number
}

interface LockedLine {
  id: string
  debitCents: number
  creditCents: number
  auxiliaryAccountNumber: string | null
  letteringCode: string | null
  status: string
  entryNumber: string
}

/** Serializes the lettering writes of one account (see the module header). */
async function lockAccount(tx: Prisma.TransactionClient, accountId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:lettering:${accountId}`}))`
}

async function lockLines(tx: Prisma.TransactionClient, companyId: string, accountId: string, lineIds: string[]): Promise<LockedLine[]> {
  const rows = await tx.$queryRaw<Array<Omit<LockedLine, 'debitCents' | 'creditCents'> & { debit: bigint; credit: bigint }>>`
    SELECT l."id", (l."debit" * 100)::bigint AS debit, (l."credit" * 100)::bigint AS credit,
           l."auxiliaryAccountNumber", l."letteringCode", e."status", e."entryNumber"
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    WHERE l."id" IN (${Prisma.join(lineIds)})
      AND l."accountId" = ${accountId}
      AND e."companyId" = ${companyId}
    FOR UPDATE OF l`
  return rows.map(({ debit, credit, ...row }) => ({ ...row, debitCents: Number(debit), creditCents: Number(credit) }))
}

function assertOpenYear(account: Awaited<ReturnType<typeof loadAccount>>) {
  if (isFiscalYearClosed(account.fiscalYear)) throw new ConflictError(LETTERING_MESSAGES.closedYear(account.fiscalYear.year))
}

/** Checks one group of locked lines and writes its code. */
async function letterGroupInTx(
  tx: Prisma.TransactionClient,
  companyId: string,
  accountId: string,
  lineIds: string[],
  codes: string[],
  letteringDay: string,
): Promise<LetteredGroup> {
  const unique = [...new Set(lineIds)]
  const lines = await lockLines(tx, companyId, accountId, unique)
  if (lines.length !== unique.length) throw new NotFoundError(LETTERING_MESSAGES.linesNotFound)
  const draft = lines.find((line) => line.status !== 'validated')
  if (draft) throw new ConflictError(LETTERING_MESSAGES.draft(draft.entryNumber))
  const lettered = lines.filter((line) => line.letteringCode)
  if (lettered.length > 0) {
    throw new ConflictError(LETTERING_MESSAGES.alreadyLettered([...new Set(lettered.map((line) => line.letteringCode))].join(', ')))
  }
  const check = checkSelection(lines)
  if (check.errors.length > 0) throw new ValidationError(check.errors.join(' '))

  const code = nextLetteringCode(codes)
  const written = await tx.entryLine.updateMany({
    where: { id: { in: unique }, accountId, letteringCode: null },
    data: { letteringCode: code, letteringDate: dayToDate(letteringDay) },
  })
  if (written.count !== unique.length) throw new ConflictError(LETTERING_MESSAGES.alreadyLettered(code))
  codes.push(code)
  return { code, letteringDate: letteringDay, lineIds: unique, amountCents: check.debitCents }
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const

/**
 * Letters lines of one account together: the next code of the account and
 * today's date in France. 400 when the selection does not balance, 409 when
 * a line is a draft, already lettered or in a closed fiscal year.
 */
export async function letterLines(
  companyId: string,
  input: { accountId: string; lineIds: string[] },
  options: { now?: Date; source?: string } = {},
): Promise<LetteredGroup> {
  const letteringDay = parisDayOf(options.now ?? new Date())
  const result = await prisma.$transaction(async (tx) => {
    const account = await loadAccount(tx, companyId, input.accountId)
    assertOpenYear(account)
    await lockAccount(tx, account.id)
    const group = await letterGroupInTx(tx, companyId, account.id, input.lineIds, await usedCodes(tx, account.id), letteringDay)
    return { account, group }
  }, TX_OPTIONS)

  await writeAuditLog('info', `Lines lettered ${result.group.code} on account ${result.account.code}`, {
    action: 'LETTER_ENTRY_LINES',
    companyId,
    metadata: { accountId: result.account.id, code: result.group.code, lineIds: result.group.lineIds, source: options.source ?? 'web' },
  })
  return result.group
}

/** Removes a lettering code from the lines of an account (409 in a closed fiscal year). */
export async function unletterCode(
  companyId: string,
  input: { accountId: string; code: string },
  options: { source?: string } = {},
): Promise<{ code: string; lineCount: number }> {
  const result = await prisma.$transaction(async (tx) => {
    const account = await loadAccount(tx, companyId, input.accountId)
    assertOpenYear(account)
    await lockAccount(tx, account.id)
    const cleared = await tx.entryLine.updateMany({
      where: { accountId: account.id, letteringCode: input.code, accountingEntry: { companyId } },
      data: { letteringCode: null, letteringDate: null },
    })
    if (cleared.count === 0) throw new NotFoundError(LETTERING_MESSAGES.codeNotFound(input.code))
    return { account, lineCount: cleared.count }
  }, TX_OPTIONS)

  await writeAuditLog('info', `Lettering ${input.code} removed on account ${result.account.code}`, {
    action: 'UNLETTER_ENTRY_LINES',
    companyId,
    metadata: { accountId: result.account.id, code: input.code, lineCount: result.lineCount, source: options.source ?? 'web' },
  })
  return { code: input.code, lineCount: result.lineCount }
}

/** Unlettered validated lines of an account, as the matcher reads them. */
async function openLinesForMatching(db: Db, companyId: string, accountId: string) {
  const rows = await db.entryLine.findMany({
    where: { accountId, letteringCode: null, accountingEntry: { companyId, status: 'validated' } },
    select: { id: true, debit: true, credit: true, auxiliaryAccountNumber: true, accountingEntry: { select: { id: true, date: true } } },
    orderBy: [{ accountingEntry: { date: 'asc' } }, { id: 'asc' }],
    take: MAX_LINES,
  })
  const reconciled = await reconciledEntryIds(db, companyId, [...new Set(rows.map((row) => row.accountingEntry.id))])
  return rows.map((row) => ({
    id: row.id,
    date: calendarDayOf(row.accountingEntry.date) as string,
    debitCents: cents(row.debit),
    creditCents: cents(row.credit),
    auxiliaryAccountNumber: row.auxiliaryAccountNumber,
    reconciled: reconciled.has(row.accountingEntry.id),
  }))
}

/** Automatic lettering proposals of an account (lib/lettering/match.ts). */
export async function getLetteringSuggestions(companyId: string, accountId: string): Promise<{ suggestions: LetteringSuggestion[] }> {
  const account = await loadAccount(prisma, companyId, accountId)
  return { suggestions: suggestLettering(await openLinesForMatching(prisma, companyId, account.id)) }
}

/**
 * Applies every automatic proposal of an account, computed again under the
 * account lock (a concurrent lettering is seen), one code per proposal.
 */
export async function autoLetterAccount(
  companyId: string,
  accountId: string,
  options: { now?: Date; source?: string } = {},
): Promise<{ groups: LetteredGroup[]; message: string }> {
  const letteringDay = parisDayOf(options.now ?? new Date())
  const result = await prisma.$transaction(async (tx) => {
    const account = await loadAccount(tx, companyId, accountId)
    assertOpenYear(account)
    await lockAccount(tx, account.id)
    const suggestions = suggestLettering(await openLinesForMatching(tx, companyId, account.id))
    const codes = await usedCodes(tx, account.id)
    const groups: LetteredGroup[] = []
    for (const suggestion of suggestions) {
      groups.push(await letterGroupInTx(tx, companyId, account.id, suggestion.lineIds, codes, letteringDay))
    }
    return { account, groups }
  }, TX_OPTIONS)

  if (result.groups.length > 0) {
    await writeAuditLog('info', `Automatic lettering on account ${result.account.code}: ${result.groups.length} group(s)`, {
      action: 'AUTO_LETTER_ENTRY_LINES',
      companyId,
      metadata: { accountId: result.account.id, codes: result.groups.map((g) => g.code), source: options.source ?? 'web' },
    })
  }
  const message =
    result.groups.length === 0
      ? 'Aucune proposition de lettrage sur ce compte.'
      : `${plural(result.groups.length, 'lettrage effectué', 'lettrages effectués')}\u00a0: ${result.groups.map((g) => g.code).join(', ')}.`
  return { groups: result.groups, message }
}

export interface LetteringPreview {
  account: { id: string; code: string; label: string }
  /** The code the lettering would take now (it may move if someone letters the account meanwhile). */
  code: string
  lines: Array<Pick<LetteringLine, 'id' | 'entryNumber' | 'date' | 'description' | 'debitCents' | 'creditCents' | 'auxiliaryAccountNumber' | 'letteringCode'>>
  debitCents: number
  creditCents: number
  /** French reasons the lettering would be refused; empty when it would succeed. */
  problems: string[]
}

/** What letterLines would do, without writing (assistants' dry run). */
export async function previewLettering(companyId: string, input: { accountId: string; lineIds: string[] }): Promise<LetteringPreview> {
  const account = await loadAccount(prisma, companyId, input.accountId)
  const ids = [...new Set(input.lineIds)]
  const [rows, codes] = await Promise.all([
    prisma.entryLine.findMany({ where: { id: { in: ids }, accountId: account.id, accountingEntry: { companyId } }, select: lineSelect }),
    usedCodes(prisma, account.id),
  ])
  const lines = rows.map((row) => ({
    id: row.id,
    entryNumber: row.accountingEntry.entryNumber,
    date: calendarDayOf(row.accountingEntry.date) as string,
    description: row.description || row.accountingEntry.description || '',
    debitCents: cents(row.debit),
    creditCents: cents(row.credit),
    auxiliaryAccountNumber: row.auxiliaryAccountNumber,
    letteringCode: row.letteringCode,
  }))
  const problems: string[] = []
  if (isFiscalYearClosed(account.fiscalYear)) problems.push(LETTERING_MESSAGES.closedYear(account.fiscalYear.year))
  if (rows.length !== ids.length) problems.push(LETTERING_MESSAGES.linesNotFound)
  const draft = rows.find((row) => row.accountingEntry.status !== 'validated')
  if (draft) problems.push(LETTERING_MESSAGES.draft(draft.accountingEntry.entryNumber))
  const check = checkSelection(lines)
  problems.push(...check.errors)
  return {
    account: { id: account.id, code: account.code, label: account.label },
    code: nextLetteringCode(codes),
    lines,
    debitCents: check.debitCents,
    creditCents: check.creditCents,
    problems,
  }
}
