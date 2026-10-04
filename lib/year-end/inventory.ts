/**
 * Year-end inventory of provisions, impairments and investment grants
 * (inventaire de clôture), on plain values: for one fiscal year, the
 * balance each allowance carries in, the balance required at the closing,
 * the movement already booked and the one still to book, and the share of
 * each grant to transfer to the result. Pure module: the service loads the
 * rows (lib/year-end/get-year-end-inventory.service.ts), tests feed values.
 *
 * What is booked is read from the entries themselves, never stored twice:
 * the lines of the linked entry on the allowance account (credit minus
 * debit) or on the grant's 139 account (debit minus credit). A draft the
 * user edits is read as edited; an entry cancelled by a contre-passation
 * counts for nothing, and the movement is proposed again.
 *
 * Rules: lib/provisions/rules.ts (PCG art. 322-1 et seq., 214-15 et seq.,
 * Code de commerce art. L123-20) and lib/investment-grants/schedule.ts
 * (PCG art. 312-1, CGI art. 42 septies). Every year-end movement is
 * proposed as a draft the user validates (PCG art. 1031-3: validation is
 * the user's act), never posted silently.
 */

import { movementAccounts, movementTo, type MovementAccounts, type ProvisionCategory, type ProvisionNature } from '@/lib/provisions/rules'
import { transferDueCents, cumulativeTransferCents, type FinancedAsset, type GrantSpreading, type GrantTerms } from '@/lib/investment-grants/schedule'

/** yyyy-mm-dd */
type Day = string

export interface YearRef {
  id: string
  year: number
  startDate: Day
  endDate: Day
  isClosed: boolean
}

export interface LinkedEntry {
  id: string
  entryNumber: string
  status: 'draft' | 'validated'
  fiscalYearId: string
  /** Cancelled by a contre-passation. */
  reversed: boolean
  lines: Array<{ accountCode: string; debitCents: number; creditCents: number }>
}

/**
 * Where an item stands for the fiscal year:
 * - not_in_year: opened after the year, or ended before it with nothing left;
 * - to_assess: no balance required yet for this closing;
 * - up_to_date: nothing to book;
 * - to_post: a movement to book, no entry yet;
 * - draft / validated: the movement is booked by that entry;
 * - to_correct: an entry is linked but no longer matches (assessment
 *   changed, draft edited): a draft is replaced when the entries are
 *   prepared again, a validated entry must be reversed first.
 */
export type AdjustmentStatus = 'not_in_year' | 'to_assess' | 'up_to_date' | 'to_post' | 'draft' | 'validated' | 'to_correct'

export const STATUS_LABELS: Record<AdjustmentStatus, string> = {
  not_in_year: 'Hors exercice',
  to_assess: 'À évaluer',
  up_to_date: 'À jour',
  to_post: 'À comptabiliser',
  draft: 'Brouillon',
  validated: 'Comptabilisée',
  to_correct: 'À corriger',
}

export interface EntryRef {
  id: string
  entryNumber: string
  status: 'draft' | 'validated'
  /** Movement the entry books, in cents (provision: positive dotation, negative reprise; grant: transfer). */
  cents: number
}

/** Credit minus debit of the entry on an allowance account (and its sub-accounts): positive for a dotation. */
export function allowanceMovementCents(entry: LinkedEntry, accountCode: string): number {
  if (entry.reversed) return 0
  return entry.lines.filter((l) => l.accountCode.startsWith(accountCode)).reduce((s, l) => s + l.creditCents - l.debitCents, 0)
}

/** Debit minus credit of the entry on the grant's 139 account: the share transferred. */
export function grantTransferMovementCents(entry: LinkedEntry, transferAccountCode: string): number {
  if (entry.reversed) return 0
  return entry.lines.filter((l) => l.accountCode.startsWith(transferAccountCode)).reduce((s, l) => s + l.debitCents - l.creditCents, 0)
}

// ------------------------------------------------------------------ provisions and impairments

export interface ProvisionInput {
  id: string
  category: ProvisionCategory
  label: string
  accountCode: string
  nature: ProvisionNature
  reversible: boolean
  openedOn: Day
  closedOn: Day | null
  carriedCents: number
  assessments: Array<{
    fiscalYearId: string
    amountCents: number
    currentValueCents: number | null
    basis: string | null
    entry: LinkedEntry | null
  }>
}

export interface ProvisionYear {
  status: AdjustmentStatus
  accounts: MovementAccounts
  /** Balance at the start of the year: carried over plus the movements of earlier years. */
  openingCents: number
  /** Balance required at the closing: the assessment, 0 once the risk ended, null when not assessed. */
  requiredCents: number | null
  assessment: { amountCents: number; currentValueCents: number | null; basis: string | null } | null
  /** Movement booked for this closing by the linked entry. */
  bookedCents: number
  /** Movement still to book (positive dotation, negative reprise). */
  proposedCents: number
  /** opening + booked */
  closingCents: number
  /** A reprise is due but this impairment is never reversed (goodwill, PCG art. 214-19). */
  reversalRefused: boolean
  entry: EntryRef | null
}

