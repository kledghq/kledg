/**
 * Database side of the statement import: preview (what is new, what is
 * already there) and atomic, idempotent insertion of BankTransactions.
 *
 * Exact duplicates are skipped:
 *   - the stable import key (dedupe.ts) already stored on the account: the
 *     same line imported before, from this file or an overlapping one;
 *   - a line synced from the bank API with the same bank reference (its
 *     externalTransactionId, or its reference on the same day and amount);
 *   - a bank reference repeated inside the file.
 *
 * Probable duplicates catch the same operation coming from another source
 * (a CSV then an OFX of the same period, a file after an API sync) where
 * labels differ: a new line whose amount in cents and date match an
 * existing transaction of the account (same booking date, or same value
 * date when both sides have one; no wider tolerance). Matching is one to
 * one: N identical file lines against M existing transactions flag at most
 * min(N, M) lines, and an existing transaction already matched (exactly or
 * probably) is not used twice. Probable duplicates are skipped unless the
 * user keeps them; the server recomputes them at import time and only
 * honours a kept line whose index and key both still match.
 *
 * Insertion uses createMany(skipDuplicates) inside one transaction, so a
 * concurrent or repeated import of the same file never creates a duplicate
 * and a failure leaves nothing half imported.
 */

import { prisma } from '@/lib/prisma'
import { centsToDecimal } from '@/lib/utils/money'
import { parseAmountCents } from './amount'
import { importKeys, IMPORT_ID_PREFIX } from './dedupe'
import { matchProbableDuplicates, type ExistingLine } from '@/lib/banking/probable-duplicates'
import { signedBankCents } from '@/lib/banking/side'
import type { ParsedTransaction, ParseResult, RowError, StatementFormat } from './types'
import { pluralWord } from '@/lib/utils/plural'

export interface TargetAccount {
  id: string
  iban: string | null
  externalAccountId: string
  currency: string
}

/** Existing transaction a probable duplicate matches. */
export interface ProbableMatch {
  id: string
  date: string
  valueDate: string | null
  label: string | null
  amountCents: number
  /** 'file' for a previous file import, 'sync' for the bank API. */
  source: 'file' | 'sync'
  /** Format of the earlier import (csv, ofx...), when it was a file. */
  format: string | null
}

export interface PlannedTransaction {
  transaction: ParsedTransaction
  externalId: string
  duplicate: false | 'import' | 'sync' | 'file' | 'probable'
  match?: ProbableMatch
}

export interface ImportSummary {
  total: number
  /** Lines that will be imported (new lines and kept probable duplicates). */
  new: number
  /** Exact duplicates, always skipped. */
  duplicates: number
  /** Probable duplicates (same date and amount as an existing transaction). */
  probable: number
  /** Probable duplicates the user chose to import anyway. */
  probableKept: number
  /** First and last booking dates of the lines to import (null when none). */
  from: string | null
  to: string | null
  /** Sums of the lines to import, in cents (debits as a positive number). */
  debitsCents: number
  creditsCents: number
}

export interface ImportPlan {
  rows: PlannedTransaction[]
  summary: ImportSummary
  errors: RowError[]
  warnings: string[]
}

/** A probable duplicate the user chose to import: its row index in the plan and its key. */
export interface KeptProbable {
  index: number
  key: string
}

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s/g, '').toUpperCase()

/**
 * External id given to an account added by hand ("Ajouter un compte
 * bancaire"): a random id that no bank file can name, so it never identifies
 * the account in a statement.
 */
export const MANUAL_ACCOUNT_ID_PREFIX = 'manual:'

/**
 * Keeps the transactions of the target account when the file names its
 * accounts (OFX, camt.053), and rejects other currencies.
 */
export function selectAccountTransactions(parsed: ParseResult, account: TargetAccount): { transactions: ParsedTransaction[]; errors: RowError[]; warnings: string[] } {
  const errors: RowError[] = []
  const warnings: string[] = []
  let transactions = parsed.transactions

  const named = [...new Set(transactions.map((t) => clean(t.account)).filter(Boolean))]
  // A manual account is only known by its IBAN: without one, any account the file names may be it
  const externalId = account.externalAccountId.startsWith(MANUAL_ACCOUNT_ID_PREFIX) ? '' : account.externalAccountId
  const own = new Set([clean(account.iban), clean(externalId)].filter(Boolean))
  // A French IBAN contains the domestic account number (OFX ACCTID) before the RIB key
  const matches = (id: string) => own.has(id) || [...own].some((o) => Math.min(o.length, id.length) >= 8 && (o.includes(id) || id.includes(o)))
  if (named.length > 0 && own.size > 0) {
    const mine = named.filter(matches)
    if (mine.length === 0) {
      // Account numbers are written in many ways (RIB, IBAN, internal ids): the
      // user may confirm, like for bad lines, rather than being blocked.
      errors.push({
        line: -1,
        message: `Ce relevé concerne le compte ${named.join(', ')}, qui ne correspond pas au compte sélectionné${account.iban ? ` (${account.iban})` : ''}.`,
      })
    } else if (mine.length < named.length) {
      const others = named.filter((n) => !mine.includes(n))
      warnings.push(`Le fichier contient aussi ${pluralWord(others.length, 'le compte', 'les comptes')} ${others.join(', ')} : seules les opérations du compte sélectionné sont importées.`)
      transactions = transactions.filter((t) => !t.account || matches(clean(t.account)))
    }
  }

  const currency = account.currency.toUpperCase()
  transactions = transactions.filter((t) => {
    if (t.currency && t.currency.toUpperCase() !== currency) {
      errors.push({ line: t.line, message: `Ligne ${t.line} : devise ${t.currency} différente de celle du compte (${currency}).` })
      return false
    }
    return true
  })
  return { transactions, errors, warnings }
}

