/**
 * Status of a deadline of the calendar (lib/deadlines): à faire, déposée,
 * payée, en retard or non due, from what the user recorded in the tracker
 * (declaration_statuses) and the facts other modules already hold (VAT
 * filing records, corporate tax filings and acomptes paid, the approval of
 * the accounts, a CFE avis of zero). Pure, no imports beyond types: the
 * Échéances page uses it on the client.
 *
 * Invariant: a fact has one home. A field another module owns (the filing
 * of a VAT return, of the 2065, an IS acompte paid, the approval and the
 * filing of the accounts) is read from it and locked in the tracker, so the
 * same fact is never entered twice and never disagrees.
 */

import type { Deadline } from '@/lib/deadlines/types'

/** What a deadline asks: a return to file, a payment, or both. */
export type DeclarationKind = 'file' | 'pay' | 'file-and-pay'

export const DECLARATION_KINDS: Record<string, DeclarationKind> = {
  // The VAT is paid when the return is filed (CGI art. 1692): a CA3 or a CA12 is both.
  'tva-ca3': 'file-and-pay',
  'tva-ca12': 'file-and-pay',
  'tva-acompte': 'pay',
  'is-acompte': 'pay',
  'is-solde': 'pay',
  liasse: 'file',
  das2: 'file',
  cvae: 'file',
  'cvae-acompte': 'pay',
  'cvae-solde': 'file-and-pay',
  'cfe-acompte': 'pay',
  cfe: 'pay',
  'cfe-1447c': 'file',
  'cfe-1447m': 'file',
  approbation: 'file',
  'depot-comptes': 'file',
}

export function declarationKindOf(ruleId: string): DeclarationKind {
  return DECLARATION_KINDS[ruleId] ?? 'file'
}

export type DeclarationStatusCode = 'todo' | 'filed' | 'paid' | 'overdue' | 'not-due'

export const DECLARATION_STATUS_CODES = ['todo', 'filed', 'paid', 'overdue', 'not-due'] as const satisfies readonly DeclarationStatusCode[]

/** Where a fact comes from. */
export type DeclarationSource = 'vat-return' | 'corporate-tax' | 'approval' | 'local-taxes' | 'tracker'

/** The tracker fields a source owns. */
export type LockedField = 'filedOn' | 'paidOn' | 'notDue'

/** What another module holds about a deadline. */
export interface SourceFacts {
  source: Exclude<DeclarationSource, 'tracker'>
  filedOn?: string | null
  paidOn?: string | null
  amountCents?: number | null
  notDue?: boolean
  /** The fields this module owns, locked in the tracker even when it holds no value yet. */
  locked: LockedField[]
  /** The page where the fact is recorded, relative to the company ("declarations-tva?periode=2026-09"). */
  page: string
  /** French name of that page, for the link ("Déclarations de TVA"). */
  pageLabel: string
}

/** What the user recorded in the tracker (declaration_statuses), days as yyyy-mm-dd. */
export interface TrackerRecord {
  filedOn: string | null
  paidOn: string | null
  amountCents: number | null
  notDue: boolean
  attachmentId: string | null
  attachmentName: string | null
  attachmentReference: string | null
  note: string | null
  updatedAt: string | null
}

export interface DeadlineStatus {
  status: DeclarationStatusCode
  label: string
  kind: DeclarationKind
  /** Nothing left to do: not due, or filed and paid as the deadline asks. */
  settled: boolean
  filedOn: string | null
  paidOn: string | null
  amountCents: number | null
  notDue: boolean
  /** The day after which the deadline is late: the online filing extension when there is one. */
  lateAfter: string
  /** Where filedOn and paidOn come from. */
  filedFrom: DeclarationSource | null
  paidFrom: DeclarationSource | null
  /** The fields another module owns, with the page where they are recorded. */
  locked: LockedField[]
  sourcePage: { page: string; label: string } | null
  record: TrackerRecord | null
}

const LABELS: Record<DeclarationStatusCode, string> = {
  todo: 'À faire',
  filed: 'Déposée',
  paid: 'Payée',
  overdue: 'En retard',
  'not-due': 'Non due',
}

/** The label of a status, worded for the deadline ("Approuvés" for the approval of the accounts). */
export function statusLabel(status: DeclarationStatusCode, ruleId: string): string {
  if (status === 'filed' && ruleId === 'approbation') return 'Approuvés'
  if (status === 'filed' && ruleId === 'depot-comptes') return 'Déposés'
  return LABELS[status]
}

/**
 * The status of a deadline on `today`:
 * - not due when the user (or a source: a CFE of zero) says so;
 * - complete when filed (a return), paid (a payment), or filed and paid (a
 *   return with a payment; filed alone completes it when the amount filed
 *   is zero): "Payée" when a payment is part of it, else "Déposée";
 * - incomplete after the day (or the online extension): "En retard";
 * - incomplete but filed (payment missing): "Déposée";
 * - otherwise "À faire".
 */
export function deriveStatus(deadline: Pick<Deadline, 'ruleId' | 'date' | 'extendedDate'>, facts: SourceFacts | null, record: TrackerRecord | null, today: string): DeadlineStatus {
  const kind = declarationKindOf(deadline.ruleId)
  const locked = facts?.locked ?? []
  const pick = <K extends 'filedOn' | 'paidOn'>(field: K): { value: string | null; from: DeclarationSource | null } => {
    const fromSource = facts?.[field] ?? null
    if (fromSource) return { value: fromSource, from: facts?.source ?? null }
    if (locked.includes(field)) return { value: null, from: null }
    const fromRecord = record?.[field] ?? null
    return { value: fromRecord, from: fromRecord ? 'tracker' : null }
  }
  const filed = pick('filedOn')
  const paid = pick('paidOn')
  const amountCents = facts?.amountCents ?? record?.amountCents ?? null
  const notDue = Boolean(facts?.notDue) || (!locked.includes('notDue') && Boolean(record?.notDue))
  const lateAfter = deadline.extendedDate ?? deadline.date

  let status: DeclarationStatusCode
  let settled = notDue
  if (notDue) status = 'not-due'
  else {
    const nothingToPay = amountCents === 0
    const complete =
      kind === 'file' ? filed.value !== null : kind === 'pay' ? paid.value !== null : filed.value !== null && (paid.value !== null || nothingToPay)
    settled = complete
    if (complete) status = kind === 'file' || (kind === 'file-and-pay' && paid.value === null) ? 'filed' : 'paid'
    else if (today > lateAfter) status = 'overdue'
    else if (filed.value !== null) status = 'filed'
    else status = 'todo'
  }

  return {
    status,
    label: statusLabel(status, deadline.ruleId),
    kind,
    settled,
    filedOn: filed.value,
    paidOn: paid.value,
    amountCents,
    notDue,
    lateAfter,
    filedFrom: filed.from,
    paidFrom: paid.from,
    locked,
    sourcePage: facts ? { page: facts.page, label: facts.pageLabel } : null,
    record,
  }
}

/** A deadline of the calendar with its status. */
export type TrackedDeadline = Deadline & { status: DeadlineStatus }
