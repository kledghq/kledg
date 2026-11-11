/**
 * FEC (Fichier des Écritures Comptables) import.
 *
 * 1. Decode (UTF-8 or ISO 8859-15) and parse the file (fec/parser.ts).
 * 2. Plan without writing (fec/plan.ts): entries, fiscal years, journals and
 *    accounts to create, and every entry that must be refused, with its reason.
 * 3. If anything is refused, nothing is written: the result lists each
 *    refused entry (French messages). Otherwise everything is written in one
 *    database transaction: fiscal years, journals, accounts, then the entries
 *    as validated entries keeping their FEC number and validation date (a FEC
 *    only contains validated entries, LPF art. A47 A-1). The database checks
 *    once more that each entry balances when it is validated.
 *
 * Exporting a Kledg fiscal year and importing it into an empty company gives
 * the same entries, numbers and balances (round trip, see the tests).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import type { FECColumnMapping } from '@/lib/import/types'
import { dayToDate, type CalendarDay } from '@/lib/accounting/entry-date'
import { calendarDayOf } from '@/lib/utils/date'
import { GUARDED_FISCAL_YEAR_SELECT } from '@/lib/accounting/entry-guards'
import { centsToDecimal } from '@/lib/utils/money'
import { handleError, ValidationError } from '@/lib/accounting/errors'
import { createId } from '@/lib/crypto/ids'
import { decodeFecBytes, parseFecFile, type ParsedFecFile } from '@/lib/import/fec/parser'
import { planFecImport, type FecImportPlan, type PlannedEntry } from '@/lib/import/fec/plan'
import { getParentAccountCode, simplifyAccountCode } from '@/lib/import/fec/mapper'
import { reconcileBankEntries } from '@/lib/services/banking/reconciliation-service'
import type { BankEntryToMatch } from '@/lib/reconciliation/bank-line-match'
import type { FECImportOptions, FiscalYearInfo, ImportResult } from '@/lib/import/fec/types'
import { plural } from '@/lib/utils/plural'
import { groupRefusals } from '@/lib/import/fec/refusal-report'
import { assertNoFiscalYearOverlap, lockCompanyFiscalYears } from '@/lib/accounting/manage-fiscal-years.service'

// Re-export public types
export type { FECLine, ImportResult, FECImportOptions, FiscalYearInfo } from '@/lib/import/fec/types'

async function loadPlanContext(companyId: string, cleanEntryNumbers: boolean) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { closingDay: true, closingMonth: true, foundationDate: true },
  })
  if (!company) throw new ValidationError('Société introuvable')
  const fiscalYears = await prisma.fiscalYear.findMany({ where: { companyId }, select: GUARDED_FISCAL_YEAR_SELECT })
  const numbers = await prisma.accountingEntry.findMany({
    where: { companyId },
    select: { fiscalYearId: true, entryNumber: true },
  })
  const existingNumbers = new Map<string, Set<string>>()
  for (const { fiscalYearId, entryNumber } of numbers) {
    const set = existingNumbers.get(fiscalYearId) ?? new Set<string>()
    set.add(entryNumber)
    existingNumbers.set(fiscalYearId, set)
  }
  return {
    closingMonth: company.closingMonth ?? 12,
    closingDay: company.closingDay ?? 31,
    foundationDay: company.foundationDate ? calendarDayOf(company.foundationDate) : null,
    fiscalYears,
    existingNumbers,
    cleanEntryNumbers,
  }
}

function decode(options: { content?: string; bytes?: Uint8Array }): { text: string; encoding: string } {
  if (options.bytes) return decodeFecBytes(options.bytes)
  return { text: (options.content ?? '').replace(/^\uFEFF/, ''), encoding: 'UTF-8' }
}

/**
 * Fiscal years the file covers (existing or to create), with their counts.
 * Used by the import dialog before importing.
 */
