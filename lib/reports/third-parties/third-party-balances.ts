/**
 * Aged balance (balance âgée) and auxiliary balance (balance auxiliaire) of
 * the customer (411) and supplier (401) accounts, computed from entry lines
 * on plain values. Pure module (one import, itself pure): the services load
 * the lines, the tests feed them directly.
 *
 * Tiers: the auxiliary account of a line (FEC CompAuxNum) when it has one,
 * else its account (a detailed account such as 411DUPONT is a tiers of its
 * own). Lines of a collective account without auxiliary account form one
 * tiers named after the account.
 *
 * Signs: a customer owes the company (debit - credit), the company owes a
 * supplier (credit - debit); both are shown positive when owed.
 */

import { daysBetween, dueDateOf, type PaymentTerms } from './payment-terms'

export type ThirdPartyKind = 'customers' | 'suppliers'

export const KIND_LABELS: Record<ThirdPartyKind, string> = { customers: 'Clients', suppliers: 'Fournisseurs' }

export function kindOfAccount(code: string): ThirdPartyKind | null {
  if (code.startsWith('411')) return 'customers'
  if (code.startsWith('401')) return 'suppliers'
  return null
}

export interface ThirdPartyLine {
  accountCode: string
  accountLabel: string
  auxiliaryAccountNumber: string | null
  auxiliaryAccountLabel: string | null
  /** Entry date, yyyy-mm-dd. */
  date: string
  debitCents: number
  creditCents: number
  letteringCode: string | null
  /** yyyy-mm-dd */
  letteringDate: string | null
  /** Line of the opening entry (journal AN). */
  opening?: boolean
}

export interface Tiers {
  /** Auxiliary account number, or the account code. */
  code: string
  label: string
  /** Account code(s) of its lines. */
  accountCodes: string[]
}

function tiersOf(line: ThirdPartyLine): { code: string; label: string } {
  const aux = line.auxiliaryAccountNumber?.trim()
  if (aux) return { code: aux, label: line.auxiliaryAccountLabel?.trim() || line.accountLabel }
  return { code: line.accountCode, label: line.accountLabel }
}

/** What the tiers owes (customers) or is owed (suppliers), in cents, positive when owed. */
function owedCents(kind: ThirdPartyKind, line: Pick<ThirdPartyLine, 'debitCents' | 'creditCents'>): number {
  return kind === 'customers' ? line.debitCents - line.creditCents : line.creditCents - line.debitCents
}

/** Whether a line is still open on `asOf`: not lettered, or lettered later. */
export function openOn(line: Pick<ThirdPartyLine, 'letteringCode' | 'letteringDate'>, asOf: string): boolean {
  if (!line.letteringCode) return true
  return line.letteringDate !== null && line.letteringDate > asOf
}

// ------------------------------------------------------------------ aged balance

export const AGE_BUCKETS = ['notDue', 'days0to30', 'days31to60', 'days61to90', 'over90'] as const
export type AgeBucket = (typeof AGE_BUCKETS)[number]

export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  notDue: 'Non échu',
  days0to30: '0 à 30 jours',
  days31to60: '31 à 60 jours',
  days61to90: '61 à 90 jours',
  over90: 'Plus de 90 jours',
}

/**
 * Bucket of an amount by its days past due on the report day: a line due
 * on the report day or later is not due (paying on the due date is on
 * time); 1 to 30 days late is "0 à 30 jours" (late by less than a month),
 * then 31 to 60, 61 to 90, more than 90.
 */
export function bucketOf(daysPastDue: number): AgeBucket {
  if (daysPastDue <= 0) return 'notDue'
  if (daysPastDue <= 30) return 'days0to30'
  if (daysPastDue <= 60) return 'days31to60'
  if (daysPastDue <= 90) return 'days61to90'
  return 'over90'
}

export type BucketAmounts = Record<AgeBucket, number> & { totalCents: number }

const emptyBuckets = (): BucketAmounts => ({ notDue: 0, days0to30: 0, days31to60: 0, days61to90: 0, over90: 0, totalCents: 0 })

/** Overdue part of a set of buckets (everything but "non échu"). */
export function overdueCents(buckets: BucketAmounts): number {
  return buckets.days0to30 + buckets.days31to60 + buckets.days61to90 + buckets.over90
}

export interface AgedTiers extends Tiers {
  buckets: BucketAmounts
  /** Open lines of the tiers on the report day. */
  lineCount: number
  /** Oldest due date among its open invoices, yyyy-mm-dd. */
  oldestDueDate: string | null
}

export interface AgedSection {
  kind: ThirdPartyKind
  tiers: AgedTiers[]
  totals: BucketAmounts
}

/**
 * Due date of a line: an invoice (debit of a customer, credit of a
 * supplier) is due after the payment terms; a payment, a credit note or an
 * advance on the other side is aged from its own date, without terms.
 */
export function lineDueDate(kind: ThirdPartyKind, line: ThirdPartyLine, terms: PaymentTerms): string {
  return owedCents(kind, line) > 0 ? dueDateOf(line.date, terms) : line.date
}