/** Indexes of the probable duplicates to import: only those whose index and key still match. */
function keptIndexes(rows: PlannedTransaction[], keep: KeptProbable[] = []): Set<number> {
  const kept = new Set<number>()
  for (const { index, key } of keep) {
    const row = rows[index]
    if (row && row.duplicate === 'probable' && row.externalId === key) kept.add(index)
  }
  return kept
}

const isImported = (row: PlannedTransaction, index: number, kept: Set<number>) =>
  row.duplicate === false || (row.duplicate === 'probable' && kept.has(index))

export function summarize(rows: PlannedTransaction[], kept: Set<number> = new Set()): ImportSummary {
  const fresh = rows.filter((r, i) => isImported(r, i, kept))
  const dates = fresh.map((r) => r.transaction.bookingDate).sort()
  const probable = rows.filter((r) => r.duplicate === 'probable').length
  return {
    total: rows.length,
    new: fresh.length,
    duplicates: rows.filter((r) => r.duplicate && r.duplicate !== 'probable').length,
    probable,
    probableKept: kept.size,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    debitsCents: fresh.reduce((s, r) => s + (r.transaction.amountCents < 0 ? -r.transaction.amountCents : 0), 0),
    creditsCents: fresh.reduce((s, r) => s + (r.transaction.amountCents > 0 ? r.transaction.amountCents : 0), 0),
  }
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10)

