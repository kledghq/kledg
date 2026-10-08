/**
 * Plans a FEC import without touching the database: groups the lines into
 * entries, assigns each entry to a fiscal year, checks every entry and lists
 * what will be created. Pure, so every rule is unit tested.
 *
 * Rules (French messages for the user):
 * - an entry is the set of lines sharing JournalCode and EcritureNum within a
 *   fiscal year (numbering may be global or per journal, BOI-CF-IOR-60-40-20
 *   § 100); its lines may be anywhere in the file;
 * - an entry is refused, never imported partially, when a date or an amount
 *   is unreadable, a line has both debit and credit, it has fewer than two
 *   lines with an amount, it does not balance to the cent, its fiscal year is
 *   closed (lib/accounting/entry-guards.ts), or its number already exists in
 *   that fiscal year;
 * - lines with a zero amount carry nothing and are skipped (reported);
 * - auxiliary accounts (CompAuxNum/CompAuxLib), lettrage (EcritureLet,
 *   DateLet), validation date, document reference and date, and foreign
 *   currency amounts are kept.
 */

import { centsToFecAmount, sumCents } from '@/lib/utils/money'
import { isDayWithin, type CalendarDay } from '@/lib/accounting/entry-date'
import { addIsoDays, formatIsoDateFr, lastDayOfMonth } from '@/lib/utils/date'
import { isFiscalYearClosed, fiscalYearDays, type GuardedFiscalYear } from '@/lib/accounting/entry-guards'
import { parseFecAmount, parseFecDay, type ParsedFecLine } from './parser'
import type { RefusedFecEntry } from './types'
import { plural, pluralWord } from '@/lib/utils/plural'

export interface PlanContext {
  closingMonth: number
  closingDay: number
  foundationDay: CalendarDay | null
  fiscalYears: GuardedFiscalYear[]
  /** Entry numbers already used, by fiscal year id. */
  existingNumbers: Map<string, Set<string>>
  cleanEntryNumbers?: boolean
}

export interface PlannedFiscalYear {
  year: number
  start: CalendarDay
  end: CalendarDay
  /** Set when the fiscal year exists. */
  id?: string
}

export interface PlannedLine {
  lineNumber: number
  accountCode: string
  accountLabel: string
  auxiliaryAccountNumber: string | null
  auxiliaryAccountLabel: string | null
  description: string | null
  debitCents: number
  creditCents: number
  letteringCode: string | null
  letteringDay: CalendarDay | null
  currencyAmountCents: number | null
  currencyCode: string | null
}

export interface PlannedEntry {
  label: string
  firstLine: number
  fiscalYear: number
  journalCode: string
  journalLabel: string
  entryNumber: string
  day: CalendarDay
  reference: string | null
  pieceDay: CalendarDay | null
  validDay: CalendarDay
  description: string | null
  lines: PlannedLine[]
}

export interface FecImportPlan {
  fiscalYears: PlannedFiscalYear[]
  entries: PlannedEntry[]
  refused: RefusedFecEntry[]
  warnings: string[]
  /** Journal code -> label (first JournalLib met). */
  journals: Map<string, string>
  /** Fiscal year -> account code -> label (first CompteLib met). */
  accounts: Map<number, Map<string, string>>
}

const text = (value: string | undefined | null): string | null => {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed : null
}