/**
 * Aged balance on `asOf` (yyyy-mm-dd): the open lines dated on or before it,
 * per tiers and per age bucket, sorted by overdue amount (most overdue
 * first), then by total. Tiers whose open lines sum to zero are left out.
 */
export function buildAgedBalance(lines: readonly ThirdPartyLine[], asOf: string, terms: PaymentTerms): Record<ThirdPartyKind, AgedSection> {
  const sections: Record<ThirdPartyKind, Map<string, AgedTiers>> = { customers: new Map(), suppliers: new Map() }
  for (const line of lines) {
    const kind = kindOfAccount(line.accountCode)
    if (!kind || line.date > asOf || !openOn(line, asOf)) continue
    const amount = owedCents(kind, line)
    if (amount === 0) continue
    const { code, label } = tiersOf(line)
    let tiers = sections[kind].get(code)
    if (!tiers) {
      tiers = { code, label, accountCodes: [], buckets: emptyBuckets(), lineCount: 0, oldestDueDate: null }
      sections[kind].set(code, tiers)
    }
    if (!tiers.accountCodes.includes(line.accountCode)) tiers.accountCodes.push(line.accountCode)
    const due = lineDueDate(kind, line, terms)
    tiers.buckets[bucketOf(daysBetween(due, asOf))] += amount
    tiers.buckets.totalCents += amount
    tiers.lineCount += 1
    if (amount > 0 && (tiers.oldestDueDate === null || due < tiers.oldestDueDate)) tiers.oldestDueDate = due
  }
  const build = (kind: ThirdPartyKind): AgedSection => {
    const tiers = [...sections[kind].values()]
      .filter((t) => t.buckets.totalCents !== 0)
      .sort((a, b) => overdueCents(b.buckets) - overdueCents(a.buckets) || b.buckets.totalCents - a.buckets.totalCents || a.code.localeCompare(b.code))
    const totals = emptyBuckets()
    for (const t of tiers) {
      for (const bucket of AGE_BUCKETS) totals[bucket] += t.buckets[bucket]
      totals.totalCents += t.buckets.totalCents
    }
    return { kind, tiers, totals }
  }
  return { customers: build('customers'), suppliers: build('suppliers') }
}

// ------------------------------------------------------------------ auxiliary balance

export interface AuxiliaryTiers extends Tiers {
  /** Balance before the period (opening entry and earlier lines), signed debit - credit. */
  openingCents: number
  debitCents: number
  creditCents: number
  /** opening + debit - credit, signed debit - credit. */
  closingCents: number
  /** Open (unlettered) lines on the last day of the period, signed debit - credit. */
  unletteredCents: number
}

export interface AuxiliarySection {
  kind: ThirdPartyKind
  tiers: AuxiliaryTiers[]
  totals: Omit<AuxiliaryTiers, keyof Tiers>
}

/**
 * Auxiliary balance of the period [start, end] (yyyy-mm-dd) per tiers:
 * opening balance (opening entry and lines before the period), movements
 * of the period, closing balance and the part still unlettered at the end
 * of the period. Amounts are signed debit - credit, like the trial balance
 * (a customer balance is a debit, a supplier balance a credit).
 */
export function buildAuxiliaryBalance(lines: readonly ThirdPartyLine[], start: string, end: string): Record<ThirdPartyKind, AuxiliarySection> {
  const sections: Record<ThirdPartyKind, Map<string, AuxiliaryTiers>> = { customers: new Map(), suppliers: new Map() }
  for (const line of lines) {
    const kind = kindOfAccount(line.accountCode)
    if (!kind || line.date > end) continue
    const { code, label } = tiersOf(line)
    let tiers = sections[kind].get(code)
    if (!tiers) {
      tiers = { code, label, accountCodes: [], openingCents: 0, debitCents: 0, creditCents: 0, closingCents: 0, unletteredCents: 0 }
      sections[kind].set(code, tiers)
    }
    if (!tiers.accountCodes.includes(line.accountCode)) tiers.accountCodes.push(line.accountCode)
    const net = line.debitCents - line.creditCents
    if (line.opening || line.date < start) {
      tiers.openingCents += net
    } else {
      tiers.debitCents += line.debitCents
      tiers.creditCents += line.creditCents
    }
    tiers.closingCents += net
    if (openOn(line, end)) tiers.unletteredCents += net
  }
  const build = (kind: ThirdPartyKind): AuxiliarySection => {
    const tiers = [...sections[kind].values()].sort((a, b) => a.code.localeCompare(b.code))
    const totals = { openingCents: 0, debitCents: 0, creditCents: 0, closingCents: 0, unletteredCents: 0 }
    for (const t of tiers) {
      totals.openingCents += t.openingCents
      totals.debitCents += t.debitCents
      totals.creditCents += t.creditCents
      totals.closingCents += t.closingCents
      totals.unletteredCents += t.unletteredCents
    }
    return { kind, tiers, totals }
  }
  return { customers: build('customers'), suppliers: build('suppliers') }
}