export async function previewFECFiscalYears(options: {
  companyId: string
  content: string
  columnMapping?: FECColumnMapping
}): Promise<FiscalYearInfo[]> {
  const parsed = parseFecFile(options.content, options.columnMapping)
  if (parsed.lines.length === 0) return []
  const ctx = await loadPlanContext(options.companyId, false)
  const plan = planFecImport(parsed.lines, ctx)
  return fiscalYearInfos(plan, ctx.fiscalYears, parsed)
}

function fiscalYearInfos(
  plan: FecImportPlan,
  existing: Array<{ id: string; year: number; isClosed: boolean }>,
  parsed: ParsedFecFile,
  createdIds: Map<number, string> = new Map(),
): FiscalYearInfo[] {
  // One pass over the entries and one over the lines: the number of years only sizes the maps
  const byYear = new Map<number, { entries: number; lines: number; accounts: Set<string>; journals: Set<string> }>()
  const yearOfLine = new Map<number, number>()
  for (const fy of plan.fiscalYears) byYear.set(fy.year, { entries: 0, lines: 0, accounts: new Set(), journals: new Set() })
  for (const entry of plan.entries) {
    const counts = byYear.get(entry.fiscalYear)
    if (!counts) continue
    counts.entries++
    counts.lines += entry.lines.length
    for (const line of entry.lines) yearOfLine.set(line.lineNumber, entry.fiscalYear)
  }
  for (const line of parsed.lines) {
    const year = yearOfLine.get(line.lineNumber)
    const counts = year === undefined ? undefined : byYear.get(year)
    if (!counts) continue
    counts.accounts.add(line.CompteNum)
    counts.journals.add(line.JournalCode)
  }
  const existingByYear = new Map(existing.map((e) => [e.year, e]))
  // Fiscal years of refused entries count too (e.g. a closed year)
  return plan.fiscalYears.map((fy) => {
    const known = existingByYear.get(fy.year)
    const counts = byYear.get(fy.year)!
    return {
      id: known?.id ?? createdIds.get(fy.year) ?? '',
      year: fy.year,
      startDate: dayToDate(fy.start).toISOString(),
      endDate: dayToDate(fy.end).toISOString(),
      wasCreated: !known,
      isClosed: known?.isClosed ?? false,
      entriesCount: counts.entries,
      linesCount: counts.lines,
      accountsCount: counts.accounts.size,
      journalsCount: counts.journals.size,
    }
  })
}

/** Refused entries returned in detail; `refusedCount` gives the total. */
export const MAX_REPORTED_REFUSALS = 1_000

/** Validation instant stored for a FEC ValidDate: noon UTC, the same day in France. */
function validationInstant(day: CalendarDay): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

async function inChunks<T>(rows: T[], size: number, write: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size))
}

/**
 * Imports a FEC. Atomic: all entries or none.
 *
 * @example
 * const result = await importFEC({ companyId, bytes: new Uint8Array(await file.arrayBuffer()) })
 * if (!result.success) console.log(result.refused)
 */