function isoOf(y: number, m: number, d: number): CalendarDay {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function closingDayOf(year: number, month: number, day: number): CalendarDay {
  return isoOf(year, month, Math.min(day, lastDayOfMonth(year, month)))
}

/**
 * Standard fiscal year containing a day, from the company closing date. The
 * year number is the closing year (01/10/2024 to 30/09/2025 is 2025).
 */
export function standardFiscalYear(
  day: CalendarDay,
  closingMonth: number,
  closingDay: number,
  foundationDay: CalendarDay | null = null,
): PlannedFiscalYear {
  const year = Number(day.slice(0, 4))
  const closingThisYear = closingDayOf(year, closingMonth, closingDay)
  const key = day <= closingThisYear ? year : year + 1
  const end = closingDayOf(key, closingMonth, closingDay)
  let start = addIsoDays(closingDayOf(key - 1, closingMonth, closingDay), 1)
  if (foundationDay && foundationDay > start && foundationDay <= end) start = foundationDay
  return { year: key, start, end }
}

/**
 * "001" -> "1", "OD-007" -> "OD-7": the last run of digits loses its leading
 * zeros. One backward scan, linear in the length: the former regex
 * /(\d+)(?!.*\d)/ was quadratic on a crafted EcritureNum such as "1a" repeated
 * (KLEDG-SEC-004). Zeros are stripped as text, so a long run keeps its digits
 * instead of turning into a float ("1e+21").
 */
export function cleanEntryNumber(entryNumber: string): string {
  const trimmed = entryNumber.trim()
  let end = trimmed.length
  while (end > 0 && !isAsciiDigit(trimmed.charCodeAt(end - 1))) end--
  if (end === 0) return trimmed
  let start = end
  while (start > 0 && isAsciiDigit(trimmed.charCodeAt(start - 1))) start--
  let firstSignificant = start
  while (firstSignificant < end - 1 && trimmed.charCodeAt(firstSignificant) === 48) firstSignificant++
  return trimmed.slice(0, start) + trimmed.slice(firstSignificant, end) + trimmed.slice(end)
}

const isAsciiDigit = (code: number) => code >= 48 && code <= 57

interface Group {
  journalCode: string
  number: string
  fiscalYear: PlannedFiscalYear | null
  lines: ParsedFecLine[]
  invalidDate: string | null
}

export function planFecImport(lines: ParsedFecLine[], ctx: PlanContext): FecImportPlan {
  const refused: RefusedFecEntry[] = []
  const warnings: string[] = []
  const journals = new Map<string, string>()
  const accounts = new Map<number, Map<string, string>>()
  const fiscalYears = new Map<number, PlannedFiscalYear & { isClosed?: boolean }>()
  const existingByYear = new Map(ctx.fiscalYears.map((fy) => [fy.year, fy]))

  const fiscalYearOf = (day: CalendarDay): (PlannedFiscalYear & { isClosed?: boolean }) | { conflict: string } => {
    const existing = ctx.fiscalYears.find((fy) => {
      const { start, end } = fiscalYearDays(fy)
      return isDayWithin(day, start, end)
    })
    if (existing) {
      const { start, end } = fiscalYearDays(existing)
      return { year: existing.year, start, end, id: existing.id, isClosed: isFiscalYearClosed(existing) }
    }
    const planned = standardFiscalYear(day, ctx.closingMonth, ctx.closingDay, ctx.foundationDay)
    const sameYear = existingByYear.get(planned.year)
    if (sameYear) {
      const { start, end } = fiscalYearDays(sameYear)
      return {
        conflict: `le ${formatIsoDateFr(day)} n'appartient à aucun exercice : l'exercice ${planned.year} existe déjà, du ${formatIsoDateFr(start)} au ${formatIsoDateFr(end)}`,
      }
    }
    // A new fiscal year must not overlap an existing one
    for (const fy of ctx.fiscalYears) {
      const { start, end } = fiscalYearDays(fy)
      if (start <= planned.end && end >= planned.start) {
        if (end < day && end >= planned.start) planned.start = addIsoDays(end, 1)
        if (start > day && start <= planned.end) {
          planned.end = addIsoDays(start, -1)
        }
      }
    }
    return planned
  }

  // 1. Group lines into entries (journal, number, fiscal year)
  const groups = new Map<string, Group>()
  for (const line of lines) {
    const journalCode = line.JournalCode.trim()
    const number = ctx.cleanEntryNumbers ? cleanEntryNumber(line.EcritureNum) : line.EcritureNum.trim()
    const day = parseFecDay(line.EcritureDate)
    let fiscalYear: PlannedFiscalYear | null = null
    let invalidDate: string | null = null
    let yearKey = 'invalid'
    if (!day) {
      invalidDate = `date d'écriture « ${line.EcritureDate} » invalide (format AAAAMMJJ attendu)`
    } else {
      const found = fiscalYearOf(day)
      if ('conflict' in found) {
        invalidDate = found.conflict
        yearKey = `conflict:${day}`
      } else {
        const known = fiscalYears.get(found.year)
        fiscalYear = known ?? found
        if (!known) fiscalYears.set(found.year, found)
        yearKey = String(found.year)
      }
    }
    const key = `${yearKey}\u0000${journalCode}\u0000${number}`
    let group = groups.get(key)
    if (!group) {
      group = { journalCode, number, fiscalYear, lines: [], invalidDate }
      groups.set(key, group)
    }
    group.lines.push(line)
    if (journalCode && !journals.has(journalCode)) journals.set(journalCode, text(line.JournalLib) ?? journalCode)
  }

  // 2. Per-journal numbering: a number used by two journals of a fiscal year
  // is kept unique by prefixing the journal code ("VT-12").
  const journalsByNumber = new Map<string, Set<string>>()
  for (const g of groups.values()) {
    if (!g.fiscalYear) continue
    const k = `${g.fiscalYear.year}\u0000${g.number}`
    const set = journalsByNumber.get(k) ?? new Set<string>()
    set.add(g.journalCode)
    journalsByNumber.set(k, set)
  }
  const perJournalYears = new Set<number>()
  for (const [k, set] of journalsByNumber) if (set.size > 1) perJournalYears.add(Number(k.split('\u0000')[0]))
  for (const year of [...perJournalYears].sort()) {
    warnings.push(
      `Exercice ${year} : numérotation par journal (un même numéro dans plusieurs journaux). Les numéros sont importés préfixés par le code journal (ex. « VT-12 »).`,
    )
  }

  // 3. Check each entry
  const entries: PlannedEntry[] = []
  const usedNumbers = new Map<number, Set<string>>()
  let zeroLines = 0
  for (const g of groups.values()) {
    const firstLine = Math.min(...g.lines.map((l) => l.lineNumber))
    const label = `${g.journalCode || '(sans journal)'} n° ${g.number || '(sans numéro)'}`
    const refuse = (reason: string) => refused.push({ entry: label, line: firstLine, reason })

    if (!g.journalCode) { refuse('code journal (JournalCode) absent'); continue }
    if (!g.number) { refuse("numéro d'écriture (EcritureNum) absent"); continue }
    if (g.invalidDate || !g.fiscalYear) { refuse(g.invalidDate ?? 'date invalide'); continue }
    const fy = g.fiscalYear as PlannedFiscalYear & { isClosed?: boolean }
    if (fy.isClosed) { refuse(`l'exercice ${fy.year} est clôturé : aucune écriture ne peut y être importée`); continue }

    const entryNumber = perJournalYears.has(fy.year) ? `${g.journalCode}-${g.number}` : g.number
    const existing = fy.id ? ctx.existingNumbers.get(fy.id) : undefined
    if (existing?.has(entryNumber)) {
      refuse(`le n° ${entryNumber} existe déjà dans l'exercice ${fy.year} (fichier déjà importé ?)`)
      continue
    }
    const used = usedNumbers.get(fy.year) ?? new Set<string>()
    usedNumbers.set(fy.year, used)

    const problems: string[] = []
    const planned: PlannedLine[] = []
    for (const line of g.lines) {
      const debit = parseFecAmount(line.Debit)
      const credit = parseFecAmount(line.Credit)
      if (debit === null) problems.push(`ligne ${line.lineNumber} : débit « ${line.Debit} » illisible`)
      if (credit === null) problems.push(`ligne ${line.lineNumber} : crédit « ${line.Credit} » illisible`)
      if (debit === null || credit === null) continue
      const accountCode = line.CompteNum.trim()
      if (!accountCode) { problems.push(`ligne ${line.lineNumber} : numéro de compte (CompteNum) absent`); continue }
      if (debit !== 0 && credit !== 0) {
        problems.push(`ligne ${line.lineNumber} : débit et crédit renseignés sur la même ligne`)
        continue
      }
      if (debit === 0 && credit === 0) { zeroLines++; continue }

      const letteringDay = text(line.DateLet) ? parseFecDay(line.DateLet) : null
      if (text(line.DateLet) && !letteringDay) warnings.push(`Ligne ${line.lineNumber} : DateLet « ${line.DateLet} » invalide, ignorée`)
      let currencyAmountCents: number | null = null
      if (text(line.Montantdevise)) {
        currencyAmountCents = parseFecAmount(line.Montantdevise)
        if (currencyAmountCents === null) warnings.push(`Ligne ${line.lineNumber} : Montantdevise « ${line.Montantdevise} » illisible, ignoré`)
      }
      planned.push({
        lineNumber: line.lineNumber,
        accountCode,
        accountLabel: text(line.CompteLib) ?? accountCode,
        auxiliaryAccountNumber: text(line.CompAuxNum),
        auxiliaryAccountLabel: text(line.CompAuxLib),
        description: text(line.EcritureLib),
        debitCents: debit,
        creditCents: credit,
        letteringCode: text(line.EcritureLet),
        letteringDay,
        currencyAmountCents,
        currencyCode: currencyAmountCents === null ? null : text(line.Idevise),
      })
    }
    if (problems.length > 0) { refuse(problems.join(' ; ')); continue }
    if (planned.length < 2) { refuse('moins de deux lignes avec un montant (partie double)'); continue }
    const debitTotal = sumCents(planned.map((l) => l.debitCents))
    const creditTotal = sumCents(planned.map((l) => l.creditCents))
    if (debitTotal !== creditTotal) {
      refuse(`écriture non équilibrée : débit ${centsToFecAmount(debitTotal)}, crédit ${centsToFecAmount(creditTotal)}`)
      continue
    }
    if (used.has(entryNumber)) { refuse(`n° ${entryNumber} en double dans l'exercice ${fy.year}`); continue }
    used.add(entryNumber)

    const first = g.lines[0]
    const day = parseFecDay(first.EcritureDate) as CalendarDay
    const dates = new Set(g.lines.map((l) => parseFecDay(l.EcritureDate)))
    if (dates.size > 1) warnings.push(`Écriture ${label} : plusieurs dates d'écriture, la première (${formatIsoDateFr(day)}) est retenue`)
    const references = new Set(g.lines.map((l) => text(l.PieceRef)).filter(Boolean))
    if (references.size > 1) warnings.push(`Écriture ${label} : plusieurs références de pièce, la première est retenue`)

    const pieceDay = text(first.PieceDate) ? parseFecDay(first.PieceDate) : null
    if (text(first.PieceDate) && !pieceDay) warnings.push(`Écriture ${label} : PieceDate « ${first.PieceDate} » invalide, date d'écriture retenue`)
    const validDay = text(first.ValidDate) ? parseFecDay(first.ValidDate) : null
    if (text(first.ValidDate) && !validDay) warnings.push(`Écriture ${label} : ValidDate « ${first.ValidDate} » invalide, date d'écriture retenue`)

    const yearAccounts = accounts.get(fy.year) ?? new Map<string, string>()
    accounts.set(fy.year, yearAccounts)
    for (const l of planned) if (!yearAccounts.has(l.accountCode)) yearAccounts.set(l.accountCode, l.accountLabel)

    entries.push({
      label,
      firstLine,
      fiscalYear: fy.year,
      journalCode: g.journalCode,
      journalLabel: journals.get(g.journalCode) ?? g.journalCode,
      entryNumber,
      day,
      reference: [...references][0] ?? null,
      pieceDay,
      validDay: validDay ?? day,
      description: text(first.EcritureLib),
      lines: planned,
    })
  }
  if (zeroLines > 0) warnings.push(`${plural(zeroLines, 'ligne')} sans montant (débit et crédit nuls) ${pluralWord(zeroLines, 'ignorée', 'ignorées')}`)

  refused.sort((a, b) => a.line - b.line)
  entries.sort((a, b) => a.firstLine - b.firstLine)
  return {
    fiscalYears: [...fiscalYears.values()]
      .map(({ year, start, end, id }) => ({ year, start, end, ...(id ? { id } : {}) }))
      .sort((a, b) => a.year - b.year),
    entries,
    refused,
    warnings,
    journals,
    accounts,
  }
}