/** The provision or impairment for one fiscal year. `years`: every fiscal year of the company. */
export function provisionYear(provision: ProvisionInput, year: YearRef, years: YearRef[]): ProvisionYear {
  const accounts = movementAccounts(provision.category, provision.accountCode, provision.nature)
  const startOf = new Map(years.map((y) => [y.id, y.startDate]))
  let openingCents = provision.carriedCents
  for (const a of provision.assessments) {
    const start = startOf.get(a.fiscalYearId)
    if (start !== undefined && start < year.startDate && a.entry) openingCents += allowanceMovementCents(a.entry, provision.accountCode)
  }
  const current = provision.assessments.find((a) => a.fiscalYearId === year.id) ?? null
  const linked = current?.entry && !current.entry.reversed ? current.entry : null
  const bookedCents = linked ? allowanceMovementCents(linked, provision.accountCode) : 0
  const closingCents = openingCents + bookedCents
  const entry: EntryRef | null = linked ? { id: linked.id, entryNumber: linked.entryNumber, status: linked.status, cents: bookedCents } : null
  const assessment = current ? { amountCents: current.amountCents, currentValueCents: current.currentValueCents, basis: current.basis } : null
  const base = { accounts, openingCents, assessment, bookedCents, closingCents, entry }

  const ended = provision.closedOn !== null && provision.closedOn <= year.endDate
  const requiredCents = current ? current.amountCents : ended ? 0 : null
  const outside =
    provision.openedOn > year.endDate || (provision.closedOn !== null && provision.closedOn < year.startDate && openingCents === 0 && !current)
  if (outside && bookedCents === 0) {
    return { ...base, status: 'not_in_year', requiredCents: null, proposedCents: 0, reversalRefused: false }
  }
  if (requiredCents === null) {
    return { ...base, status: linked ? 'to_correct' : 'to_assess', requiredCents, proposedCents: 0, reversalRefused: false }
  }
  const remaining = movementTo(requiredCents, closingCents, provision.reversible)
  let status: AdjustmentStatus
  if (linked) status = remaining.cents === 0 ? linked.status : 'to_correct'
  else status = remaining.cents === 0 ? 'up_to_date' : 'to_post'
  return { ...base, status, requiredCents, proposedCents: remaining.cents, reversalRefused: remaining.reversalRefused }
}

// ------------------------------------------------------------------ investment grants

export interface GrantInput {
  id: string
  label: string
  amountCents: number
  spreading: GrantSpreading
  grantedOn: Day
  durationYears: number | null
  transferAccountCode: string
  carriedCents: number
  transfers: Array<{ fiscalYearId: string; entry: LinkedEntry | null }>
}

export interface GrantYear {
  status: AdjustmentStatus
  /** Transferred before the year: carried over plus the transfers booked in earlier years. */
  transferredBeforeCents: number
  /** What should be in the result at the end of the year (cumulative). */
  expectedCumulativeCents: number
  bookedCents: number
  /** Share of the year still to transfer. */
  proposedCents: number
  /** Left in equity after the year, once the proposal is booked. */
  remainingCents: number
  entry: EntryRef | null
}

/** Number of the fiscal year containing `day`, else its calendar year. */
export function yearNumberOf(day: Day, years: YearRef[]): number {
  return years.find((y) => y.startDate <= day && day <= y.endDate)?.year ?? Number(day.slice(0, 4))
}

/** The grant for one fiscal year; `asset`: the financed asset at the end of the year (ASSET spreading). */
export function grantYear(grant: GrantInput, year: YearRef, years: YearRef[], asset: FinancedAsset | null): GrantYear {
  const startOf = new Map(years.map((y) => [y.id, y.startDate]))
  let transferredBeforeCents = grant.carriedCents
  for (const t of grant.transfers) {
    const start = startOf.get(t.fiscalYearId)
    if (start !== undefined && start < year.startDate && t.entry) transferredBeforeCents += grantTransferMovementCents(t.entry, grant.transferAccountCode)
  }
  const current = grant.transfers.find((t) => t.fiscalYearId === year.id) ?? null
  const linked = current?.entry && !current.entry.reversed ? current.entry : null
  const bookedCents = linked ? grantTransferMovementCents(linked, grant.transferAccountCode) : 0
  const entry: EntryRef | null = linked ? { id: linked.id, entryNumber: linked.entryNumber, status: linked.status, cents: bookedCents } : null
  const terms: GrantTerms = { amountCents: grant.amountCents, spreading: grant.spreading, grantedOn: grant.grantedOn, durationYears: grant.durationYears }
  const context = { grantYear: yearNumberOf(grant.grantedOn, years), asset }
  const expectedCumulativeCents = cumulativeTransferCents(terms, year, context)
  const proposedCents = transferDueCents(terms, year, context, transferredBeforeCents + bookedCents)
  const remainingCents = grant.amountCents - transferredBeforeCents - bookedCents - proposedCents
  const base = { transferredBeforeCents, expectedCumulativeCents, bookedCents, proposedCents, remainingCents, entry }

  if (bookedCents === 0 && (grant.grantedOn > year.endDate || transferredBeforeCents >= grant.amountCents)) {
    return { ...base, status: 'not_in_year', proposedCents: 0 }
  }
  // A share booked beyond what the schedule expects (a draft edited, the asset changed)
  const overBooked = transferredBeforeCents + bookedCents > Math.max(expectedCumulativeCents, transferredBeforeCents)
  let status: AdjustmentStatus
  if (linked) status = proposedCents === 0 && !overBooked ? linked.status : 'to_correct'
  else status = proposedCents === 0 ? 'up_to_date' : 'to_post'
  return { ...base, status }
}