export async function importFEC(options: FECImportOptions): Promise<ImportResult> {
  const { companyId, columnMapping, accountMapping = {}, journalMapping = {}, cleanEntryNumbers = false } = options
  const result: ImportResult = {
    success: false,
    entriesCreated: 0,
    linesCreated: 0,
    accountsCreated: 0,
    journalsCreated: 0,
    errors: [],
    refused: [],
    warnings: [],
    fiscalYears: [],
  }

  try {
    const { text, encoding } = decode(options)
    result.encoding = encoding
    const parsed = parseFecFile(text, columnMapping)
    result.separator = parsed.separator
    result.warnings!.push(...parsed.warnings)
    if (parsed.lines.length === 0 && parsed.errorCount === 0) {
      result.errors.push('Le fichier FEC ne contient aucune écriture.')
      return result
    }

    const ctx = await loadPlanContext(companyId, cleanEntryNumbers)
    const plan = planFecImport(parsed.lines, ctx)
    result.warnings!.push(...plan.warnings)
    const refused = [
      ...parsed.errors.map((e) => ({ entry: '(ligne illisible)', line: e.line, reason: e.message })),
      ...plan.refused,
    ].sort((a, b) => a.line - b.line)
    // Parse errors beyond the ones the parser kept are counted, not listed
    const refusedCount = parsed.errorCount + plan.refused.length
    result.refused = refused.slice(0, MAX_REPORTED_REFUSALS)
    result.refusedCount = refusedCount

    // Mapped accounts and journals must belong to the company
    const mappedAccountIds = Object.values(accountMapping).filter((id): id is string => !!id)
    const mappedAccounts = mappedAccountIds.length
      ? await prisma.account.findMany({ where: { id: { in: mappedAccountIds }, companyId }, select: { id: true, code: true, label: true } })
      : []
    if (mappedAccounts.length !== new Set(mappedAccountIds).size) {
      result.errors.push("Correspondance de comptes invalide : un compte choisi n'appartient pas à cette société.")
    }
    const mappedJournalIds = Object.values(journalMapping).filter((id): id is string => !!id)
    const mappedJournals = mappedJournalIds.length
      ? await prisma.journal.findMany({ where: { id: { in: mappedJournalIds }, companyId }, select: { id: true } })
      : []
    if (mappedJournals.length !== new Set(mappedJournalIds).size) {
      result.errors.push("Correspondance de journaux invalide : un journal choisi n'appartient pas à cette société.")
    }

    if (refusedCount > 0) {
      result.errors.push(
        `${plural(refusedCount, 'écriture refusée', 'écritures refusées')} : aucune écriture n'a été importée. Corrigez le fichier puis relancez l'import.`,
        // One message per distinct reason, with its count and first lines
        ...groupRefusals(result.refused),
      )
      if (refusedCount > result.refused.length) {
        result.errors.push(`Seules les ${MAX_REPORTED_REFUSALS.toLocaleString('fr-FR')} premières écritures refusées sont détaillées.`)
      }
    }
    if (result.errors.length > 0) {
      result.fiscalYears = fiscalYearInfos(plan, ctx.fiscalYears, parsed)
      return result
    }
    if (plan.entries.length === 0) {
      result.errors.push('Aucune écriture à importer.')
      return result
    }

    const accountCodeByMapping = new Map<string, { code: string; label: string }>()
    for (const [fecCode, id] of Object.entries(accountMapping)) {
      const account = id ? mappedAccounts.find((a) => a.id === id) : undefined
      if (account) accountCodeByMapping.set(fecCode, { code: account.code, label: account.label })
    }

    const written = await prisma.$transaction(
      (db) => writePlan(db, companyId, plan, { accountCodeByMapping, journalMapping }),
      { maxWait: 20_000, timeout: 600_000 },
    )
    Object.assign(result, {
      success: true,
      entriesCreated: written.entries,
      linesCreated: written.lines,
      accountsCreated: written.accounts,
      journalsCreated: written.journals,
    })
    result.fiscalYears = fiscalYearInfos(plan, ctx.fiscalYears, parsed, written.fiscalYearIds)

    // After the commit: match bank journal entries with bank transactions (one
    // transaction per entry, the shared matcher of the auto-reconcile action).
    // The import stands whatever happens here; a failure is reported.
    const reconciliation = await reconcileBankEntries(companyId, written.bankEntries)
    if (reconciliation.failed > 0) {
      result.warnings!.push(
        `Rapprochement automatique interrompu pour ${plural(reconciliation.failed, 'écriture bancaire', 'écritures bancaires')} : lancez « Rapprocher automatiquement » depuis le rapprochement bancaire.`,
      )
    }
  } catch (error) {
    const { message } = handleError(error)
    result.success = false
    result.errors.push(`Import annulé, aucune écriture importée : ${message}`)
    logger.debug('[import/fec] Import failed', { companyId, error: error instanceof Error ? error.message : String(error) })
  }

  return result
}