function shiftDay(day: string, days: number): Date {
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

interface ExistingRow {
  id: string
  externalTransactionId: string
  date: Date
  amount: { toFixed(digits: number): string }
  side: string
  label: string | null
  providerData: unknown
}

/** An existing transaction as a probable duplicate candidate (signed cents, booking and value days). */
function toMatch(row: ExistingRow): ProbableMatch & ExistingLine {
  const data = (row.providerData && typeof row.providerData === 'object' ? row.providerData : {}) as Record<string, unknown>
  const fromFile =
    row.externalTransactionId.startsWith(IMPORT_ID_PREFIX) || row.externalTransactionId.startsWith('import-') || data.source === 'file-import'
  const cents = signedBankCents(parseAmountCents(row.amount.toFixed(2), '.') ?? 0, row.side)
  const date = dayOf(row.date)
  const valueDate = typeof data.valueDate === 'string' ? data.valueDate : null
  return {
    id: row.id,
    date,
    valueDate,
    label: row.label,
    amountCents: cents,
    source: fromFile ? 'file' : 'sync',
    format: fromFile && typeof data.format === 'string' ? data.format : null,
    day: date,
    valueDay: valueDate,
  }
}

/** Splits parsed lines into new ones, exact duplicates and probable duplicates of what the account already holds. */
export async function planImport(account: TargetAccount, parsed: ParseResult, keep: KeptProbable[] = []): Promise<ImportPlan> {
  const selected = selectAccountTransactions(parsed, account)
  const keyed = importKeys(account.id, selected.transactions)

  const existingKeys = new Set<string>()
  const keys = keyed.map((k) => k.externalId)
  for (let i = 0; i < keys.length; i += 5000) {
    const found = await prisma.bankTransaction.findMany({
      where: { bankAccountId: account.id, externalTransactionId: { in: keys.slice(i, i + 5000) } },
      select: { externalTransactionId: true },
    })
    for (const row of found) existingKeys.add(row.externalTransactionId)
  }

  // Lines synced from the bank API carry the bank's own id
  const refs = [...new Set(keyed.map((k) => k.transaction.bankReference).filter((r): r is string => !!r))]
  const syncedIds = new Set<string>()
  const syncedRefs = new Map<string, Array<{ externalTransactionId: string; date: Date; amount: string; side: string }>>()
  for (let i = 0; i < refs.length; i += 5000) {
    const chunk = refs.slice(i, i + 5000)
    const found = await prisma.bankTransaction.findMany({
      where: {
        bankAccountId: account.id,
        NOT: { externalTransactionId: { startsWith: IMPORT_ID_PREFIX } },
        OR: [{ externalTransactionId: { in: chunk } }, { reference: { in: chunk } }],
      },
      select: { externalTransactionId: true, reference: true, date: true, amount: true, side: true },
    })
    for (const row of found) {
      syncedIds.add(row.externalTransactionId)
      if (row.reference) {
        const list = syncedRefs.get(row.reference) ?? []
        list.push({ externalTransactionId: row.externalTransactionId, date: row.date, amount: row.amount.toFixed(2), side: row.side })
        syncedRefs.set(row.reference, list)
      }
    }
  }

  // Existing transactions consumed by an exact match: never reused for a probable one
  const used = new Set<string>()
  const rows: PlannedTransaction[] = keyed.map(({ transaction, externalId, repeatedInFile }) => {
    let duplicate: PlannedTransaction['duplicate'] = false
    const ref = transaction.bankReference
    if (existingKeys.has(externalId)) {
      duplicate = 'import'
      used.add(externalId)
    } else if (repeatedInFile) duplicate = 'file'
    else if (ref && syncedIds.has(ref) && !used.has(ref)) {
      duplicate = 'sync'
      used.add(ref)
    } else if (ref) {
      const amount = centsToDecimal(Math.abs(transaction.amountCents))
      const side = transaction.amountCents < 0 ? 'debit' : 'credit'
      const hit = syncedRefs
        .get(ref)
        ?.find((s) => !used.has(s.externalTransactionId) && dayOf(s.date) === transaction.bookingDate && s.amount === amount && s.side === side)
      if (hit) {
        duplicate = 'sync'
        used.add(hit.externalTransactionId)
      }
    }
    return { transaction, externalId, duplicate }
  })

  // Probable duplicates: same amount and same date as an unused existing transaction
  const candidates = rows.filter((r) => r.duplicate === false)
  if (candidates.length > 0) {
    const days = candidates.flatMap((r) => [r.transaction.bookingDate, r.transaction.valueDate].filter((d): d is string => !!d)).sort()
    // Value dates sit a few days from booking dates: load a window around the file
    const existing = await prisma.bankTransaction.findMany({
      where: { bankAccountId: account.id, date: { gte: shiftDay(days[0], -31), lte: shiftDay(days[days.length - 1], 31) } },
      select: { id: true, externalTransactionId: true, date: true, amount: true, side: true, label: true, providerData: true },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    // One to one, count aware (lib/banking/probable-duplicates.ts)
    const pool = existing.filter((row) => !used.has(row.externalTransactionId)).map(toMatch)
    const matches = matchProbableDuplicates(
      candidates.map((r) => ({ amountCents: r.transaction.amountCents, day: r.transaction.bookingDate, valueDay: r.transaction.valueDate ?? null })),
      pool,
    )
    for (const [index, hit] of matches) {
      const { amountCents, date, valueDate, id, label, source, format } = hit
      candidates[index].duplicate = 'probable'
      candidates[index].match = { id, date, valueDate, label, amountCents, source, format }
    }
  }

  return {
    rows,
    summary: summarize(rows, keptIndexes(rows, keep)),
    errors: [...parsed.errors, ...selected.errors],
    warnings: [...parsed.warnings, ...selected.warnings],
  }
}

/**
 * Inserts the new lines of a plan, and the probable duplicates listed in
 * `keep` (checked again against the plan), in one transaction. Returns how
 * many rows were created.
 */
export async function commitImport(
  account: TargetAccount,
  plan: ImportPlan,
  source: { format: StatementFormat; fileName?: string },
  keep: KeptProbable[] = [],
): Promise<number> {
  const kept = keptIndexes(plan.rows, keep)
  const data = plan.rows
    .filter((r, i) => isImported(r, i, kept))
    .map(({ transaction: t, externalId }) => ({
      bankAccountId: account.id,
      externalTransactionId: externalId,
      amount: centsToDecimal(Math.abs(t.amountCents)),
      side: t.amountCents < 0 ? 'debit' : 'credit',
      // Calendar date at UTC midnight, like the API sync (lib/utils/date.ts toUtcDateOnly)
      date: new Date(`${t.bookingDate}T00:00:00.000Z`),
      label: t.label.slice(0, 1000),
      reference: t.reference?.slice(0, 255) ?? null,
      counterpartyName: t.counterparty?.slice(0, 255) ?? null,
      imported: true,
      reconciled: false,
      status: 'completed',
      providerData: {
        source: 'file-import',
        format: source.format,
        ...(source.fileName ? { fileName: source.fileName.slice(0, 255) } : {}),
        ...(t.valueDate ? { valueDate: t.valueDate } : {}),
        ...(t.bankReference ? { bankReference: t.bankReference } : {}),
      },
    }))
  if (data.length === 0) return 0

  return prisma.$transaction(
    async (tx) => {
      let created = 0
      for (let i = 0; i < data.length; i += 1000) {
        const result = await tx.bankTransaction.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true })
        created += result.count
      }
      return created
    },
    { timeout: 60_000, maxWait: 10_000 },
  )
}
