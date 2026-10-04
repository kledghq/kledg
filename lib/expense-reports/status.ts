/**
 * Status of an expense report, on plain values. Pure module: lists, the
 * detail page and the services share it.
 *
 * - brouillon, soumise, validée: stored (ExpenseReport.status), changed by
 *   the workflow (manage-expense-reports.service.ts);
 * - comptabilisée: a validated report with its entry (entryId);
 * - remboursée: the claimant line of that entry is lettered, with the bank
 *   payment of the reimbursement (expense-reimbursement.service.ts) or by
 *   hand in Lettrage. Derived, never stored, like the paid status of an
 *   invoice.
 */

export type StoredExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'VALIDATED'
export type ExpenseReportStatus = 'draft' | 'submitted' | 'validated' | 'posted' | 'reimbursed'

export const EXPENSE_STATUS_LABELS: Record<ExpenseReportStatus, string> = {
  draft: 'Brouillon',
  submitted: 'Soumise',
  validated: 'Validée',
  posted: 'Comptabilisée',
  reimbursed: 'Remboursée',
}

export const EXPENSE_STATUS_TONES: Record<ExpenseReportStatus, 'neutral' | 'info' | 'warning' | 'success'> = {
  draft: 'neutral',
  submitted: 'warning',
  validated: 'info',
  posted: 'info',
  reimbursed: 'success',
}

export function expenseReportStatus(input: { status: StoredExpenseStatus; posted: boolean; lettered: boolean }): ExpenseReportStatus {
  if (input.status === 'VALIDATED' && input.posted) return input.lettered ? 'reimbursed' : 'posted'
  return input.status === 'DRAFT' ? 'draft' : input.status === 'SUBMITTED' ? 'submitted' : 'validated'
}

/** Filters of the lists, matched in the database. */
export const EXPENSE_STATUS_FILTERS = ['all', 'draft', 'submitted', 'validated', 'posted', 'reimbursed'] as const
export type ExpenseStatusFilter = (typeof EXPENSE_STATUS_FILTERS)[number]

export const CLAIMANT_KIND_LABELS: Record<'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE', string> = {
  EMPLOYEE: 'Salarié',
  DIRIGEANT: 'Dirigeant',
  ASSOCIE: 'Associé',
}

/**
 * Account credited by default for each kind of claimant (PCG art. 932-1,
 * liste des comptes, classe 4):
 * - a salarié: 421 "Personnel, rémunérations dues", where the company
 *   records what it owes its staff;
 * - an associé (dirigeant or not): 455 "Associés, comptes courants", the
 *   current account the associé lends through;
 * - a dirigeant who is neither salarié nor associé (a président of SAS
 *   without salary or shares, a gérant non associé): 467 "Autres comptes
 *   débiteurs ou créditeurs".
 * A dirigeant assimilé salarié is set to 421, an associé dirigeant to 455:
 * the account is chosen per claimant (accountCode).
 */
export const DEFAULT_CLAIMANT_ACCOUNT: Record<'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE', { root: string; label: string }> = {
  EMPLOYEE: { root: '421', label: 'Personnel, rémunérations dues' },
  DIRIGEANT: { root: '467', label: 'Autres comptes débiteurs ou créditeurs' },
  ASSOCIE: { root: '455', label: 'Associés, comptes courants' },
}

/** Prefix of the auxiliary numbers given to claimants (S00001 for salariés...). */
export const CLAIMANT_AUX_PREFIX: Record<'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE', string> = {
  EMPLOYEE: 'S',
  DIRIGEANT: 'D',
  ASSOCIE: 'A',
}