interface WriteOptions {
  accountCodeByMapping: Map<string, { code: string; label: string }>
  journalMapping: Record<string, string | null>
}

async function writePlan(db: Prisma.TransactionClient, companyId: string, plan: FecImportPlan, options: WriteOptions) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { closingDay: true, closingMonth: true } })

  // Fiscal years: created under the per-company lock, never over another year (closed or not)
  if (plan.fiscalYears.some((fy) => !fy.id)) await lockCompanyFiscalYears(db, companyId)
  const fiscalYearIds = new Map<number, string>()
  const created = new Map<number, string>()
  for (const fy of plan.fiscalYears) {
    if (fy.id) {
      fiscalYearIds.set(fy.year, fy.id)
      continue
    }
    await assertNoFiscalYearOverlap(db, companyId, { start: dayToDate(fy.start), end: dayToDate(fy.end) })
    const row = await db.fiscalYear.create({
      data: {
        companyId,
        year: fy.year,
        closingDay: company.closingDay ?? 31,
        closingMonth: company.closingMonth ?? 12,
        startDate: dayToDate(fy.start),
        endDate: dayToDate(fy.end),
        isClosed: false,
      },
      select: { id: true },
    })
    fiscalYearIds.set(fy.year, row.id)
    created.set(fy.year, row.id)
  }

  // Journals (company level): mapping, else same code, else created
  const journalIds = new Map<string, string>()
  const existingJournals = await db.journal.findMany({ where: { companyId }, select: { id: true, code: true } })
  const journalByCode = new Map(existingJournals.map((j) => [j.code, j.id]))
  const newJournals: Prisma.JournalCreateManyInput[] = []
  for (const [code, label] of plan.journals) {
    const mapped = options.journalMapping[code]
    const id = (mapped && existingJournals.some((j) => j.id === mapped) ? mapped : undefined) ?? journalByCode.get(code)
    if (id) {
      journalIds.set(code, id)
    } else {
      const newId = createId()
      newJournals.push({ id: newId, companyId, code, label })
      journalIds.set(code, newId)
    }
  }
  if (newJournals.length) await db.journal.createMany({ data: newJournals })

  // Accounts (per fiscal year): mapping (by the mapped account's number), exact number, number without trailing zeros, else created
  const accountIds = new Map<number, Map<string, string>>()
  const codeById = new Map<string, string>()
  let accountsCreated = 0
  for (const [year, codes] of plan.accounts) {
    const fiscalYearId = fiscalYearIds.get(year)!
    const existing = await db.account.findMany({ where: { companyId, fiscalYearId }, select: { id: true, code: true } })
    for (const a of existing) codeById.set(a.id, a.code)
    const byCode = new Map(existing.map((a) => [a.code, a.id]))
    const bySimplified = new Map<string, string>()
    for (const a of existing) if (!bySimplified.has(simplifyAccountCode(a.code))) bySimplified.set(simplifyAccountCode(a.code), a.id)
    const toCreate = new Map<string, { id: string; code: string; label: string }>()
    const ids = new Map<string, string>()
    for (const [fecCode, fecLabel] of codes) {
      const mapped = options.accountCodeByMapping.get(fecCode)
      const code = mapped?.code ?? fecCode
      const label = mapped?.label ?? fecLabel
      let id = byCode.get(code) ?? toCreate.get(code)?.id
      if (!id && !mapped) id = bySimplified.get(simplifyAccountCode(code))
      if (!id) {
        id = createId()
        toCreate.set(code, { id, code, label })
        codeById.set(id, code)
      }
      ids.set(fecCode, id)
    }
    const known = new Map([...byCode, ...[...toCreate.values()].map((a) => [a.code, a.id] as const)])
    const rows: Prisma.AccountCreateManyInput[] = [...toCreate.values()].map((a) => {
      const parentCode = getParentAccountCode(a.code)
      const parentId = parentCode ? known.get(parentCode) ?? bySimplified.get(simplifyAccountCode(parentCode)) : undefined
      return { id: a.id, companyId, fiscalYearId, code: a.code, label: a.label, parentId: parentId && parentId !== a.id ? parentId : null }
    })
    if (rows.length) await db.account.createMany({ data: rows })
    accountsCreated += rows.length
    accountIds.set(year, ids)
  }

  // Entries: inserted as drafts with their FEC number, lines, then validated
  const entryRows: Prisma.AccountingEntryCreateManyInput[] = []
  const lineRows: Prisma.EntryLineCreateManyInput[] = []
  const validations: Array<{ id: string; at: Date }> = []
  const bankEntries: BankEntryToMatch[] = []
  const base = Date.now()
  let sequence = 0
  for (const entry of plan.entries) {
    const id = createId()
    const fiscalYearId = fiscalYearIds.get(entry.fiscalYear)!
    const accounts = accountIds.get(entry.fiscalYear)!
    entryRows.push(entryRow(id, companyId, fiscalYearId, journalIds.get(entry.journalCode)!, entry))
    for (const line of entry.lines) {
      lineRows.push({
        id: createId(),
        accountingEntryId: id,
        accountingEntryNumber: entry.entryNumber,
        accountId: accounts.get(line.accountCode)!,
        accountFiscalYearId: fiscalYearId,
        debit: new Prisma.Decimal(centsToDecimal(line.debitCents)),
        credit: new Prisma.Decimal(centsToDecimal(line.creditCents)),
        description: line.description,
        auxiliaryAccountNumber: line.auxiliaryAccountNumber,
        auxiliaryAccountLabel: line.auxiliaryAccountLabel,
        letteringCode: line.letteringCode,
        letteringDate: line.letteringDay ? dayToDate(line.letteringDay) : null,
        currencyAmount: line.currencyAmountCents === null ? null : new Prisma.Decimal(centsToDecimal(line.currencyAmountCents)),
        currencyCode: line.currencyCode,
        // Keeps the file order of the lines (the FEC export sorts lines by creation time)
        createdAt: new Date(base + sequence++),
      })
    }
    validations.push({ id, at: validationInstant(entry.validDay) })
    if (entry.journalCode.toUpperCase() === 'BQ') {
      bankEntries.push({
        id,
        date: dayToDate(entry.day),
        lines: entry.lines.map((l) => ({
          accountCode: codeById.get(accounts.get(l.accountCode)!) ?? l.accountCode,
          debit: centsToDecimal(l.debitCents),
          credit: centsToDecimal(l.creditCents),
        })),
      })
    }
  }
  await inChunks(entryRows, 2000, (data) => db.accountingEntry.createMany({ data }))
  await inChunks(lineRows, 5000, (data) => db.entryLine.createMany({ data }))
  await inChunks(validations, 2000, (chunk) => db.$executeRaw`
    UPDATE "accounting_entries" AS e
    SET "status" = 'validated', "validatedAt" = v.at
    FROM unnest(${chunk.map((v) => v.id)}::text[], ${chunk.map((v) => v.at)}::timestamp[]) AS v(id, at)
    WHERE e."id" = v.id
  `)

  return {
    entries: entryRows.length,
    lines: lineRows.length,
    accounts: accountsCreated,
    journals: newJournals.length,
    fiscalYearIds: created,
    bankEntries,
  }
}

function entryRow(
  id: string,
  companyId: string,
  fiscalYearId: string,
  journalId: string,
  entry: PlannedEntry,
): Prisma.AccountingEntryCreateManyInput {
  return {
    id,
    companyId,
    fiscalYearId,
    journalId,
    entryNumber: entry.entryNumber,
    date: dayToDate(entry.day),
    description: entry.description,
    reference: entry.reference,
    pieceDate: entry.pieceDay ? dayToDate(entry.pieceDay) : null,
    status: 'draft',
  }
}
